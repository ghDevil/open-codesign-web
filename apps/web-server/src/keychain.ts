import { CodesignError, type Config, ERROR_CODES, type SecretRef } from '@open-codesign/shared';

const PLAIN_PREFIX = 'plain:';

export function encryptSecret(plaintext: string): string {
  if (plaintext.length === 0) throw new CodesignError('Cannot store empty secret', ERROR_CODES.KEYCHAIN_EMPTY_INPUT);
  return `${PLAIN_PREFIX}${plaintext}`;
}

export function decryptSecret(stored: string): string {
  if (stored.length === 0) throw new CodesignError('Cannot read empty secret', ERROR_CODES.KEYCHAIN_EMPTY_INPUT);
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length);
  throw new CodesignError('Legacy encrypted secret found. Re-enter your API key in Settings.', ERROR_CODES.KEYCHAIN_UNAVAILABLE);
}

export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return '***';
  const prefix = plaintext.startsWith('sk-') ? 'sk-' : plaintext.slice(0, 4);
  return `${prefix}***${plaintext.slice(-4)}`;
}

export function buildSecretRef(plaintext: string): SecretRef {
  return { ciphertext: encryptSecret(plaintext), mask: maskSecret(plaintext) };
}

export function migrateSecrets(cfg: Config): { config: Config; changed: boolean } {
  const secrets = cfg.secrets ?? {};
  const entries = Object.entries(secrets);
  if (entries.length === 0) return { config: cfg, changed: false };

  const nextSecrets: Record<string, SecretRef> = { ...secrets };
  let changed = false;
  for (const [provider, ref] of entries) {
    if (ref.ciphertext.startsWith(PLAIN_PREFIX) && ref.mask) continue;
    if (!ref.ciphertext.startsWith(PLAIN_PREFIX)) {
      console.warn(`[keychain] Legacy encrypted secret for "${provider}" — cannot decrypt without Electron safeStorage. Re-enter in Settings.`);
      continue;
    }
    const plaintext = ref.ciphertext.slice(PLAIN_PREFIX.length);
    nextSecrets[provider] = { ciphertext: ref.ciphertext, mask: maskSecret(plaintext) };
    changed = true;
  }
  return { config: { ...cfg, secrets: nextSecrets }, changed };
}
