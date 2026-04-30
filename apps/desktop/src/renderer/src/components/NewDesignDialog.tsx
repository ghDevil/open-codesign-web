import { useT } from '@open-codesign/i18n';
import { Clapperboard, Layout, Link2, Monitor, Presentation, Smartphone, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ensureAnimationContext, type Fidelity, type ProjectIntent, type ProjectKind, writeDesignIntent } from '../lib/design-intent';
import { useCodesignStore } from '../store';

const KIND_ORDER: ProjectKind[] = ['prototype', 'mobile', 'slideDeck', 'animation', 'other'];

const KIND_META: Record<ProjectKind, { icon: typeof Layout; color: string }> = {
  prototype: { icon: Monitor, color: 'var(--color-accent)' },
  mobile: { icon: Smartphone, color: '#10b981' },
  slideDeck: { icon: Presentation, color: '#f59e0b' },
  animation: { icon: Clapperboard, color: '#f472b6' },
  other: { icon: Sparkles, color: '#8b5cf6' },
};

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
  const [animationAspectRatio, setAnimationAspectRatio] = useState<'16:9' | '9:16' | '1:1' | '4:5' | '21:9'>('16:9');
  const [animationFps, setAnimationFps] = useState(30);
  const [animationDurationSec, setAnimationDurationSec] = useState(6);
  const [animationMotionStyle, setAnimationMotionStyle] = useState<'cinematic' | 'snappy' | 'calm' | 'playful'>('cinematic');
  const [animationNarration, setAnimationNarration] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const [projectBrief, setProjectBrief] = useState('');
  const [creating, setCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setKind('prototype');
      setFidelity('high');
      setSpeakerNotes(false);
      setAnimationAspectRatio('16:9');
      setAnimationFps(30);
      setAnimationDurationSec(6);
      setAnimationMotionStyle('cinematic');
      setAnimationNarration('');
      setFigmaUrl('');
      setProjectBrief('');
    } else {
      // Focus name field after mount
      setTimeout(() => nameRef.current?.focus(), 60);
    }
  }, [open]);

  if (!open) return null;

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const normalizedFigmaUrl = figmaUrl.trim();
      const normalizedProjectBrief = projectBrief.trim();
      const design = await createNewDesign({
        referenceUrl: normalizedFigmaUrl.length > 0 ? normalizedFigmaUrl : undefined,
        projectInstructions: normalizedProjectBrief.length > 0 ? normalizedProjectBrief : null,
      });
      if (design) {
        const intent: ProjectIntent = {
          kind,
          ...(kind === 'prototype' ? { fidelity } : {}),
          ...(kind === 'slideDeck' ? { speakerNotes } : {}),
          ...(kind === 'animation'
            ? {
                animation: ensureAnimationContext({
                  aspectRatio: animationAspectRatio,
                  fps: animationFps,
                  durationInFrames: animationFps * animationDurationSec,
                  motionStyle: animationMotionStyle,
                  ...(animationNarration.trim().length > 0
                    ? { narration: animationNarration.trim() }
                    : {}),
                }),
              }
            : {}),
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
        if (e.key === 'Enter' && !creating) void handleCreate();
      }}
    >
      <div
        role="document"
        className="w-full max-w-[560px] rounded-[var(--radius-2xl)] bg-[var(--color-background)] border border-[var(--color-border)] shadow-[var(--shadow-elevated)] animate-[panel-in_160ms_ease-out] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h3
            className="text-[var(--text-md)] font-medium text-[var(--color-text-primary)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t('create.title')}
          </h3>
          <button
            type="button"
            onClick={() => close()}
            aria-label={t('create.close')}
            className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <p className="m-0 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
              Start with context
            </p>
            <p className="mt-1 mb-0 text-[12px] leading-[1.5] text-[var(--color-text-secondary)]">
              Seed the project with a Figma frame and a brief now so the first generation starts from real structure instead of a loose prompt.
            </p>
          </div>

          {/* Name input — first, most important */}
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('create.fields.namePlaceholder')}
            disabled={creating}
            className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none transition-colors"
          />

          <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="space-y-1">
              <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
                Figma frame or file URL
              </div>
              <div className="text-[11px] leading-[1.45] text-[var(--color-text-muted)]">
                Paste a Figma link to extract frame structure, copy, screenshot, and design-system cues before the first run.
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-3">
              <Link2 className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
              <input
                type="url"
                value={figmaUrl}
                onChange={(e) => setFigmaUrl(e.target.value)}
                placeholder="https://www.figma.com/design/..."
                disabled={creating}
                className="h-10 flex-1 bg-transparent text-[var(--text-sm)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
              />
            </div>
            {figmaUrl.trim().length > 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--color-background)] px-3 py-2 text-[11px] leading-[1.5] text-[var(--color-text-secondary)]">
                Figma mode will bias generation toward exact frame replication first, then responsive adaptation.
              </div>
            ) : null}
          </div>

          <div className="space-y-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div className="space-y-1">
              <div className="text-[12px] font-medium text-[var(--color-text-primary)]">
                Project brief
              </div>
              <div className="text-[11px] leading-[1.45] text-[var(--color-text-muted)]">
                Persistent goals, product constraints, or notes the model should keep across iterations.
              </div>
            </div>
            <textarea
              value={projectBrief}
              onChange={(e) => setProjectBrief(e.target.value)}
              placeholder="Audience, product goals, requirements, or anything the model should keep in mind for every turn."
              disabled={creating}
              rows={4}
              className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[var(--text-sm)] leading-[1.5] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>

          {/* Type selector */}
          <div className="grid grid-cols-5 gap-2">
            {KIND_ORDER.map((k) => {
              const { icon: Icon, color } = KIND_META[k];
              const active = k === kind;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`
                    flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] border py-3 px-2 text-center transition-colors
                    ${active
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
                    }
                  `}
                >
                  <Icon
                    className="w-4 h-4 shrink-0"
                    style={{ color: active ? color : 'var(--color-text-muted)' }}
                    aria-hidden
                  />
                  <span
                    className="text-[11px] leading-tight font-medium"
                    style={{ color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}
                  >
                    {t(`create.types.${k}`)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Fidelity (prototype only) */}
          {kind === 'prototype' ? (
            <div className="grid grid-cols-2 gap-2">
              {(['wireframe', 'high'] as Fidelity[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFidelity(f)}
                  className={`
                    flex flex-col gap-0.5 rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors
                    ${fidelity === f
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)]'
                    }
                  `}
                >
                  <span className="text-[var(--text-xs)] font-medium text-[var(--color-text-primary)]">
                    {t(`create.fields.fidelity${f === 'wireframe' ? 'Wireframe' : 'High'}`)}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)] leading-snug">
                    {t(`create.fields.fidelity${f === 'wireframe' ? 'Wireframe' : 'High'}Hint`)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {/* Speaker notes (slide deck only) */}
          {kind === 'slideDeck' ? (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={speakerNotes}
                onChange={(e) => setSpeakerNotes(e.target.checked)}
                className="w-4 h-4 rounded accent-[var(--color-accent)]"
              />
              <span className="text-[var(--text-sm)] text-[var(--color-text-primary)]">
                {t('create.fields.speakerNotes')}
              </span>
            </label>
          ) : null}

          {kind === 'animation' ? (
            <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
                  Aspect ratio
                  <select
                    value={animationAspectRatio}
                    onChange={(event) =>
                      setAnimationAspectRatio(
                        event.target.value as '16:9' | '9:16' | '1:1' | '4:5' | '21:9',
                      )
                    }
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-[var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                  >
                    {['16:9', '9:16', '1:1', '4:5', '21:9'].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
                  Motion style
                  <select
                    value={animationMotionStyle}
                    onChange={(event) =>
                      setAnimationMotionStyle(
                        event.target.value as 'cinematic' | 'snappy' | 'calm' | 'playful',
                      )
                    }
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-[var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                  >
                    <option value="cinematic">Cinematic</option>
                    <option value="snappy">Snappy</option>
                    <option value="calm">Calm</option>
                    <option value="playful">Playful</option>
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
                  Duration (seconds)
                  <input
                    type="number"
                    min={2}
                    max={60}
                    value={animationDurationSec}
                    onChange={(event) =>
                      setAnimationDurationSec(
                        Math.max(2, Math.min(60, Number(event.target.value) || 6)),
                      )
                    }
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-[var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                  />
                </label>
                <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
                  FPS
                  <select
                    value={animationFps}
                    onChange={(event) => setAnimationFps(Number(event.target.value))}
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-[var(--text-sm)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                  >
                    {[24, 30, 60].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea
                value={animationNarration}
                onChange={(event) => setAnimationNarration(event.target.value)}
                rows={3}
                placeholder="Narration, pacing notes, or the emotional arc for the animation."
                className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[var(--text-sm)] leading-[1.5] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </div>
          ) : null}

          {/* CTA */}
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating}
            className="w-full h-10 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {creating ? t('create.creating') : t('create.cta')}
          </button>
        </div>
      </div>
    </div>
  );
}
