import { useT } from '@open-codesign/i18n';
import { Layout, Presentation, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCodesignStore } from '../store';

type ProjectKind = 'prototype' | 'slideDeck' | 'template' | 'other';
type Fidelity = 'wireframe' | 'high';

const KIND_ORDER: ProjectKind[] = ['prototype', 'slideDeck', 'template', 'other'];
const KIND_ICON: Record<ProjectKind, typeof Layout> = {
  prototype: Layout,
  slideDeck: Presentation,
  template: Wand2,
  other: Sparkles,
};

interface ProjectIntent {
  kind: ProjectKind;
  fidelity?: Fidelity;
  speakerNotes?: boolean;
  template?: string | null;
}

const INTENT_STORAGE_KEY = 'open-codesign:new-design-intent';

/**
 * Persist the just-created design's intent so the first generation prompt
 * can pick it up. Keyed by design id; cleared on read.
 */
export function readDesignIntent(designId: string): ProjectIntent | null {
  try {
    const raw = window.localStorage.getItem(`${INTENT_STORAGE_KEY}:${designId}`);
    if (!raw) return null;
    return JSON.parse(raw) as ProjectIntent;
  } catch {
    return null;
  }
}

export function clearDesignIntent(designId: string): void {
  try {
    window.localStorage.removeItem(`${INTENT_STORAGE_KEY}:${designId}`);
  } catch {
    /* localStorage unavailable */
  }
}

function writeDesignIntent(designId: string, intent: ProjectIntent): void {
  try {
    window.localStorage.setItem(`${INTENT_STORAGE_KEY}:${designId}`, JSON.stringify(intent));
  } catch {
    /* localStorage unavailable */
  }
}

export function NewDesignDialog() {
  const t = useT();
  const open = useCodesignStore((s) => s.newDesignDialogOpen);
  const close = useCodesignStore((s) => s.closeNewDesignDialog);
  const createNewDesign = useCodesignStore((s) => s.createNewDesign);
  const setView = useCodesignStore((s) => s.setView);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProjectKind>('prototype');
  const [fidelity, setFidelity] = useState<Fidelity>('high');
  const [speakerNotes, setSpeakerNotes] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) {
      setName('');
      setKind('prototype');
      setFidelity('high');
      setSpeakerNotes(false);
    }
  }, [open]);

  if (!open) return null;

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const design = await createNewDesign(null);
      if (design) {
        const intent: ProjectIntent = {
          kind,
          ...(kind === 'prototype' ? { fidelity } : {}),
          ...(kind === 'slideDeck' ? { speakerNotes } : {}),
        };
        writeDesignIntent(design.id, intent);
        if (name.trim().length > 0) {
          await window.codesign?.snapshots.renameDesign(design.id, name.trim()).catch(() => {});
        }
        close();
        setView('workspace');
      }
    } finally {
      setCreating(false);
    }
  }

  const kindLabel = (k: ProjectKind) => t(`create.types.${k}`);
  const kindDescription = (k: ProjectKind) => t(`create.typeDescriptions.${k}`);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('create.title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] animate-[overlay-in_120ms_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !creating) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !creating) close();
      }}
    >
      <div
        role="document"
        className="w-full max-w-md rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] p-5 space-y-4 animate-[panel-in_160ms_ease-out]"
      >
        <div className="space-y-1">
          <h3 className="display text-[var(--text-md)] font-medium text-[var(--color-text-primary)]">
            {t('create.title')}
          </h3>
          <p className="text-[var(--text-sm)] text-[var(--color-text-secondary)] leading-[var(--leading-body)]">
            {t('create.subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {KIND_ORDER.map((k) => {
            const Icon = KIND_ICON[k];
            const active = k === kind;
            return (
              <button
                type="button"
                key={k}
                onClick={() => setKind(k)}
                className={`flex flex-col items-start gap-1 rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors ${
                  active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <span className="flex items-center gap-1.5 text-[var(--text-sm)] font-medium">
                  <Icon className="size-3.5" />
                  {kindLabel(k)}
                </span>
                <span className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-snug">
                  {kindDescription(k)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="new-design-name"
            className="text-[var(--text-xs)] uppercase tracking-[0.04em] text-[var(--color-text-muted)]"
          >
            {t('create.fields.name')}
          </label>
          <input
            id="new-design-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('create.fields.namePlaceholder')}
            disabled={creating}
            autoFocus
            className="w-full h-9 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none transition-colors"
          />
        </div>

        {kind === 'prototype' ? (
          <div className="space-y-1">
            <span className="text-[var(--text-xs)] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
              {t('create.fields.fidelity')}
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFidelity('wireframe')}
                className={`flex flex-col items-start gap-0.5 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors ${
                  fidelity === 'wireframe'
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <span className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
                  {t('create.fields.fidelityWireframe')}
                </span>
                <span className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-snug">
                  {t('create.fields.fidelityWireframeHint')}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFidelity('high')}
                className={`flex flex-col items-start gap-0.5 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors ${
                  fidelity === 'high'
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <span className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
                  {t('create.fields.fidelityHigh')}
                </span>
                <span className="text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-snug">
                  {t('create.fields.fidelityHighHint')}
                </span>
              </button>
            </div>
          </div>
        ) : null}

        {kind === 'slideDeck' ? (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={speakerNotes}
              onChange={(e) => setSpeakerNotes(e.target.checked)}
              className="mt-0.5"
            />
            <span className="space-y-0.5">
              <span className="block text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
                {t('create.fields.speakerNotes')}
              </span>
              <span className="block text-[var(--text-xs)] text-[var(--color-text-secondary)] leading-snug">
                {t('create.fields.speakerNotesHint')}
              </span>
            </span>
          </label>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => close()}
            disabled={creating}
            className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--text-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-50 transition-colors"
          >
            {t('create.close')}
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {t('create.cta')}
          </button>
        </div>
      </div>
    </div>
  );
}
