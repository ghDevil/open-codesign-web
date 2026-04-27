import { looksLikeClaudeOAuthToken, withClaudeCodeIdentity } from '@open-codesign/providers';
import type { WireApi } from '@open-codesign/shared';

export function buildAuthHeadersForWire(
  wire: WireApi,
  apiKey: string,
  extraHeaders?: Record<string, string>,
  baseUrl?: string,
): Record<string, string> {
  if (apiKey.length === 0) {
    const base: Record<string, string> = wire === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {};
    return withClaudeCodeIdentity(wire, baseUrl, { ...base, ...(extraHeaders ?? {}) });
  }
  const isOAuth = wire === 'anthropic' && looksLikeClaudeOAuthToken(apiKey);
  const base: Record<string, string> =
    wire === 'anthropic'
      ? isOAuth
        ? { authorization: `Bearer ${apiKey}`, 'anthropic-version': '2023-06-01' }
        : { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { authorization: `Bearer ${apiKey}` };
  return withClaudeCodeIdentity(wire, baseUrl, { ...base, ...(extraHeaders ?? {}) });
}
