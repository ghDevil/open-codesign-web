import { useT } from '@open-codesign/i18n';
import type { Design } from '@open-codesign/shared';
import { FileText, FolderInput, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { type MouseEvent, useEffect, useState } from 'react';
import { useCodesignStore } from '../../store';
import { DesignCardPreview } from './DesignCardPreview';

export interface DesignGridProps {
  designs: Design[];
  emptyLabel: string;
  /** Optional tile rendered as the first cell of the grid (e.g. "+ New design"). */
  prefixTile?: React.ReactNode;
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

export function DesignGrid({ designs, emptyLabel, prefixTile }: DesignGridProps) {
  const t = useT();
  const switchDesign = useCodesignStore((s) => s.switchDesign);
  const setView = useCodesignStore((s) => s.setView);
  const requestRenameDesign = useCodesignStore((s) => s.requestRenameDesign);
  const requestDeleteDesign = useCodesignStore((s) => s.requestDeleteDesign);
  const folders = useCodesignStore((s) => s.folders);
  const moveDesignToFolder = useCodesignStore((s) => s.moveDesignToFolder);
  const { pos, open, close } = useMenu();

  if (designs.length === 0 && !prefixTile) {
    return (
      <div className="flex flex-col items-center justify-center py-[var(--space-12)] text-center">
        <div className="w-12 h-12 rounded-full border border-dashed border-[var(--color-border)] flex items-center justify-center mb-[var(--space-4)]">
          <FileText className="w-5 h-5 text-[var(--color-text-muted)]" aria-hidden />
        </div>
        <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] max-w-[var(--size-prose-narrow)] leading-[var(--leading-body)]">
          {emptyLabel}
        </p>
      </div>
    );
  }

  function onCardContextMenu(e: MouseEvent, design: Design) {
    e.preventDefault();
    e.stopPropagation();
    open({ x: e.clientX, y: e.clientY, design });
  }

  return (
    <>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[var(--space-6)] list-none p-0 m-0">
        {prefixTile ? <li>{prefixTile}</li> : null}
        {designs.map((d) => {
          const updated = formatRelativeTime(d.updatedAt);
          return (
            <li key={d.id}>
              <div
                className="group relative flex flex-col gap-[var(--space-3)]"
                onContextMenu={(e) => onCardContextMenu(e, d)}
              >
                <button
                  type="button"
                  onClick={async () => {
                    await switchDesign(d.id);
                    setView('workspace');
                  }}
                  aria-label={t('hub.your.openAria', { name: d.name })}
                  className="absolute inset-0 z-[1] text-left focus-visible:outline-none rounded-[var(--radius-lg)]"
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
                  className="absolute top-[var(--space-2)] right-[var(--space-2)] z-[3] opacity-0 group-hover:opacity-100 transition-opacity rounded-full w-[28px] h-[28px] inline-flex items-center justify-center bg-[var(--color-surface)] border border-[var(--color-border-muted)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]"
                >
                  <MoreHorizontal className="w-4 h-4" aria-hidden />
                </button>

                <div className="relative z-[2] flex flex-col gap-[2px] px-[2px]">
                  <span
                    className="truncate text-[var(--text-md)] text-[var(--color-text-primary)] tracking-[var(--tracking-tight)]"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                  >
                    {d.name}
                  </span>
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
          className="fixed z-50 min-w-[180px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-elevated)] py-[var(--space-1)] overflow-hidden"
          style={{
            left: Math.min(pos.x, window.innerWidth - 200),
            top: Math.min(pos.y, window.innerHeight - 200),
          }}
        >
          {pos.showFolderPicker ? (
            <>
              <div className="flex items-center gap-2 px-[var(--space-3)] py-[var(--space-2)] border-b border-[var(--color-border-subtle)]">
                <button
                  type="button"
                  onClick={() => open({ ...pos, showFolderPicker: false })}
                  className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  <X className="w-3.5 h-3.5" aria-hidden />
                </button>
                <span className="text-[var(--text-xs)] font-medium text-[var(--color-text-secondary)]">
                  Move to folder
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
                  className="w-full flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  No folder
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
                  className={`w-full flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] hover:bg-[var(--color-surface-hover)] transition-colors ${
                    pos.design.folderId === folder.id
                      ? 'text-[var(--color-accent)] font-medium'
                      : 'text-[var(--color-text-primary)]'
                  }`}
                >
                  {folder.name}
                  {pos.design.folderId === folder.id ? (
                    <span className="ml-auto text-[var(--color-accent)]">✓</span>
                  ) : null}
                </button>
              ))}
              {folders.length === 0 ? (
                <p className="px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-xs)] text-[var(--color-text-muted)]">
                  No folders yet
                </p>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  requestRenameDesign(pos.design);
                  close();
                }}
                className="w-full flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" aria-hidden />
                {t('hub.card.rename')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => open({ ...pos, showFolderPicker: true })}
                className="w-full flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <FolderInput className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" aria-hidden />
                Move to folder
              </button>
              <div className="my-[var(--space-1)] border-t border-[var(--color-border-subtle)]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  requestDeleteDesign(pos.design);
                  close();
                }}
                className="w-full flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] text-left text-[var(--text-xs)] text-[var(--color-error)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden />
                {t('hub.card.delete')}
              </button>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
