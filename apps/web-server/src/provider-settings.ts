import {
  BUILTIN_PROVIDERS,
  CHATGPT_CODEX_PROVIDER_ID,
  CodesignError,
  type Config,
  ERROR_CODES,
  type ModelRef,
  type ProviderCapabilities,
  type ProviderEntry,
  type ReasoningLevel,
  type WireApi,
  isSupportedOnboardingProvider,
  resolveProviderCapabilities,
} from '@open-codesign/shared';

function resolveEntryFor(cfg: Config, id: string): ProviderEntry | null {
  const stored = cfg.providers[id];
  if (stored !== undefined) return stored;
  if (isSupportedOnboardingProvider(id)) return { ...BUILTIN_PROVIDERS[id] };
  return null;
}

function isKeylessProviderAllowed(provider: string, entry?: ProviderEntry | null): boolean {
  if (entry !== undefined && entry !== null) {
    const capabilities = resolveProviderCapabilities(provider, entry);
    if (capabilities.supportsKeyless) return true;
  }
  const isCodexFamily = provider.startsWith('codex-') || provider === CHATGPT_CODEX_PROVIDER_ID;
  return isCodexFamily && entry?.requiresApiKey !== true && entry?.envKey === undefined;
}

export interface ActiveModelResolution {
  model: ModelRef;
  baseUrl: string | null;
  wire: WireApi;
  httpHeaders: Record<string, string> | undefined;
  queryParams: Record<string, string> | undefined;
  reasoningLevel: ReasoningLevel | undefined;
  allowKeyless: boolean;
  capabilities: Required<ProviderCapabilities>;
  explicitCapabilities: ProviderCapabilities | undefined;
  overridden: boolean;
}

function resolveProviderConfig(cfg: Config, providerId: string) {
  const entry = resolveEntryFor(cfg, providerId);
  if (entry === null) {
    throw new CodesignError(
      `Provider "${providerId}" has no provider entry on disk.`,
      ERROR_CODES.PROVIDER_NOT_SUPPORTED,
    );
  }
  const allowKeyless = isKeylessProviderAllowed(providerId, entry);
  const capabilities = resolveProviderCapabilities(providerId, entry);
  return {
    provider: providerId,
    defaultModel: entry.defaultModel,
    baseUrl: entry.baseUrl,
    wire: entry.wire,
    httpHeaders: entry.httpHeaders,
    queryParams: entry.queryParams,
    reasoningLevel: entry.reasoningLevel,
    allowKeyless,
    capabilities,
    explicitCapabilities: entry.capabilities,
  };
}

export function resolveActiveModel(
  cfg: Config,
  hint: { provider: string; modelId: string },
): ActiveModelResolution {
  const activeId = cfg.activeProvider;
  const resolved = resolveProviderConfig(cfg, activeId);
  const overridden = activeId !== hint.provider;
  return {
    model: { provider: activeId, modelId: overridden ? cfg.activeModel : hint.modelId },
    baseUrl: resolved.baseUrl,
    wire: resolved.wire,
    httpHeaders: resolved.httpHeaders,
    queryParams: resolved.queryParams,
    reasoningLevel: resolved.reasoningLevel,
    allowKeyless: resolved.allowKeyless,
    capabilities: resolved.capabilities,
    explicitCapabilities: resolved.explicitCapabilities,
    overridden,
  };
}
