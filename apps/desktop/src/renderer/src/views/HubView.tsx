import { useT, getCurrentLocale, useTranslation } from '@open-codesign/i18n';
import type { Design } from '@open-codesign/shared';
import { getExamples, type ExampleCategory, type LocalizedExample } from '@open-codesign/templates';
import { ChevronRight, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { readTemplateDesignIds, writeTemplateDesignFlag } from '../lib/template-library';
import { useCodesignStore } from '../store';
import { DesignSystemsTab } from './hub/DesignSystemsTab';
import { DesignGrid } from './hub/DesignGrid';
import { ExampleCard } from './hub/ExampleCard';

export interface HubViewProps {
  onUseExamplePrompt?: (prompt: string) => void;
}

type HubSection = 'home' | 'projects' | 'templates' | 'designSystems';

const EXAMPLE_FILTERS: Array<'all' | ExampleCategory> = [
  'all',
  'ui',
  'dashboard',
  'marketing',
  'mobile',
  'animation',
  'presentation',
  'document',
  'email',
];

function FolderSection({
  id,
  name,
  designs,
  templateIds,
  onSetTemplate,
}: {
  id: string;
  name: string;
  designs: Design[];
  templateIds: Set<string>;
  onSetTemplate: (designId: string, next: boolean) => void;
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
          className="inline-flex items-center gap-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-secondary)]"
        >
          <ChevronRight
            className={`h-4 w-4 transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
            aria-hidden
          />
        </button>

        {editing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => {
              void commitEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="h-6 flex-1 rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1 text-[var(--text-sm)] font-medium text-[var(--color-text-primary)] focus:outline-none"
            autoFocus
          />
        ) : (
          <span
            className="cursor-default select-none text-[var(--text-sm)] font-medium uppercase tracking-[0.06em] text-[var(--color-text-secondary)]"
            onDoubleClick={startEdit}
          >
            {name}
          </span>
        )}

        <span className="text-[var(--text-xs)] text-[var(--color-text-muted)]">{designs.length}</span>

        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100">
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            title={t('hub.projects.renameFolder')}
          >
            <Pencil className="h-3 w-3" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => {
              void deleteFolder(id);
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-error)]"
            title={t('hub.projects.deleteFolder')}
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
        </div>
      </div>

      {!collapsed ? (
        designs.length === 0 ? (
          <p className="pl-6 text-[var(--text-xs)] italic text-[var(--color-text-muted)]">
            {t('hub.projects.emptyFolder')}
          </p>
        ) : (
          <div className="pl-6">
            <DesignGrid
              designs={designs}
              emptyLabel=""
              templateIds={templateIds}
              onSetTemplate={onSetTemplate}
            />
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
  const [templateIds, setTemplateIds] = useState<Set<string>>(() => new Set(readTemplateDesignIds()));
  const examples = useMemo(() => getExamples(i18n.language || getCurrentLocale()), [i18n.language]);
  const visibleExamples =
    exampleFilter === 'all' ? examples : examples.filter((e) => e.category === exampleFilter);

  const allDesigns = useMemo(
    () =>
      [...designs]
        .filter((d) => d.deletedAt === null)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [designs],
  );

  useEffect(() => {
    const validIds = new Set(allDesigns.map((design) => design.id));
    setTemplateIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [allDesigns]);

  function handleSetTemplate(designId: string, next: boolean): void {
    writeTemplateDesignFlag(designId, next);
    setTemplateIds((current) => {
      const updated = new Set(current);
      if (next) {
        updated.add(designId);
      } else {
        updated.delete(designId);
      }
      return updated;
    });
  }

  const projectDesigns = allDesigns.filter((design) => !templateIds.has(design.id));
  const savedTemplates = allDesigns.filter((design) => templateIds.has(design.id));
  const unfolderedProjectDesigns = projectDesigns.filter((design) => !design.folderId);

  const section: HubSection =
    hubTab === 'your'
      ? 'projects'
      : hubTab === 'templates' || hubTab === 'examples'
        ? 'templates'
        : hubTab === 'designSystems'
          ? 'designSystems'
          : 'home';

  const newDesignTile = (
    <button
      type="button"
      onClick={() => openNewDesignDialog()}
      disabled={isGenerating}
      aria-label={t('hub.newDesign')}
      className="group relative flex w-full text-left disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-[var(--space-4)] overflow-hidden rounded-[var(--radius-lg)] border-[1.5px] border-dashed border-[var(--color-border)] bg-[linear-gradient(135deg,var(--color-background-secondary)_0%,var(--color-accent-soft)_100%)] transition-[transform,border-color] duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:-translate-y-[2px] group-hover:border-[var(--color-accent)] group-disabled:translate-y-0 group-disabled:border-[var(--color-border)]">
        <span
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,var(--color-accent-soft)_0%,transparent_60%)] opacity-0 transition-opacity duration-[var(--duration-base)] group-hover:opacity-100"
        />
        <span className="relative inline-flex h-[56px] w-[56px] items-center justify-center rounded-full border border-[var(--color-border-muted)] bg-[var(--color-surface)] text-[var(--color-accent)] shadow-[var(--shadow-soft)] transition-[transform,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:scale-110 group-hover:shadow-[var(--shadow-card)]">
          <Plus className="h-[24px] w-[24px]" strokeWidth={2} aria-hidden />
        </span>
        <div className="relative flex flex-col items-center gap-[var(--space-1)] px-[var(--space-4)] text-center">
          <span
            className="text-[var(--text-md)] tracking-[var(--tracking-tight)] text-[var(--color-text-primary)]"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
          >
            {t('hub.newDesignCardTitle')}
          </span>
          <span className="text-[11px] leading-[var(--leading-ui)] text-[var(--color-text-muted)]">
            {t('hub.newDesignCardSub')}
          </span>
        </div>
      </div>
    </button>
  );

  async function handleCreateFolder() {
    const name = newFolderName.trim() || t('hub.projects.newFolderFallback');
    await createFolder(name);
    await loadFolders();
    setCreatingFolder(false);
    setNewFolderName('');
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-background)]">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] px-[var(--space-8)] py-[var(--space-8)]">
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
                    className="inline-flex h-9 shrink-0 items-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--space-4)] text-[var(--text-sm)] font-medium text-[var(--color-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    {t('hub.newDesign')}
                  </button>
                </div>
              </section>

              <section className="flex flex-col gap-[var(--space-4)]">
                {projectDesigns.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <h2 className="text-[var(--text-sm)] font-medium uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
                        {t('hub.home.recentLabel')}
                      </h2>
                      {projectDesigns.length > 6 ? (
                        <button
                          type="button"
                          onClick={() => setHubTab('your')}
                          className="text-[var(--text-xs)] text-[var(--color-accent)] transition-opacity hover:opacity-80"
                        >
                          {t('hub.home.seeAll')} ({projectDesigns.length})
                        </button>
                      ) : null}
                    </div>
                    <DesignGrid
                      designs={projectDesigns.slice(0, 6)}
                      emptyLabel=""
                      prefixTile={newDesignTile}
                      templateIds={templateIds}
                      onSetTemplate={handleSetTemplate}
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
                  <h2 className="text-[var(--text-sm)] font-medium uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
                    {t('hub.home.startFromLabel')}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setHubTab('templates')}
                    className="text-[var(--text-xs)] text-[var(--color-accent)] transition-opacity hover:opacity-80"
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

          {section === 'projects' ? (
            <div className="flex flex-col gap-[var(--space-8)]">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <h1
                    className="text-[28px] leading-[1.2] tracking-[-0.02em] text-[var(--color-text-primary)]"
                    style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                  >
                    {t('hub.tabs.your')}
                  </h1>
                  <p className="mt-1 text-[var(--text-sm)] text-[var(--color-text-secondary)]">
                    {t('hub.projects.subtitle')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingFolder(true);
                    setNewFolderName('');
                  }}
                  className="inline-flex h-9 items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--color-border)] px-[var(--space-3)] text-[var(--text-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                >
                  <FolderPlus className="h-4 w-4" aria-hidden />
                  {t('hub.projects.newFolder')}
                </button>
                <button
                  type="button"
                  onClick={() => openNewDesignDialog()}
                  disabled={isGenerating}
                  className="inline-flex h-9 items-center gap-[var(--space-2)] rounded-[var(--radius-md)] bg-[var(--color-accent)] px-[var(--space-4)] text-[var(--text-sm)] font-medium text-[var(--color-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {t('hub.newDesign')}
                </button>
              </div>

              {creatingFolder ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder={t('hub.projects.newFolderPlaceholder')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreateFolder();
                      if (e.key === 'Escape') {
                        setCreatingFolder(false);
                        setNewFolderName('');
                      }
                    }}
                    className="h-9 w-64 rounded-[var(--radius-md)] border border-[var(--color-accent)] bg-[var(--color-surface)] px-3 text-[var(--text-sm)] text-[var(--color-text-primary)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void handleCreateFolder();
                    }}
                    className="h-9 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3 text-[var(--text-sm)] font-medium text-[var(--color-on-accent)] transition-opacity hover:opacity-90"
                  >
                    {t('hub.projects.createFolder')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingFolder(false);
                      setNewFolderName('');
                    }}
                    className="h-9 rounded-[var(--radius-md)] px-3 text-[var(--text-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              ) : null}

              {folders.map((folder) => {
                const folderDesigns = projectDesigns.filter((design) => design.folderId === folder.id);
                return (
                  <div key={folder.id} className="group flex flex-col gap-[var(--space-3)]">
                    <FolderSection
                      id={folder.id}
                      name={folder.name}
                      designs={folderDesigns}
                      templateIds={templateIds}
                      onSetTemplate={handleSetTemplate}
                    />
                  </div>
                );
              })}

              {unfolderedProjectDesigns.length > 0 || folders.length === 0 ? (
                <div className="flex flex-col gap-[var(--space-4)]">
                  {folders.length > 0 ? (
                    <h2 className="text-[var(--text-sm)] font-medium uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
                      {t('hub.projects.uncategorized')}
                    </h2>
                  ) : null}
                  <DesignGrid
                    designs={unfolderedProjectDesigns}
                    emptyLabel={t('hub.your.empty')}
                    prefixTile={folders.length === 0 ? newDesignTile : undefined}
                    templateIds={templateIds}
                    onSetTemplate={handleSetTemplate}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {section === 'templates' ? (
            <div className="flex flex-col gap-[var(--space-8)]">
              <div>
                <h1
                  className="text-[28px] leading-[1.2] tracking-[-0.02em] text-[var(--color-text-primary)]"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                >
                  {t('hub.tabs.templates')}
                </h1>
                <p className="mt-1 text-[var(--text-sm)] text-[var(--color-text-secondary)]">
                  {t('hub.templates.subtitle')}
                </p>
              </div>

              <section className="flex flex-col gap-[var(--space-4)]">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-[var(--text-sm)] font-medium uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
                      {t('hub.templates.savedTitle')}
                    </h2>
                    <p className="mt-1 text-[var(--text-xs)] text-[var(--color-text-muted)]">
                      {t('hub.templates.savedHint')}
                    </p>
                  </div>
                </div>
                <DesignGrid
                  designs={savedTemplates}
                  emptyLabel={t('hub.templates.savedEmpty')}
                  mode="template"
                  showFolderActions={false}
                  templateIds={templateIds}
                  onSetTemplate={handleSetTemplate}
                />
              </section>

              <section className="flex flex-col gap-[var(--space-4)]">
                <div>
                  <h2 className="text-[var(--text-sm)] font-medium uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
                    {t('hub.templates.startersTitle')}
                  </h2>
                  <p className="mt-1 text-[var(--text-xs)] text-[var(--color-text-muted)]">
                    {t('hub.templates.startersHint')}
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
                        className={`rounded-full border px-[var(--space-3)] py-[6px] text-[var(--text-xs)] leading-[var(--leading-ui)] transition-colors duration-[var(--duration-fast)] ${
                          active
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-background)]'
                            : 'border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]'
                        }`}
                      >
                        {t(`examples.categories.${id}`)}
                      </button>
                    );
                  })}
                </div>

                {visibleExamples.length === 0 ? (
                  <p className="py-[var(--space-8)] text-center text-[var(--text-sm)] text-[var(--color-text-muted)]">
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
              </section>
            </div>
          ) : null}

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
