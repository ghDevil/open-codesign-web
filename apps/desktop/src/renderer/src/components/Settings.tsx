import { useT } from '@open-codesign/i18n';
import { AlertCircle, Cpu, FolderOpen, Image as ImageIcon, Palette, Sliders } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCodesignStore } from '../store';
import { AdvancedTab } from './settings/AdvancedTab';
import { AppearanceTab } from './settings/AppearanceTab';
import { DiagnosticsPanel } from './settings/DiagnosticsPanel';
import { ImageGenerationTab } from './settings/ImageGenerationTab';
import { ModelsTab } from './settings/ModelsTab';
import { StorageTab } from './settings/StorageTab';

export { resolveTimeoutOptions, TIMEOUT_OPTION_SECONDS } from './settings/AdvancedTab';
// Re-exports so Settings.test.ts keeps its public entry points. The actual
// implementations live in the per-tab modules.
export { applyLocaleChange } from './settings/AppearanceTab';
export { computeModelOptions } from './settings/primitives';

type Tab = 'models' | 'images' | 'appearance' | 'storage' | 'diagnostics' | 'advanced';

const TABS: ReadonlyArray<{ id: Tab; icon: typeof Cpu }> = [
  { id: 'models', icon: Cpu },
  { id: 'images', icon: ImageIcon },
  { id: 'appearance', icon: Palette },
  { id: 'storage', icon: FolderOpen },
  { id: 'diagnostics', icon: AlertCircle },
  { id: 'advanced', icon: Sliders },
];

export function Settings() {
  const t = useT();
  const initialTab = useCodesignStore((s) => s.settingsTab);
  const clearSettingsTab = useCodesignStore((s) => s.clearSettingsTab);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'models');

  // Consume the store hint exactly once on mount so future Settings opens
  // start on whatever the user last selected manually.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    if (initialTab) clearSettingsTab();
  }, []);

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)]">
      <div className="flex-1 grid grid-cols-[11rem_1fr] min-h-0">
        <aside className="bg-[var(--color-background-secondary)] border-r border-[var(--color-border)] p-[var(--space-3)]">
          <nav className="space-y-0.5">
            {TABS.map((entry) => {
              const Icon = entry.icon;
              const active = tab === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={`relative w-full flex items-center gap-2 pl-[var(--space-3)] pr-[var(--space-2)] py-[var(--space-2)] rounded-[var(--radius-md)] text-[var(--text-sm)] transition-[background-color,color,transform] duration-[var(--duration-faster)] active:scale-[var(--scale-press-down)] ${
                    active
                      ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)] font-medium before:absolute before:left-0 before:top-[var(--space-1_5)] before:bottom-[var(--space-1_5)] before:w-[var(--size-accent-stripe)] before:rounded-full before:bg-[var(--color-accent)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {t(`settings.tabs.${entry.id}`)}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="flex flex-col min-h-0 overflow-y-auto p-[var(--space-6)]">
          {tab === 'models' ? <ModelsTab /> : null}
          {tab === 'images' ? <ImageGenerationTab /> : null}
          {tab === 'appearance' ? <AppearanceTab /> : null}
          {tab === 'storage' ? <StorageTab /> : null}
          {tab === 'diagnostics' ? <DiagnosticsPanel /> : null}
          {tab === 'advanced' ? <AdvancedTab /> : null}
        </section>
      </div>
    </div>
  );
}
