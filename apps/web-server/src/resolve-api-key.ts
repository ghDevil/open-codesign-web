import { CHATGPT_CODEX_PROVIDER_ID, CodesignError, ERROR_CODES } from '@open-codesign/shared';

export interface ResolveActiveApiKeyDeps {
  getCodexAccessToken: () => Promise<string>;
  getApiKeyForProvider: (providerId: string) => string;
}

export async function resolveActiveApiKey(
  providerId: string,
  deps: ResolveActiveApiKeyDeps,
): Promise<string> {
  if (providerId === CHATGPT_CODEX_PROVIDER_ID) {
    try {
      return await deps.getCodexAccessToken();
    } catch (err) {
      throw new CodesignError(
        err instanceof Error ? err.message : 'ChatGPT subscription not signed in',
        ERROR_CODES.PROVIDER_AUTH_MISSING,
        { cause: err },
      );
    }
  }
  try {
    return deps.getApiKeyForProvider(providerId);
  } catch (err) {
    if (err instanceof CodesignError) throw err;
    throw new CodesignError(
      err instanceof Error ? err.message : `Failed to read API key for "${providerId}"`,
      ERROR_CODES.PROVIDER_AUTH_MISSING,
      { cause: err },
    );
  }
}

export async function resolveApiKeyWithKeylessFallback(
  providerId: string,
  allowKeyless: boolean,
  deps: ResolveActiveApiKeyDeps,
): Promise<string> {
  try {
    return await resolveActiveApiKey(providerId, deps);
  } catch (err) {
    if (
      allowKeyless &&
      providerId !== CHATGPT_CODEX_PROVIDER_ID &&
      err instanceof CodesignError &&
      (err.code === ERROR_CODES.PROVIDER_AUTH_MISSING || err.code === ERROR_CODES.PROVIDER_KEY_MISSING)
    ) {
      return '';
    }
    throw err;
  }
}
