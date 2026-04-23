/**
 * Capability-based tool exposure (T3.6).
 *
 * Reads `Model<T>` capability fields directly from pi-ai (per spike
 * Verification C — no model-caps.ts table needed).
 */

export interface ModelLike {
  input?: ReadonlyArray<string>;
  reasoning?: boolean;
  cost?: { cacheRead?: number; cacheWrite?: number };
  contextWindow?: number;
  maxTokens?: number;
}

export interface ProviderLike {
  id: string;
}

export interface SessionCapabilities {
  vision: boolean;
  thinking: boolean;
  promptCaching: boolean;
  imageGen: boolean;
  contextWindow: number;
  maxTokens: number;
}

export function deriveCapabilities(
  model: ModelLike,
  configuredProviders: ReadonlyArray<ProviderLike>,
): SessionCapabilities {
  const vision = Array.isArray(model.input) && model.input.includes('image');
  const thinking = model.reasoning === true;
  const promptCaching =
    typeof model.cost?.cacheRead === 'number' || typeof model.cost?.cacheWrite === 'number';
  const imageGen = configuredProviders.some((p) => p.id === 'openai');
  return {
    vision,
    thinking,
    promptCaching,
    imageGen,
    contextWindow: model.contextWindow ?? 0,
    maxTokens: model.maxTokens ?? 0,
  };
}

export interface ToolExposureRule {
  name: string;
  /** When false, the tool is hidden from the agent's manifest. */
  available: (caps: SessionCapabilities) => boolean;
}

export const DEFAULT_RULES: ReadonlyArray<ToolExposureRule> = [
  { name: 'read', available: () => true },
  { name: 'write', available: () => true },
  { name: 'edit', available: () => true },
  { name: 'bash', available: () => true },
  { name: 'grep', available: () => true },
  { name: 'find', available: () => true },
  { name: 'ls', available: () => true },
  { name: 'todos', available: () => true },
  { name: 'done', available: () => true },
  { name: 'ask', available: () => true },
  { name: 'scaffold', available: () => true },
  { name: 'skill', available: () => true },
  { name: 'preview', available: () => true },
  { name: 'tweaks', available: () => true },
  { name: 'gen_image', available: (c) => c.imageGen },
];

export function exposeTools(
  caps: SessionCapabilities,
  rules: ReadonlyArray<ToolExposureRule> = DEFAULT_RULES,
): string[] {
  return rules.filter((r) => r.available(caps)).map((r) => r.name);
}
