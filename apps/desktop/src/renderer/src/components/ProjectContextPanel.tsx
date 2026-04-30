import { useT } from '@open-codesign/i18n';
import { FileCode2, Folder, FolderOpen, Layers, Link2, Paperclip, Plus, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DesignSystemLibraryItem } from '../../../preload';
import {
  clearSelectedDesignSystemId,
  readSelectedDesignSystemId,
  writeSelectedDesignSystemId,
} from '../lib/design-system-selection';
import { ensureAnimationContext, readDesignIntent, writeDesignIntent } from '../lib/design-intent';
import { workspacePathComparisonKey } from '../lib/workspace-path';
import { useCodesignStore } from '../store';

function ContextSection(props: {
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { title, hint, actions, children } = props;
  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-[var(--space-4)] py-[var(--space-3)]">
        <div className="min-w-0">
          <h3 className="m-0 text-[12px] font-medium text-[var(--color-text-primary)]">{title}</h3>
          {hint ? (
            <p className="mt-1 mb-0 text-[11px] leading-[1.45] text-[var(--color-text-muted)]">
              {hint}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className="px-[var(--space-4)] py-[var(--space-3)]">{children}</div>
    </section>
  );
}

export function ProjectContextPanel() {
  const t = useT();
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const inputFiles = useCodesignStore((s) => s.inputFiles);
  const removeInputFile = useCodesignStore((s) => s.removeInputFile);
  const pickInputFiles = useCodesignStore((s) => s.pickInputFiles);
  const referenceUrl = useCodesignStore((s) => s.referenceUrl);
  const setReferenceUrl = useCodesignStore((s) => s.setReferenceUrl);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const generatingDesignId = useCodesignStore((s) => s.generatingDesignId);
  const requestWorkspaceRebind = useCodesignStore((s) => s.requestWorkspaceRebind);
  const pushToast = useCodesignStore((s) => s.pushToast);
  const setView = useCodesignStore((s) => s.setView);
  const setHubTab = useCodesignStore((s) => s.setHubTab);
  const currentDesign = designs.find((d) => d.id === currentDesignId) ?? null;
  const designIntent = currentDesignId ? readDesignIntent(currentDesignId) : null;
  const animationContext = ensureAnimationContext(designIntent?.animation);

  const [folderExists, setFolderExists] = useState<boolean | null>(null);
  const [instructionsDraft, setInstructionsDraft] = useState(currentDesign?.projectInstructions ?? '');
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [designSystemBusy, setDesignSystemBusy] = useState(false);
  const [designSystems, setDesignSystems] = useState<DesignSystemLibraryItem[]>([]);
  const [defaultDesignSystemId, setDefaultDesignSystemId] = useState<string | null>(null);

  const workspacePath = currentDesign?.workspacePath ?? null;
  const isCurrentDesignGenerating = isGenerating && generatingDesignId === currentDesignId;
  const selectedDesignSystemId = currentDesignId
    ? readSelectedDesignSystemId(currentDesignId)
    : null;
  const normalizedReferenceUrl = referenceUrl.trim();
  const isFigmaReference = /https?:\/\/(?:www\.)?figma\.com\/(?:file|design)\//i.test(
    normalizedReferenceUrl,
  );

  const effectiveDesignSystem = useMemo(() => {
    const selected = designSystems.find((item) => item.id === selectedDesignSystemId);
    if (selected) return selected;
    return designSystems.find((item) => item.id === defaultDesignSystemId) ?? null;
  }, [defaultDesignSystemId, designSystems, selectedDesignSystemId]);

  useEffect(() => {
    setInstructionsDraft(currentDesign?.projectInstructions ?? '');
  }, [currentDesign?.projectInstructions, currentDesignId]);

  useEffect(() => {
    if (!workspacePath || !currentDesignId) {
      setFolderExists(null);
      return;
    }
    window.codesign?.snapshots
      .checkWorkspaceFolder?.(currentDesignId)
      .then((result) => setFolderExists(result.exists))
      .catch(() => setFolderExists(null));
  }, [currentDesignId, workspacePath]);

  useEffect(() => {
    const api = window.codesign?.designSystems;
    if (!api) return;
    void api
      .list()
      .then((result) => {
        setDesignSystems(result.items ?? []);
        setDefaultDesignSystemId(result.activeId ?? null);
      })
      .catch(() => {
        setDesignSystems([]);
        setDefaultDesignSystemId(null);
      });
  }, []);

  async function refreshDesignSystems(): Promise<void> {
    const api = window.codesign?.designSystems;
    if (!api) return;
    setDesignSystemBusy(true);
    try {
      const result = await api.list();
      setDesignSystems(result.items ?? []);
      setDefaultDesignSystemId(result.activeId ?? null);
    } finally {
      setDesignSystemBusy(false);
    }
  }

  async function handleSaveInstructions(): Promise<void> {
    if (!currentDesignId || !window.codesign?.snapshots.setProjectInstructions) return;
    try {
      setSavingInstructions(true);
      const updated = await window.codesign.snapshots.setProjectInstructions(
        currentDesignId,
        instructionsDraft.trim().length > 0 ? instructionsDraft.trim() : null,
      );
      useCodesignStore.setState((state) => ({
        designs: state.designs.map((design) => (design.id === updated.id ? updated : design)),
      }));
      pushToast({ variant: 'success', title: t('canvas.projectInstructions.saved') });
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('canvas.projectInstructions.saveFailed'),
        description: err instanceof Error ? err.message : t('errors.unknown'),
      });
    } finally {
      setSavingInstructions(false);
    }
  }

  async function handleBindWorkspace(): Promise<void> {
    if (!window.codesign?.snapshots.pickWorkspaceFolder || !currentDesign || !currentDesignId) return;
    if (isCurrentDesignGenerating) {
      pushToast({ variant: 'info', title: t('canvas.workspace.busyGenerating') });
      return;
    }

    try {
      const path = await window.codesign.snapshots.pickWorkspaceFolder();
      if (!path) return;

      if (
        currentDesign.workspacePath &&
        workspacePathComparisonKey(currentDesign.workspacePath) !== workspacePathComparisonKey(path)
      ) {
        requestWorkspaceRebind(currentDesign, path);
        return;
      }

      if (currentDesign.workspacePath === null) {
        await window.codesign.snapshots.updateWorkspace(currentDesignId, path, false);
        const updated = await window.codesign.snapshots.listDesigns();
        useCodesignStore.setState({ designs: updated });
      }
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('canvas.workspace.updateFailed'),
        description: err instanceof Error ? err.message : t('errors.unknown'),
      });
    }
  }

  async function handleOpenWorkspace(): Promise<void> {
    if (!currentDesignId || !window.codesign?.snapshots.openWorkspaceFolder) return;
    try {
      await window.codesign.snapshots.openWorkspaceFolder(currentDesignId);
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('canvas.workspace.updateFailed'),
        description: err instanceof Error ? err.message : t('errors.unknown'),
      });
    }
  }

  function handleOpenDesignSystems(): void {
    setHubTab('designSystems');
    setView('hub');
  }

  function handleSelectDesignSystem(value: string): void {
    if (!currentDesignId) return;
    if (value === '') {
      clearSelectedDesignSystemId(currentDesignId);
    } else {
      writeSelectedDesignSystemId(currentDesignId, value);
    }
    useCodesignStore.setState((state) => ({ ...state }));
  }

  const instructionsDirty =
    instructionsDraft.trim() !== (currentDesign?.projectInstructions ?? '').trim();

  function updateAnimationIntent(
    patch: Partial<ReturnType<typeof ensureAnimationContext>>,
  ): void {
    if (!currentDesignId) return;
    const nextIntent = {
      ...(designIntent ?? { kind: 'animation' as const }),
      kind: 'animation' as const,
      animation: ensureAnimationContext({
        ...animationContext,
        ...patch,
      }),
    };
    writeDesignIntent(currentDesignId, nextIntent);
    useCodesignStore.setState((state) => ({ ...state }));
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-4)]">
      <div className="space-y-1">
        <h2 className="m-0 text-[14px] font-medium text-[var(--color-text-primary)]">
          {t('sidebar.contextPanel.title')}
        </h2>
        <p className="m-0 text-[12px] leading-[1.5] text-[var(--color-text-muted)]">
          {t('sidebar.contextPanel.subtitle')}
        </p>
      </div>

      <ContextSection
        title={t('canvas.projectInstructions.title')}
        hint={t('canvas.projectInstructions.hint')}
        actions={
          <button
            type="button"
            onClick={() => void handleSaveInstructions()}
            disabled={!instructionsDirty || savingInstructions || isCurrentDesignGenerating}
            className="inline-flex h-7 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[var(--space-2_5)] text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingInstructions ? t('common.loading') : t('canvas.projectInstructions.save')}
          </button>
        }
      >
        <textarea
          value={instructionsDraft}
          onChange={(event) => setInstructionsDraft(event.target.value)}
          placeholder={t('canvas.projectInstructions.placeholder')}
          className="min-h-[120px] w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-[var(--space-3)] py-[var(--space-3)] text-[12px] leading-[1.55] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </ContextSection>

      <ContextSection
        title={t('sidebar.localContext')}
        hint={t('sidebar.contextPanel.filesHint')}
        actions={
          <button
            type="button"
            onClick={() => void pickInputFiles()}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[var(--space-2_5)] text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            <Plus className="size-3.5" aria-hidden />
            {t('sidebar.attachLocalFiles')}
          </button>
        }
      >
        {inputFiles.length > 0 ? (
          <div className="space-y-2">
            {inputFiles.map((file) => (
              <div
                key={file.path}
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-background)] px-[var(--space-3)] py-[var(--space-2)]"
              >
                <Paperclip className="size-3.5 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-[var(--color-text-primary)]">{file.name}</div>
                  <div className="truncate text-[10px] text-[var(--color-text-muted)]">{file.path}</div>
                </div>
                <button
                  type="button"
                  onClick={() => removeInputFile(file.path)}
                  aria-label={t('sidebar.removeFile', { name: file.name })}
                  className="inline-flex size-6 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-[12px] text-[var(--color-text-muted)]">
            {t('sidebar.contextPanel.filesEmpty')}
          </p>
        )}
      </ContextSection>

      <ContextSection
        title={t('canvas.workspace.sectionTitle')}
        hint={t('sidebar.contextPanel.workspaceHint')}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleBindWorkspace()}
              disabled={isCurrentDesignGenerating}
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[var(--space-2_5)] text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Folder className="size-3.5" aria-hidden />
              {workspacePath ? t('canvas.workspace.change') : t('canvas.workspace.choose')}
            </button>
            {workspacePath ? (
              <button
                type="button"
                onClick={() => void handleOpenWorkspace()}
                className="inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                title={t('canvas.workspace.open')}
              >
                <FolderOpen className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        }
      >
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-background)] px-[var(--space-3)] py-[var(--space-2_5)]">
          <FileCode2 className="mt-[2px] size-3.5 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
          <div className="min-w-0">
            <div
              className="truncate text-[12px] text-[var(--color-text-primary)]"
              title={workspacePath ?? undefined}
            >
              {workspacePath || t('canvas.workspace.default')}
            </div>
            {folderExists === false ? (
              <div className="mt-1 text-[10px] text-[var(--color-text-warning,_theme(colors.amber.500))]">
                {t('canvas.workspace.unavailable')}
              </div>
            ) : null}
          </div>
        </div>
      </ContextSection>

      <ContextSection title={t('sidebar.referenceUrl')} hint={t('sidebar.contextPanel.referenceHint')}>
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-[var(--space-3)]">
          <Link2 className="size-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
          <input
            type="url"
            value={referenceUrl}
            onChange={(event) => setReferenceUrl(event.target.value)}
            placeholder={t('sidebar.referenceUrl')}
            className="h-10 flex-1 min-w-0 bg-transparent text-[12px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
          />
          {referenceUrl.trim() ? (
            <button
              type="button"
              onClick={() => setReferenceUrl('')}
              className="inline-flex size-6 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              aria-label={t('sidebar.clear')}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        {isFigmaReference ? (
          <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-background)] px-[var(--space-3)] py-[var(--space-2_5)] text-[11px] leading-[1.5] text-[var(--color-text-secondary)]">
            Figma mode is active for this design. On the next run, the app will extract the frame structure, visible copy, screenshot, and design-system cues before generating.
          </div>
        ) : null}
      </ContextSection>

      <ContextSection
        title={t('hub.designSystems.title')}
        hint={t('sidebar.contextPanel.designSystemHint')}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshDesignSystems()}
              className="inline-flex size-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              title={t('sidebar.contextPanel.refresh')}
            >
              <RefreshCw className={`size-3.5 ${designSystemBusy ? 'animate-spin' : ''}`} aria-hidden />
            </button>
            <button
              type="button"
              onClick={handleOpenDesignSystems}
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[var(--space-2_5)] text-[11px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            >
              <Layers className="size-3.5" aria-hidden />
              {t('sidebar.contextPanel.manage')}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-background)] px-[var(--space-3)] py-[var(--space-2_5)]">
            <div className="text-[10px] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
              {t('sidebar.contextPanel.current')}
            </div>
            <div className="mt-1 text-[12px] text-[var(--color-text-primary)]">
              {effectiveDesignSystem ? effectiveDesignSystem.name : t('sidebar.contextPanel.none')}
            </div>
            {effectiveDesignSystem ? (
              <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                {selectedDesignSystemId ? t('sidebar.contextPanel.pinnedToDesign') : t('sidebar.contextPanel.usingDefault')}
              </div>
            ) : null}
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-[0.04em] text-[var(--color-text-muted)]">
              {t('sidebar.contextPanel.selection')}
            </span>
            <select
              value={selectedDesignSystemId ?? ''}
              onChange={(event) => handleSelectDesignSystem(event.target.value)}
              className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-[var(--space-3)] text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              <option value="">{t('sidebar.contextPanel.useDefault')}</option>
              {designSystems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </ContextSection>

      {designIntent?.kind === 'animation' ? (
        <ContextSection
          title="Animation settings"
          hint="Keep timing, framing, and motion direction in one place so the AI and Remotion preview stay aligned."
        >
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
                Aspect ratio
                <select
                  value={animationContext.aspectRatio}
                  onChange={(event) =>
                    updateAnimationIntent({
                      aspectRatio: event.target.value as typeof animationContext.aspectRatio,
                    })
                  }
                  className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-[var(--space-3)] text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
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
                  value={animationContext.motionStyle}
                  onChange={(event) =>
                    updateAnimationIntent({
                      motionStyle: event.target.value as typeof animationContext.motionStyle,
                    })
                  }
                  className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-[var(--space-3)] text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                >
                  <option value="cinematic">Cinematic</option>
                  <option value="snappy">Snappy</option>
                  <option value="calm">Calm</option>
                  <option value="playful">Playful</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
                Duration (seconds)
                <input
                  type="number"
                  min={2}
                  max={120}
                  value={Math.max(1, Math.round(animationContext.durationInFrames / animationContext.fps))}
                  onChange={(event) => {
                    const seconds = Math.max(2, Math.min(120, Number(event.target.value) || 6));
                    updateAnimationIntent({
                      durationInFrames: seconds * animationContext.fps,
                    });
                  }}
                  className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-[var(--space-3)] text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </label>
              <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
                FPS
                <select
                  value={animationContext.fps}
                  onChange={(event) => {
                    const fps = Number(event.target.value);
                    const seconds = Math.max(
                      2,
                      Math.round(animationContext.durationInFrames / animationContext.fps),
                    );
                    updateAnimationIntent({
                      fps,
                      durationInFrames: seconds * fps,
                    });
                  }}
                  className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-[var(--space-3)] text-[12px] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                >
                  {[24, 30, 60].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="grid gap-1 text-[11px] text-[var(--color-text-muted)]">
              Narration or pacing notes
              <textarea
                value={animationContext.narration ?? ''}
                onChange={(event) =>
                  updateAnimationIntent({
                    narration: event.target.value.trim().length > 0 ? event.target.value : undefined,
                  })
                }
                rows={4}
                placeholder="What should the animation build toward? Mention voiceover beats, reveals, or emotional pacing."
                className="min-h-[96px] w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-background)] px-[var(--space-3)] py-[var(--space-3)] text-[12px] leading-[1.55] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </label>
          </div>
        </ContextSection>
      ) : null}
    </div>
  );
}
