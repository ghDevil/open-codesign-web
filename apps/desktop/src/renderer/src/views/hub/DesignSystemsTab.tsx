import { useT } from '@open-codesign/i18n';
import { Check, Link2, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DesignSystemLibraryItem } from '../../../../preload/index';
import { useCodesignStore } from '../../store';
import {
  clearSelectedDesignSystemId,
  readSelectedDesignSystemId,
  writeSelectedDesignSystemId,
} from '../../lib/design-system-selection';

type Mode = 'github' | 'figma' | 'manual';

const MODE_LABEL: Record<Mode, string> = {
  github: 'From GitHub repo',
  figma: 'From Figma file',
  manual: 'Enter manually',
};

const MODE_HINT: Record<Mode, string> = {
  github:
    'Paste a public GitHub URL, "owner/repo", "owner/repo@branch", or "owner/repo@branch:path/to/subdir". We shallow-clone, scan likely design-system files, then discard the clone.',
  figma:
    'Paste a figma.com/file or /design URL. We pull color & text styles, components, and frame styles via the Figma REST API.',
  manual: 'Paste your tokens directly. One value per line.',
};

function splitLines(input: string): string[] {
  return input
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function DesignSystemCard(props: {
  item: DesignSystemLibraryItem;
  isActive: boolean;
  isCurrentSelection: boolean;
  busy: boolean;
  canAssignToCurrentDesign: boolean;
  onActivate: (id: string) => void;
  onUseForCurrentDesign: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const {
    item,
    isActive,
    isCurrentSelection,
    busy,
    canAssignToCurrentDesign,
    onActivate,
    onUseForCurrentDesign,
    onRemove,
  } = props;
  return (
    <article className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] truncate">
              {item.name}
            </h3>
            {isActive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-[var(--color-accent)]">
                Default
              </span>
            ) : null}
            {isCurrentSelection ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-emerald-600">
                This design
              </span>
            ) : null}
          </div>
          <p className="m-0 text-[var(--text-xs)] text-[var(--color-text-muted)] truncate" title={item.rootPath}>
            {item.rootPath}
          </p>
          <p className="m-0 text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
            {item.summary}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          disabled={busy}
          className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-[var(--radius-sm)] text-[var(--text-xs)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
          Remove
        </button>
      </div>

      {item.colors.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {item.colors.slice(0, 10).map((color, index) => {
            const valid = /^(#|rgba?\(|hsla?\()/.test(color);
            return (
              <span
                key={`${color}-${index}`}
                className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] uppercase tracking-wide border border-[var(--color-border)] bg-[var(--color-background)] font-mono"
                title={color}
              >
                {valid ? (
                  <span
                    aria-hidden="true"
                    className="block size-3 rounded-full border border-[var(--color-border)]"
                    style={{ backgroundColor: color }}
                  />
                ) : null}
                {color.length > 18 ? `${color.slice(0, 16)}...` : color}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-1 text-[var(--text-xs)] text-[var(--color-text-secondary)]">
        {item.fonts.length > 0 ? (
          <p className="m-0">
            <span className="font-medium">Fonts:</span> {item.fonts.slice(0, 6).join(', ')}
          </p>
        ) : null}
        {item.components.length > 0 ? (
          <p className="m-0">
            <span className="font-medium">Components:</span> {item.components.slice(0, 8).join(', ')}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onActivate(item.id)}
          disabled={busy || isActive}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--text-xs)] font-medium hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
        >
          {isActive ? <Check className="size-3.5" /> : null}
          {isActive ? 'Default active' : 'Set as default'}
        </button>
        {canAssignToCurrentDesign ? (
          <button
            type="button"
            onClick={() => onUseForCurrentDesign(item.id)}
            disabled={busy || isCurrentSelection}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-xs)] font-medium hover:opacity-90 disabled:opacity-50"
          >
            {isCurrentSelection ? <Check className="size-3.5" /> : null}
            {isCurrentSelection ? 'Using for this design' : 'Use for this design'}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function DesignSystemsTab() {
  const t = useT();
  const currentDesignId = useCodesignStore((state) => state.currentDesignId);
  const [mode, setMode] = useState<Mode>('github');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<DesignSystemLibraryItem[]>([]);
  const [selectionVersion, setSelectionVersion] = useState(0);

  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const [figmaName, setFigmaName] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualColors, setManualColors] = useState('');
  const [manualFonts, setManualFonts] = useState('');
  const [manualSpacing, setManualSpacing] = useState('');
  const [manualRadius, setManualRadius] = useState('');
  const [manualShadows, setManualShadows] = useState('');
  const [manualComponents, setManualComponents] = useState('');

  const currentSelectedId = useMemo(
    () => (currentDesignId ? readSelectedDesignSystemId(currentDesignId) : null),
    [currentDesignId, selectionVersion],
  );

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) ?? null,
    [items, activeId],
  );
  const currentSelectedItem = useMemo(
    () => items.find((item) => item.id === currentSelectedId) ?? null,
    [items, currentSelectedId],
  );

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!currentDesignId) return;
    if (currentSelectedId && !items.some((item) => item.id === currentSelectedId)) {
      clearSelectedDesignSystemId(currentDesignId);
      setSelectionVersion((value) => value + 1);
    }
  }, [currentDesignId, currentSelectedId, items]);

  function applyLibraryState(result: { activeId: string | null; items: DesignSystemLibraryItem[] }) {
    setActiveId(result.activeId);
    setItems(result.items ?? []);
  }

  async function refresh() {
    const api = window.codesign?.designSystems;
    if (!api) return;
    try {
      applyLibraryState(await api.list());
    } catch {
      setActiveId(null);
      setItems([]);
    }
  }

  async function withBusy(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGithubSubmit() {
    const api = window.codesign?.designSystems;
    if (!repoUrl.trim() || busy || !api) return;
    await withBusy(async () => {
      applyLibraryState(await api.importGithub({
        repoUrl: repoUrl.trim(),
        ...(repoName.trim() ? { name: repoName.trim() } : {}),
      }));
      setRepoUrl('');
      setRepoName('');
    });
  }

  async function handleFigmaSubmit() {
    const api = window.codesign?.designSystems;
    if (!figmaUrl.trim() || busy || !api) return;
    await withBusy(async () => {
      applyLibraryState(await api.importFigma({
        figmaUrl: figmaUrl.trim(),
        ...(figmaName.trim() ? { name: figmaName.trim() } : {}),
      }));
      setFigmaUrl('');
      setFigmaName('');
    });
  }

  async function handleManualSubmit() {
    const api = window.codesign?.designSystems;
    if (busy || !api) return;
    await withBusy(async () => {
      applyLibraryState(await api.importManual({
        ...(manualName.trim() ? { name: manualName.trim() } : {}),
        colors: splitLines(manualColors),
        fonts: splitLines(manualFonts),
        spacing: splitLines(manualSpacing),
        radius: splitLines(manualRadius),
        shadows: splitLines(manualShadows),
        components: splitLines(manualComponents),
      }));
    });
  }

  async function handleActivate(id: string) {
    const api = window.codesign?.designSystems;
    if (!api) return;
    await withBusy(async () => {
      applyLibraryState(await api.activate(id));
    });
  }

  async function handleRemove(id: string) {
    const api = window.codesign?.designSystems;
    if (busy || !api) return;
    if (!window.confirm('Remove this design system from the library?')) return;
    await withBusy(async () => {
      applyLibraryState(await api.remove(id));
      if (currentDesignId && readSelectedDesignSystemId(currentDesignId) === id) {
        clearSelectedDesignSystemId(currentDesignId);
        setSelectionVersion((value) => value + 1);
      }
    });
  }

  function handleUseForCurrentDesign(id: string) {
    if (!currentDesignId) return;
    writeSelectedDesignSystemId(currentDesignId, id);
    setError(null);
    setSelectionVersion((value) => value + 1);
  }

  function handleUseDefaultForCurrentDesign() {
    if (!currentDesignId) return;
    clearSelectedDesignSystemId(currentDesignId);
    setError(null);
    setSelectionVersion((value) => value + 1);
  }

  return (
    <section className="max-w-[var(--size-prose)] space-y-[var(--space-4)]">
      <header className="space-y-1">
        <h2 className="display text-[var(--text-lg)] tracking-[var(--tracking-heading)] text-[var(--color-text-primary)] m-0">
          {t('hub.designSystems.title')}
        </h2>
        <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
          Keep a library of brand systems, set one as the default, and optionally pin a different
          one to the design you are actively working on.
        </p>
      </header>

      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-background)] p-4 space-y-3">
        <div className="space-y-1">
          <p className="m-0 text-[var(--text-xs)] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
            Current routing
          </p>
          <p className="m-0 text-[var(--text-sm)] text-[var(--color-text-primary)]">
            Default: {activeItem ? activeItem.name : 'No default design system'}
          </p>
          <p className="m-0 text-[var(--text-xs)] text-[var(--color-text-secondary)]">
            {currentDesignId
              ? currentSelectedItem
                ? `This design is pinned to ${currentSelectedItem.name}.`
                : activeItem
                  ? 'This design is currently following the default design system.'
                  : 'This design has no design system assigned yet.'
              : 'Open a design to pin a specific system to it.'}
          </p>
        </div>
        {currentDesignId && currentSelectedItem ? (
          <button
            type="button"
            onClick={handleUseDefaultForCurrentDesign}
            disabled={busy}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-xs)] font-medium hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            Use default for this design
          </button>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) => (
            <DesignSystemCard
              key={item.id}
              item={item}
              isActive={item.id === activeId}
              isCurrentSelection={item.id === currentSelectedId}
              busy={busy}
              canAssignToCurrentDesign={Boolean(currentDesignId)}
              onActivate={handleActivate}
              onUseForCurrentDesign={handleUseForCurrentDesign}
              onRemove={handleRemove}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] p-4">
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)]">
            No design systems yet. Import your first one below and it will become the default.
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
                Label
              </span>
              <input
                type="text"
                value={repoName}
                onChange={(event) => setRepoName(event.target.value)}
                placeholder="Marketing brand"
                disabled={busy}
                className="mt-1 w-full h-9 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-sm)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[var(--text-xs)] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
                GitHub repository
              </span>
              <div className="mt-1 flex items-center gap-2">
                <Link2 className="size-4 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(event) => setRepoUrl(event.target.value)}
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
              {busy ? 'Scanning...' : 'Import and activate'}
            </button>
          </div>
        ) : null}

        {mode === 'figma' ? (
          <div className="space-y-2">
            <label className="block">
              <span className="text-[var(--text-xs)] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
                Label
              </span>
              <input
                type="text"
                value={figmaName}
                onChange={(event) => setFigmaName(event.target.value)}
                placeholder="Presentation system"
                disabled={busy}
                className="mt-1 w-full h-9 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-sm)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[var(--text-xs)] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
                Figma file URL
              </span>
              <div className="mt-1 flex items-center gap-2">
                <Link2 className="size-4 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  value={figmaUrl}
                  onChange={(event) => setFigmaUrl(event.target.value)}
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
              {busy ? 'Importing...' : 'Import and activate'}
            </button>
          </div>
        ) : null}

        {mode === 'manual' ? (
          <div className="space-y-3">
            <label className="block">
              <span className="text-[var(--text-xs)] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
                Label
              </span>
              <input
                type="text"
                value={manualName}
                onChange={(event) => setManualName(event.target.value)}
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
                  onChange={(event) => (setValue as (next: string) => void)(event.target.value)}
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
              {busy ? 'Saving...' : 'Save and activate'}
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
