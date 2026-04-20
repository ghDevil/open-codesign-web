import { describe, expect, it } from 'vitest';
import { parseCodexConfig } from './codex-config';

describe('parseCodexConfig', () => {
  it('returns empty providers on empty TOML', async () => {
    const out = await parseCodexConfig('');
    expect(out.providers).toEqual([]);
    expect(out.activeProvider).toBeNull();
  });

  it('translates a DeepSeek block to an openai-chat ProviderEntry', async () => {
    const toml = `
model = "deepseek-chat"
model_provider = "deepseek"

[model_providers.deepseek]
name = "DeepSeek"
base_url = "https://api.deepseek.com/v1"
env_key = "DEEPSEEK_API_KEY"
wire_api = "chat"
`;
    const out = await parseCodexConfig(toml);
    expect(out.providers).toHaveLength(1);
    const entry = out.providers[0];
    expect(entry?.id).toBe('codex-deepseek');
    expect(entry?.wire).toBe('openai-chat');
    expect(entry?.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(entry?.envKey).toBe('DEEPSEEK_API_KEY');
    expect(entry?.defaultModel).toBe('deepseek-chat');
    expect(out.activeProvider).toBe('codex-deepseek');
    expect(out.activeModel).toBe('deepseek-chat');
  });

  it('maps wire_api="responses" to openai-responses', async () => {
    const toml = `
[model_providers.azure]
base_url = "https://org.openai.azure.com/openai"
wire_api = "responses"

[model_providers.azure.query_params]
"api-version" = "2025-04-01-preview"
`;
    const out = await parseCodexConfig(toml);
    expect(out.providers[0]?.wire).toBe('openai-responses');
    expect(out.providers[0]?.queryParams?.['api-version']).toBe('2025-04-01-preview');
    expect(out.providers[0]?.defaultModel).toBe('gpt-4o');
  });

  it('uses provider-local model when a non-active provider declares one', async () => {
    const toml = `
model = "deepseek-chat"
model_provider = "deepseek"

[model_providers.deepseek]
base_url = "https://api.deepseek.com/v1"

[model_providers.local_proxy]
base_url = "https://proxy.example.test/v1"
model = "qwen3-coder"
`;
    const out = await parseCodexConfig(toml);
    expect(out.providers.find((p) => p.id === 'codex-local_proxy')?.defaultModel).toBe(
      'qwen3-coder',
    );
  });

  it('skips provider blocks missing base_url with a warning', async () => {
    const toml = `
[model_providers.bad]
name = "No URL"
`;
    const out = await parseCodexConfig(toml);
    expect(out.providers).toEqual([]);
    expect(out.warnings.join('\n')).toMatch(/bad.*missing base_url/);
  });

  it('returns a warning on bad TOML', async () => {
    const out = await parseCodexConfig('this is not toml = [');
    expect(out.providers).toEqual([]);
    expect(out.warnings[0]).toMatch(/not valid TOML/);
  });

  it('infers wire from base_url when wire_api is absent', async () => {
    const toml = `
[model_providers.claude_gateway]
base_url = "https://proxy.anthropic.example.com"
`;
    const out = await parseCodexConfig(toml);
    expect(out.providers[0]?.wire).toBe('anthropic');
  });
});
