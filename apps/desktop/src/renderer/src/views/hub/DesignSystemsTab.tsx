import { useT } from '@open-codesign/i18n';
import { Link2, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DesignSystemSummary {
  rootPath: string;
  summary: string;
  extractedAt: string;
  colors: string[];
  fonts: string[];
  components: string[];
}

type Mode = 'github' | 'figma' | 'manual';

const MODE_LABEL: Record<Mode, string> = {
  github: 'From GitHub repo',
  figma: 'From Figma file',
  manual: 'Enter manually',
};

const MODE_HINT: Record<Mode, string> = {
  github:
    'Paste a public GitHub URL, "owner/repo", "owner/repo@branch", or "owner/repo@branch:path/to/subdir". We shallow-clone, scan likely design-system files, then discard the clone.',
  figma: 'Paste a figma.com/file or /design URL. We pull color & text styles, components, and frame styles via the Figma REST API.',
  manual: 'Paste your tokens directly. One value per line.',
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const message =
      (json as { error?: { message?: string } })?.error?.message ||
      `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json as T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function DesignSystemsTab() {
  const t = useT();
  const [mode, setMode] = useState<Mode>('github');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DesignSystemSummary | null>(null);

  // GitHub form
  const [repoUrl, setRepoUrl] = useState('');

  // Figma form
  const [figmaUrl, setFigmaUrl] = useState('');

  // Manual form
  const [manualName, setManualName] = useState('');
  const [manualColors, setManualColors] = useState('');
  const [manualFonts, setManualFonts] = useState('');
  const [manualSpacing, setManualSpacing] = useState('');
  const [manualRadius, setManualRadius] = useState('');
  const [manualShadows, setManualShadows] = useState('');
  const [manualComponents, setManualComponents] = useState('');

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const result = await getJson<{ designSystem: DesignSystemSummary | null }>(
        '/api/design-system',
      );
      setSnapshot(
        result.designSystem
          ? { ...result.designSystem, components: result.designSystem.components ?? [] }
          : null,
      );
    } catch {
      setSnapshot(null);
    }
  }

  async function handleGithubSubmit() {
    if (!repoUrl.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postJson('/api/design-system/scan-github', { repoUrl: repoUrl.trim() });
      setRepoUrl('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleFigmaSubmit() {
    if (!figmaUrl.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postJson('/api/design-system/scan-figma', { figmaUrl: figmaUrl.trim() });
      setFigmaUrl('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleManualSubmit() {
    if (busy) return;
    const splitLines = (s: string) =>
      s
        .split(/[\n,]/)
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
    setBusy(true);
    setError(null);
    try {
      await postJson('/api/design-system/manual', {
        name: manualName.trim() || undefined,
        colors: splitLines(manualColors),
        fonts: splitLines(manualFonts),
        spacing: splitLines(manualSpacing),
        radius: splitLines(manualRadius),
        shadows: splitLines(manualShadows),
        components: splitLines(manualComponents),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    if (busy) return;
    if (!window.confirm('Remove the active design system?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/design-system', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-[var(--size-prose)] space-y-[var(--space-4)]">
      <header className="space-y-1">
        <h2 className="display text-[var(--text-lg)] tracking-[var(--tracking-heading)] text-[var(--color-text-primary)] m-0">
          {t('hub.designSystems.title')}
        </h2>
        <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
          Teach Claude your brand. The active system is applied to every new generation.
        </p>
      </header>

      {snapshot ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <p className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] truncate">
                {snapshot.rootPath}
              </p>
              <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)]">
                {snapshot.summary}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleClear()}
              disabled={busy}
              className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            >
              <Trash2 className="size-3.5" />
              Remove
            </button>
          </div>
          {snapshot.colors.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {snapshot.colors.slice(0, 12).map((c, i) => {
                const valid = /^(#|rgba?\(|hsla?\()/.test(c);
                return (
                  <span
                    key={`${c}-${i}`}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] uppercase tracking-wide border border-[var(--color-border)] bg-[var(--color-background)] font-mono"
                    title={c}
                  >
                    {valid ? (
                      <span
                        aria-hidden="true"
                        className="block size-3 rounded-full border border-[var(--color-border)]"
                        style={{ backgroundColor: c }}
                      />
                    ) : null}
                    {c.length > 18 ? `${c.slice(0, 16)}...` : c}
                  </span>
                );
              })}
            </div>
          ) : null}
          {snapshot.fonts.length > 0 ? (
            <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)]">
              <span className="font-medium">Fonts:</span> {snapshot.fonts.slice(0, 6).join(', ')}
            </p>
          ) : null}
          {snapshot.components.length > 0 ? (
            <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)]">
              <span className="font-medium">Components:</span>{' '}
              {snapshot.components.slice(0, 8).join(', ')}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] p-4">
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">
            No design system yet. Add one below - every new generation will use these tokens by
            default.
          </p>
        </div>
      )}

      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-background)] p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {(['github', 'figma', 'manual'] as Mode[]).map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setMode(m)}
              className={`h-8 px-3 rounded-[var(--radius-sm)] text-[var(--text-xs)] font-medium transition-colors ${
                mode === m
                  ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>

        <p className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
          {MODE_HINT[mode]}
        </p>

        {mode === 'github' ? (
          <div className="space-y-2">
            <label className="block">
              <span className="text-[var(--text-xs)] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
                GitHub repository
              </span>
              <div className="mt-1 flex items-center gap-2">
                <Link2 className="size-4 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo/tree/main/packages/ui"
                  disabled={busy}
                  className="flex-1 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-sm)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </div>
            </label>
            <button
              type="button"
              onClick={() => void handleGithubSubmit()}
              disabled={busy || repoUrl.trim().length === 0}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {busy ? 'Scanning...' : 'Scan repo'}
            </button>
          </div>
        ) : null}

        {mode === 'figma' ? (
          <div className="space-y-2">
            <label className="block">
              <span className="text-[var(--text-xs)] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
                Figma file URL
              </span>
              <div className="mt-1 flex items-center gap-2">
                <Link2 className="size-4 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  value={figmaUrl}
                  onChange={(e) => setFigmaUrl(e.target.value)}
                  placeholder="https://www.figma.com/file/<key>/<name>"
                  disabled={busy}
                  className="flex-1 h-9 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-sm)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </div>
            </label>
            <button
              type="button"
              onClick={() => void handleFigmaSubmit()}
              disabled={busy || figmaUrl.trim().length === 0}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {busy ? 'Importing...' : 'Import from Figma'}
            </button>
          </div>
        ) : null}

        {mode === 'manual' ? (
          <div className="space-y-3">
            <label className="block">
              <span className="text-[var(--text-xs)] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
                Name
              </span>
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Brand-2026"
                disabled={busy}
                className="mt-1 w-full h-9 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-sm)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </label>
            {[
              ['Colors', manualColors, setManualColors, '#1a1a1a\n#f8f5ef\nrgba(255,165,0,0.9)'],
              ['Fonts', manualFonts, setManualFonts, 'Inter\nFraunces\nJetBrains Mono'],
              ['Spacing', manualSpacing, setManualSpacing, '4px\n8px\n16px\n24px'],
              ['Radius', manualRadius, setManualRadius, '4px\n8px\n12px'],
              [
                'Shadows',
                manualShadows,
                setManualShadows,
                '0 1px 2px rgba(0,0,0,0.06)\n0 6px 24px rgba(0,0,0,0.12)',
              ],
              ['Components', manualComponents, setManualComponents, 'Primary Button\nCard\nTop Nav'],
            ].map(([label, value, setValue, placeholder]) => (
              <label key={label as string} className="block">
                <span className="text-[var(--text-xs)] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
                  {label as string}
                </span>
                <textarea
                  value={value as string}
                  onChange={(e) => (setValue as (v: string) => void)(e.target.value)}
                  placeholder={placeholder as string}
                  disabled={busy}
                  rows={3}
                  className="mt-1 w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-sm)] font-mono focus:border-[var(--color-accent)] focus:outline-none"
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() => void handleManualSubmit()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {busy ? 'Saving...' : 'Save manually'}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="text-[var(--text-xs)] text-[var(--color-danger)]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
