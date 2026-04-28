/**
 * Bridges external MCP HTTP servers into the pi-agent-core AgentTool interface.
 *
 * At server startup, tool lists are fetched from each configured MCP endpoint
 * and cached. Each remote tool becomes an AgentTool that proxies calls back to
 * the MCP server via JSON-RPC 2.0.
 */

import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpToolsListResult {
  tools: McpToolDef[];
}

interface McpCallResult {
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
}

export interface McpToolCallContentItem {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface McpToolCallResult {
  content?: McpToolCallContentItem[];
  isError?: boolean;
  [k: string]: unknown;
}

interface McpJsonRpcBody {
  result?: unknown;
  error?: { message?: string };
}

interface McpHttpResponse {
  body: McpJsonRpcBody | null;
  sessionId: string | null;
}

const MCP_PROTOCOL_VERSION = '2024-11-05';
const mcpSessionIds = new Map<string, string>();

function sessionCacheKey(endpoint: string, extraHeaders?: Record<string, string>): string {
  return JSON.stringify({ endpoint, headers: extraHeaders ?? {} });
}

async function sendMcpHttpRequest(
  endpoint: string,
  payload: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<McpHttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const sessionId = res.headers.get('mcp-session-id');
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new Error(`MCP HTTP ${res.status} from ${endpoint}: ${text.slice(0, 200)}`);
    }
    if (text.trim().length === 0) {
      return { body: null, sessionId };
    }

    const contentType = res.headers.get('content-type') ?? '';
    let body: McpJsonRpcBody;
    if (contentType.includes('text/event-stream')) {
      const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) throw new Error(`MCP SSE response missing data line from ${endpoint}`);
      body = JSON.parse(dataLine.slice('data:'.length).trim()) as McpJsonRpcBody;
    } else {
      body = JSON.parse(text) as McpJsonRpcBody;
    }

    return { body, sessionId };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureMcpSession(
  endpoint: string,
  extraHeaders?: Record<string, string>,
): Promise<Record<string, string>> {
  const cacheKey = sessionCacheKey(endpoint, extraHeaders);
  const existing = mcpSessionIds.get(cacheKey);
  if (existing) {
    return { ...(extraHeaders ?? {}), 'mcp-session-id': existing };
  }

  const initialized = await sendMcpHttpRequest(
    endpoint,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'open-codesign-web', version: '0.1.4' },
      },
    },
    extraHeaders,
  );

  if (initialized.body?.error) {
    throw new Error(
      `MCP initialize error: ${initialized.body.error.message ?? JSON.stringify(initialized.body.error)}`,
    );
  }
  if (!initialized.sessionId) {
    return { ...(extraHeaders ?? {}) };
  }

  await sendMcpHttpRequest(
    endpoint,
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { ...(extraHeaders ?? {}), 'mcp-session-id': initialized.sessionId },
  );

  mcpSessionIds.set(cacheKey, initialized.sessionId);
  return { ...(extraHeaders ?? {}), 'mcp-session-id': initialized.sessionId };
}

async function mcpRequest(
  endpoint: string,
  method: string,
  params: unknown,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const headers = await ensureMcpSession(endpoint, extraHeaders);
  const { body } = await sendMcpHttpRequest(
    endpoint,
    { jsonrpc: '2.0', id: 1, method, params },
    headers,
  );
  if (body?.error) throw new Error(`MCP error: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body?.result ?? body;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeAgentToolFromMcp(
  def: McpToolDef,
  endpoint: string,
  extraHeaders?: Record<string, string>,
  // For bcgpt-style servers that read the key from the JSON body args
  injectBodyKey?: { paramName: string; value: string },
): AgentTool<any, unknown> {
  const inputSchema =
    (def.inputSchema as Record<string, unknown>) ?? {
      type: 'object',
      properties: {},
      additionalProperties: false,
    };

  return {
    name: def.name,
    label: def.name,
    description: def.description,
    // Pass the raw JSON Schema through — pi-agent-core serialises it as-is into
    // the LLM tool definition. TypeBox's TSchema constraint is structural only.
    parameters: inputSchema as never,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      const controller = new AbortController();
      const timeoutTimer = setTimeout(() => controller.abort(), 90_000);
      if (signal) signal.addEventListener('abort', () => controller.abort());

      try {
        // Merge injected body key (e.g. api_key for bcgpt) into args
        const args =
          injectBodyKey
            ? { ...(params as Record<string, unknown>), [injectBodyKey.paramName]: injectBodyKey.value }
            : (params ?? {});

        const result = (await mcpRequest(
          endpoint,
          'tools/call',
          { name: def.name, arguments: args },
          extraHeaders,
        )) as McpCallResult;

        const content = (result?.content ?? []).map((c) => {
          if (c.type === 'text') return { type: 'text' as const, text: String(c.text ?? '') };
          return { type: 'text' as const, text: JSON.stringify(c) };
        });

        if (content.length === 0) {
          content.push({ type: 'text', text: JSON.stringify(result) });
        }

        return { content, details: result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `Tool error: ${msg}` }],
          details: { error: msg },
        };
      } finally {
        clearTimeout(timeoutTimer);
      }
    },
  };
}

export interface McpServerConfig {
  /** Human-readable name (used in logs). */
  name: string;
  /** Full URL of the MCP HTTP endpoint, e.g. https://bcgpt.wickedlab.io/mcp */
  endpoint: string;
  /**
   * Optional HTTP headers sent with every request (e.g. Authorization: Bearer token).
   * Used by servers like the Figma MCP that authenticate via headers.
   */
  headers?: Record<string, string>;
  /**
   * For servers that read auth from the JSON body arguments (e.g. bcgpt reads api_key
   * from the tool arguments). When set, this key/value is injected into every tools/call.
   */
  bodyAuthKey?: { paramName: string; value: string };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedTools: AgentTool<any, unknown>[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch and cache tools from all configured MCP servers.
 * Returns [] on failure so generation still works without MCP.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadMcpTools(servers: McpServerConfig[]): Promise<AgentTool<any, unknown>[]> {
  const now = Date.now();
  if (cachedTools !== null && now < cacheExpiry) return cachedTools;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: AgentTool<any, unknown>[] = [];
  for (const server of servers) {
    try {
      const result = (await mcpRequest(
        server.endpoint,
        'tools/list',
        {},
        server.headers,
      )) as McpToolsListResult;
      const defs = result?.tools ?? [];
      for (const def of defs) {
        all.push(makeAgentToolFromMcp(def, server.endpoint, server.headers, server.bodyAuthKey));
      }
      console.log(`[mcp-tools] loaded ${defs.length} tools from ${server.name}`);
    } catch (err) {
      console.warn(`[mcp-tools] failed to load tools from ${server.name}:`, err);
    }
  }

  cachedTools = all;
  cacheExpiry = now + CACHE_TTL_MS;
  return all;
}

export async function callMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<McpToolCallResult> {
  const toolArgs =
    server.bodyAuthKey === undefined
      ? args
      : { ...args, [server.bodyAuthKey.paramName]: server.bodyAuthKey.value };

  return (await mcpRequest(
    server.endpoint,
    'tools/call',
    { name: toolName, arguments: toolArgs },
    server.headers,
  )) as McpToolCallResult;
}

/** Invalidate the tool cache so the next call re-fetches from all servers. */
export function invalidateMcpToolCache(): void {
  cachedTools = null;
  cacheExpiry = 0;
  mcpSessionIds.clear();
}
