import { useT } from '@open-codesign/i18n';
import type { LocalizedExample } from '@open-codesign/templates';
import { getCurrentLocale, useTranslation } from '@open-codesign/i18n';
import { getExamples, type ExampleCategory } from '@open-codesign/templates';
import { useMemo, useRef, useState } from 'react';
import { useCodesignStore } from '../store';
import { DesignSystemsTab } from './hub/DesignSystemsTab';
import { DesignGrid } from './hub/DesignGrid';
import { ExampleCard } from './hub/ExampleCard';
import { ChevronRight, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';

export interface HubViewProps {
  onUseExamplePrompt?: (prompt: string) => void;
}

type HubSection = 'home' | 'examples' | 'designSystems';

const EXAMPLE_FILTERS: Array<'all' | ExampleCategory> = [
  'all', 'ui', 'dashboard', 'marketing', 'mobile', 'animation', 'presentation', 'document', 'email',
];

function FolderSection({
  id,
  name,
  designs,
}: {
  id: string;
  name: string;
  designs: import('@open-codesign/shared').Design[];
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const renameFolder = useCodesignStore((s) => s.renameFolder);
  const deleteFolder = useCodesignStore((s) => s.deleteFolder);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setEditName(name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 30);
  }

  async function commitEdit() {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== name) await renameFolder(id, trimmed);
    setEditing(false);
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="inline-flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <ChevronRight
            className={`w-4 h-4 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
            aria-hidden
          />
        </button>

        {editing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => void commitEdit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="flex-1 h-6 px-1 rounded border border-[var(--color-accent)] bg-[var(--color-surface)] text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] focus:outline-none"
            autoFocus
          />
        ) : (
          <span
            className="text-[var(--text-sm)] font-medium text-[var(--color-text-secondary)] uppercase tracking-[0.06em] cursor-default select-none"
            onDoubleClick={startEdit}
          >
            {name}
          </span>
        )}

        <span className="text-[var(--text-xs)] text-[var(--color-text-muted)]">
          {designs.length}
        </span>

        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            title="Rename folder"
          >
            <Pencil className="w-3 h-3" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void deleteFolder(id)}
            className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors"
            title="Delete folder"
          >
            <Trash2 className="w-3 h-3" aria-hidden />
          </button>
        </div>
      </div>

      {!collapsed ? (
        designs.length === 0 ? (
          <p className="pl-6 text-[var(--text-xs)] text-[var(--color-text-muted)] italic">
            Empty folder
          </p>
        ) : (
          <div className="pl-6">
            <DesignGrid designs={designs} emptyLabel="" />
          </div>
        )
      ) : null}
    </div>
  );
}

export function HubView({ onUseExamplePrompt }: HubViewProps = {}) {
  const t = useT();
  const { i18n } = useTranslation();
  const hubTab = useCodesignStore((s) => s.hubTab);
  const setHubTab = useCodesignStore((s) => s.setHubTab);
  const designs = useCodesignStore((s) => s.designs);
  const folders = useCodesignStore((s) => s.folders);
  const openNewDesignDialog = useCodesignStore((s) => s.openNewDesignDialog);
  const createFolder = useCodesignStore((s) => s.createFolder);
  const loadFolders = useCodesignStore((s) => s.loadFolders);
  const isGenerating = useCodesignStore(
    (s) => s.isGenerating && s.generatingDesignId === s.currentDesignId,
  );

  const [exampleFilter, setExampleFilter] = useState<'all' | ExampleCategory>('all');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const examples = useMemo(() => getExamples(i18n.language || getCurrentLocale()), [i18n.language]);
  const visibleExamples = exampleFilter === 'all' ? examples : examples.filter((e) => e.category === exampleFilter);

  const allDesigns = [...designs]
    .filter((d) => d.deletedAt === null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const unfolderedDesigns = allDesigns.filter((d) => !d.folderId);

  // Map old tab names to new sections
  const section: HubSection =
    hubTab === 'examples' ? 'examples' :
    hubTab === 'designSystems' ? 'designSystems' :
    'home';

  const newDesignTile = (
    <button
      type="button"
      onClick={() => openNewDesignDialog()}
      disabled={isGenerating}
      aria-label={t('hub.newDesign')}
      className="group relative flex w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="relative w-full aspect-[4/3] flex flex-col items-center justify-center gap-[var(--space-4)] rounded-[var(--radius-lg)] border-[1.5px] border-dashed border-[var(--color-border)] bg-[linear-gradient(135deg,var(--color-background-secondary)_0%,var(--color-accent-soft)_100%)] transition-[transform,border-color] duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:-translate-y-[2px] group-hover:border-[var(--color-accent)] group-disabled:translate-y-0 group-disabled:border-[var(--color-border)] overflow-hidden">
        <span
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,var(--color-accent-soft)_0%,transparent_60%)] opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--duration-base)]"
        />
        <span className="relative inline-flex items-center justify-center w-[56px] h-[56px] rounded-full bg-[var(--color-surface)] border border-[var(--color-border-muted)] text-[var(--color-accent)] shadow-[var(--shadow-soft)] group-hover:scale-110 group-hover:shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out)]">
          <Plus className="w-[24px] h-[24px]" strokeWidth={2} aria-hidden />
        </span>
        <div className="relative flex flex-col items-center gap-[var(--space-1)] px-[var(--space-4)] text-center">
          <span
            className="text-[var(--text-md)] text-[var(--color-text-primary)] tracking-[var(--tracking-tight)]"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
          >
            {t('hub.newDesignCardTitle')}
          </span>
          <span className="text-[11px] text-[var(--color-text-muted)] leading-[var(--leading-ui)]">
            {t('hub.newDesignCardSub')}
          </span>
        </div>
      </div>
    </button>
  );

  async function handleCreateFolder() {
    const name = newFolderName.trim() || 'New folder';
    await createFolder(name);
    await loadFolders();
    setCreatingFolder(false);
    setNewFolderName('');
  }

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)] overflow-hidden">
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] px-[var(--space-8)] py-[var(--space-8)]">

          {/* HOME section */}
          {section === 'home' ? (
            <div className="flex flex-col gap-[var(--space-10)]">
              <section className="flex flex-col gap-[var(--space-5)]">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h1
                      className="text-[28px] leading-[1.2] tracking-[-0.02em] text-[var(--color-text-primary)]"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                    >
                      {t('hub.home.greeting')}
                    </h1>
                    <p className="mt-1 text-[var(--text-sm)] text-[var(--color-text-secondary)]">
                      {t('hub.home.subtitle')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openNewDesignDialog()}
                    disabled={isGenerating}
                    className="shrink-0 inline-flex items-center gap-[var(--space-2)] h-9 px-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    <Plus className="w-4 h-4" aria-hidden />
                    {t('hub.newDesign')}
                  </button>
                </div>
              </section>

              <section className="flex flex-col gap-[var(--space-4)]">
                {allDesigns.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <h2 className="text-[var(--text-sm)] font-medium text-[var(--color-text-secondary)] uppercase tracking-[0.06em]">
                        {t('hub.home.recentLabel')}
                      </h2>
                      {allDesigns.length > 6 ? (
                        <button
                          type="button"
                          onClick={() => setHubTab('your')}
                          className="text-[var(--text-xs)] text-[var(--color-accent)] hover:opacity-80 transition-opacity"
                        >
                          {t('hub.home.seeAll')} ({allDesigns.length})
                        </button>
                      ) : null}
                    </div>
                    <DesignGrid
                      designs={allDesigns.slice(0, 6)}
                      emptyLabel=""
                      prefixTile={newDesignTile}
                    />
                  </>
                ) : (
                  <DesignGrid
                    designs={[]}
                    emptyLabel={t('hub.recent.empty')}
                    prefixTile={newDesignTile}
                  />
                )}
              </section>

              <section className="flex flex-col gap-[var(--space-4)]">
                <div className="flex items-center justify-between">
                  <h2 className="text-[var(--text-sm)] font-medium text-[var(--color-text-secondary)] uppercase tracking-[0.06em]">
                    {t('hub.home.startFromLabel')}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setHubTab('examples')}
                    className="text-[var(--text-xs)] text-[var(--color-accent)] hover:opacity-80 transition-opacity"
                  >
                    {t('hub.home.browseAll')}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-2 lg:grid-cols-4">
                  {examples.slice(0, 4).map((example) => (
                    <ExampleCard
                      key={example.id}
                      example={example}
                      onUsePrompt={(ex: LocalizedExample) => onUseExamplePrompt?.(ex.prompt)}
                    />
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {/* YOUR DESIGNS — full list with folders */}
          {hubTab === 'your' ? (
            <div className="flex flex-col gap-[var(--space-8)]">
              <div className="flex items-center gap-4">
                <h1
                  className="text-[28px] leading-[1.2] tracking-[-0.02em] text-[var(--color-text-primary)] flex-1"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                >
                  {t('hub.tabs.your')}
                </h1>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingFolder(true);
                    setNewFolderName('');
                  }}
                  className="inline-flex items-center gap-[var(--space-2)] h-9 px-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-text-secondary)] text-[var(--text-sm)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  <FolderPlus className="w-4 h-4" aria-hidden />
                  New folder
                </button>
                <button
                  type="button"
                  onClick={() => openNewDesignDialog()}
                  disabled={isGenerating}
                  className="inline-flex items-center gap-[var(--space-2)] h-9 px-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  <Plus className="w-4 h-4" aria-hidden />
                  {t('hub.newDesign')}
                </button>
              </div>

              {/* New folder creation row */}
              {creatingFolder ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Folder name"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreateFolder();
                      if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); }
                    }}
                    className="h-9 px-3 rounded-[var(--radius-md)] border border-[var(--color-accent)] bg-[var(--color-surface)] text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none w-64"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateFolder()}
                    className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-[var(--text-sm)] font-medium hover:opacity-90 transition-opacity"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCreatingFolder(false); setNewFolderName(''); }}
                    className="h-9 px-3 rounded-[var(--radius-md)] text-[var(--color-text-secondary)] text-[var(--text-sm)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}

              {/* Folder sections */}
              {folders.map((folder) => {
                const folderDesigns = allDesigns.filter((d) => d.folderId === folder.id);
                return (
                  <div key={folder.id} className="group flex flex-col gap-[var(--space-3)]">
                    <FolderSection
                      id={folder.id}
                      name={folder.name}
                      designs={folderDesigns}
                    />
                  </div>
                );
              })}

              {/* Unfoldered designs */}
              {unfolderedDesigns.length > 0 || folders.length === 0 ? (
                <div className="flex flex-col gap-[var(--space-4)]">
                  {folders.length > 0 ? (
                    <h2 className="text-[var(--text-sm)] font-medium text-[var(--color-text-secondary)] uppercase tracking-[0.06em]">
                      Uncategorized
                    </h2>
                  ) : null}
                  <DesignGrid
                    designs={unfolderedDesigns}
                    emptyLabel={t('hub.your.empty')}
                    prefixTile={folders.length === 0 ? newDesignTile : undefined}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {/* EXAMPLES */}
          {section === 'examples' ? (
            <div className="flex flex-col gap-[var(--space-6)]">
              <div>
                <h1
                  className="text-[28px] leading-[1.2] tracking-[-0.02em] text-[var(--color-text-primary)]"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                >
                  {t('examples.title')}
                </h1>
                <p className="mt-1 text-[var(--text-sm)] text-[var(--color-text-secondary)]">
                  {t('examples.subtitle')}
                </p>
              </div>

              <div className="flex flex-wrap gap-[var(--space-2)]">
                {EXAMPLE_FILTERS.map((id) => {
                  const active = id === exampleFilter;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setExampleFilter(id)}
                      className={`
                        rounded-full border px-[var(--space-3)] py-[6px]
                        text-[var(--text-xs)] leading-[var(--leading-ui)] transition-colors duration-[var(--duration-fast)]
                        ${active
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-background)]'
                          : 'border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
                        }
                      `}
                    >
                      {t(`examples.categories.${id}`)}
                    </button>
                  );
                })}
              </div>

              {visibleExamples.length === 0 ? (
                <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] py-[var(--space-8)] text-center">
                  {t('examples.empty')}
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleExamples.map((example) => (
                    <ExampleCard
                      key={example.id}
                      example={example}
                      onUsePrompt={(ex: LocalizedExample) => onUseExamplePrompt?.(ex.prompt)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* DESIGN SYSTEMS */}
          {section === 'designSystems' ? (
            <div className="flex flex-col gap-[var(--space-6)]">
              <div>
                <h1
                  className="text-[28px] leading-[1.2] tracking-[-0.02em] text-[var(--color-text-primary)]"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                >
                  {t('hub.tabs.designSystems')}
                </h1>
                <p className="mt-1 text-[var(--text-sm)] text-[var(--color-text-secondary)]">
                  {t('hub.designSystems.subtitle')}
                </p>
              </div>
              <DesignSystemsTab />
            </div>
          ) : null}

        </div>
      </main>
    </div>
  );
}
