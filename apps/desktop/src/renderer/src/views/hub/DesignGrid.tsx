import { useT } from '@open-codesign/i18n';
import type { Design } from '@open-codesign/shared';
import { Copy, FileText, FolderInput, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { type MouseEvent, useEffect, useState } from 'react';
import { useCodesignStore } from '../../store';
import { DesignCardPreview } from './DesignCardPreview';

export interface DesignGridProps {
  designs: Design[];
  emptyLabel: string;
  prefixTile?: React.ReactNode;
  mode?: 'project' | 'template';
  showFolderActions?: boolean;
  templateIds?: Set<string>;
  onSetTemplate?: (designId: string, next: boolean) => void;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `${diffD}d`;
  const diffMo = Math.round(diffD / 30);
  if (diffMo < 12) return `${diffMo}mo`;
  return `${Math.round(diffMo / 12)}y`;
}

interface MenuPos {
  x: number;
  y: number;
  design: Design;
  showFolderPicker?: boolean;
}

function useMenu() {
  const [pos, setPos] = useState<MenuPos | null>(null);
  useEffect(() => {
    if (!pos) return;
    function onDown(e: MouseEvent | Event) {
      const target = (e as MouseEvent).target as Node | null;
      const menu = document.getElementById('design-card-menu');
      if (menu && target && !menu.contains(target)) setPos(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPos(null);
    }
    window.addEventListener('mousedown', onDown as EventListener, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown as EventListener, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos]);
  return { pos, open: setPos, close: () => setPos(null) };
}

export function DesignGrid({
  designs,
  emptyLabel,
  prefixTile,
  mode = 'project',
  showFolderActions = true,
  templateIds,
  onSetTemplate,
}: DesignGridProps) {
  const t = useT();
  const switchDesign = useCodesignStore((s) => s.switchDesign);
  const duplicateDesign = useCodesignStore((s) => s.duplicateDesign);
  const setView = useCodesignStore((s) => s.setView);
  const requestRenameDesign = useCodesignStore((s) => s.requestRenameDesign);
  const requestDeleteDesign = useCodesignStore((s) => s.requestDeleteDesign);
  const folders = useCodesignStore((s) => s.folders);
  const moveDesignToFolder = useCodesignStore((s) => s.moveDesignToFolder);
  const { pos, open, close } = useMenu();

  if (designs.length === 0 && !prefixTile) {
    return (
      <div className="flex flex-col items-center justify-center py-[var(--space-12)] text-center">
        <div className="mb-[var(--space-4)] flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-[var(--color-border)]">
          <FileText className="h-5 w-5 text-[var(--color-text-muted)]" aria-hidden />
        </div>
        <p className="max-w-[var(--size-prose-narrow)] text-[var(--text-sm)] leading-[var(--leading-body)] text-[var(--color-text-muted)]">
          {emptyLabel}
        </p>
      </div>
    );
  }

  async function handlePrimaryAction(design: Design): Promise<void> {
    if (mode === 'template') {
      const cloned = await duplicateDesign(design.id);
      if (!cloned) return;
      await switchDesign(cloned.id);
      setView('workspace');
      return;
    }
    await switchDesign(design.id);
    setView('workspace');
  }

  function onCardContextMenu(e: MouseEvent, design: Design) {
    e.preventDefault();
    e.stopPropagation();
    open({ x: e.clientX, y: e.clientY, design });
  }

  const selectedTemplateIds = templateIds ?? new Set<string>();
  const activeIsTemplate = pos ? selectedTemplateIds.has(pos.design.id) : false;

  return (
    <>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[var(--space-6)] p-0">
        {prefixTile ? <li>{prefixTile}</li> : null}
        {designs.map((d) => {
          const updated = formatRelativeTime(d.updatedAt);
          const isTemplate = selectedTemplateIds.has(d.id);
          return (
            <li key={d.id}>
              <div
                className="group relative flex flex-col gap-[var(--space-3)]"
                onContextMenu={(e) => onCardContextMenu(e, d)}
              >
                <button
                  type="button"
                  onClick={() => {
                    void handlePrimaryAction(d);
                  }}
                  aria-label={
                    mode === 'template'
                      ? t('hub.templates.useAria', { name: d.name })
                      : t('hub.your.openAria', { name: d.name })
                  }
                  className="absolute inset-0 z-[1] rounded-[var(--radius-lg)] text-left focus-visible:outline-none"
                >
                  <span className="sr-only">{d.name}</span>
                </button>

                <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-background-secondary)] transition-[transform,border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] group-hover:-translate-y-[2px] group-hover:border-[var(--color-border)] group-hover:shadow-[var(--shadow-card)] focus-within:ring-2 focus-within:ring-[var(--color-focus-ring)]">
                  <DesignCardPreview design={d} />
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    open({ x: rect.right, y: rect.bottom, design: d });
                  }}
                  aria-label={t('hub.card.moreActions', { name: d.name })}
                  className="absolute top-[var(--space-2)] right-[var(--space-2)] z-[3] inline-flex h-[28px] w-[28px] items-center justify-center rounded-full border border-[var(--color-border-muted)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] opacity-0 shadow-[var(--shadow-soft)] transition-opacity hover:text-[var(--color-text-primary)] group-hover:opacity-100"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </button>

                <div className="relative z-[2] flex flex-col gap-[2px] px-[2px]">
                  <div className="flex items-center gap-2">
                    <span
                      className="truncate text-[var(--text-md)] tracking-[var(--tracking-tight)] text-[var(--color-text-primary)]"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                    >
                      {d.name}
                    </span>
                    {isTemplate ? (
                      <span className="shrink-0 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-[8px] py-[2px] text-[9px] uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
                        {t('hub.templates.savedBadge')}
                      </span>
                    ) : null}
                  </div>
                  {updated ? (
                    <span
                      className="text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]"
                      style={{ fontFamily: 'var(--font-mono)', fontFeatureSettings: "'tnum'" }}
                    >
                      {updated} ago
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {pos ? (
        <div
          id="design-card-menu"
          role="menu"
          className="fixed z-50 min-w-[190px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-[var(--space-1)] shadow-[var(--shadow-elevated)]"
          style={{
            left: Math.min(pos.x, window.innerWidth - 210),
            top: Math.min(pos.y, window.innerHeight - 240),
          }}
        >
          {pos.showFolderPicker ? (
            <>
              <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-[var(--space-3)] py-[var(--space-2)]">
                <button
                  type="button"
                  onClick={() => open({ ...pos, showFolderPicker: false })}
                  className="text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
                <span className="text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)]">
                  {t('hub.card.moveToFolder')}
                </span>
              </div>
              {pos.design.folderId ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void moveDesignToFolder(pos.design.id, null);
                    close();
                  }}
                  className="w-full px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  {t('hub.card.noFolder')}
                </button>
              ) : null}
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void moveDesignToFolder(pos.design.id, folder.id);
                    close();
                  }}
                  className={`flex w-full items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] transition-colors hover:bg-[var(--color-surface-hover)] ${
                    pos.design.folderId === folder.id
                      ? 'font-medium text-[var(--color-accent)]'
                      : 'text-[var(--color-text-primary)]'
                  }`}
                >
                  <span className="truncate">{folder.name}</span>
                  {pos.design.folderId === folder.id ? (
                    <span className="ml-auto text-[10px] text-[var(--color-accent)]">
                      {t('hub.card.currentFolder')}
                    </span>
                  ) : null}
                </button>
              ))}
              {folders.length === 0 ? (
                <p className="px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-xs)] text-[var(--color-text-muted)]">
                  {t('hub.card.noFolders')}
                </p>
              ) : null}
            </>
          ) : (
            <>
              {mode === 'template' ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void handlePrimaryAction(pos.design);
                    close();
                  }}
                  className="flex w-full items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  <Copy className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" aria-hidden />
                  {t('hub.card.useTemplate')}
                </button>
              ) : null}

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  requestRenameDesign(pos.design);
                  close();
                }}
                className="flex w-full items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                <Pencil className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" aria-hidden />
                {t('hub.card.rename')}
              </button>

              {mode !== 'template' && showFolderActions ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => open({ ...pos, showFolderPicker: true })}
                  className="flex w-full items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  <FolderInput className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" aria-hidden />
                  {t('hub.card.moveToFolder')}
                </button>
              ) : null}

              {onSetTemplate ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSetTemplate(pos.design.id, !activeIsTemplate);
                    close();
                  }}
                  className="flex w-full items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                >
                  <FileText className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" aria-hidden />
                  {activeIsTemplate ? t('hub.card.removeFromTemplates') : t('hub.card.saveAsTemplate')}
                </button>
              ) : null}

              <div className="my-[var(--space-1)] border-t border-[var(--color-border-subtle)]" />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  requestDeleteDesign(pos.design);
                  close();
                }}
                className="flex w-full items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-error)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {t('hub.card.delete')}
              </button>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
