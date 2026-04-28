import { useT } from '@open-codesign/i18n';
import { IconButton, Wordmark } from '@open-codesign/ui';
import { AlertCircle, ArrowLeft, BookOpen, Home, Layers, Settings as SettingsIcon } from 'lucide-react';
import { type CSSProperties, useEffect } from 'react';
import { type HubTab, useCodesignStore } from '../store';
import { LanguageToggle } from './LanguageToggle';
import { ModelSwitcher } from './ModelSwitcher';
import { ThemeToggle } from './ThemeToggle';

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

interface NavItem {
  tab: HubTab;
  icon: typeof Home;
  labelKey: string;
}

const NAV_ITEMS: NavItem[] = [
  { tab: 'recent', icon: Home, labelKey: 'hub.nav.home' },
  { tab: 'examples', icon: BookOpen, labelKey: 'hub.nav.examples' },
  { tab: 'designSystems', icon: Layers, labelKey: 'hub.nav.designSystems' },
];

export function TopBar() {
  const t = useT();
  const setView = useCodesignStore((s) => s.setView);
  const view = useCodesignStore((s) => s.view);
  const previousView = useCodesignStore((s) => s.previousView);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const currentDesign = designs.find((d) => d.id === currentDesignId);
  const hubTab = useCodesignStore((s) => s.hubTab);
  const setHubTab = useCodesignStore((s) => s.setHubTab);
  const unreadErrorCount = useCodesignStore((s) => s.unreadErrorCount);
  const refreshDiagnosticEvents = useCodesignStore((s) => s.refreshDiagnosticEvents);
  const openSettingsTab = useCodesignStore((s) => s.openSettingsTab);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    void refreshDiagnosticEvents();
  }, []);

  return (
    <header
      className="h-[var(--size-titlebar-height)] shrink-0 flex items-center justify-between select-none"
      style={{
        ...dragStyle,
        paddingLeft: 'var(--space-5)',
        paddingRight: 'var(--space-5)',
        borderBottom: '1px solid var(--color-border-subtle)',
        background: 'var(--color-background)',
      }}
    >
      {/* Left: logo + context nav */}
      <div className="flex items-center gap-[var(--space-6)] min-w-0 h-full" style={noDragStyle}>
        <Wordmark badge={`v${__APP_VERSION__}`} size="md" />

        {view === 'settings' ? (
          <button
            type="button"
            onClick={() => setView(previousView === 'settings' ? 'hub' : previousView)}
            aria-label={t('topbar.closeSettings')}
            className="inline-flex items-center gap-[6px] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            style={{ fontFamily: 'var(--font-display)', fontSize: '15px', letterSpacing: '-0.01em' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
            {t('topbar.settingsLabel')}
          </button>
        ) : view === 'hub' ? (
          <nav className="flex items-center gap-[2px] h-full" aria-label="Main navigation">
            {NAV_ITEMS.map(({ tab, icon: Icon, labelKey }) => {
              const active = tab === hubTab || (tab === 'recent' && (hubTab === 'recent' || hubTab === 'your'));
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setHubTab(tab)}
                  aria-current={active ? 'page' : undefined}
                  className={`
                    relative h-8 inline-flex items-center gap-[6px] px-[10px] rounded-[var(--radius-sm)]
                    text-[13px] transition-colors duration-[var(--duration-faster)]
                    ${active
                      ? 'bg-[var(--color-surface)] text-[var(--color-text-primary)] font-medium'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                    }
                  `}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  {t(labelKey)}
                </button>
              );
            })}
          </nav>
        ) : (
          /* workspace: show breadcrumb "Home / Design name" */
          <div className="flex items-center gap-[var(--space-2)] text-[13px]">
            <button
              type="button"
              onClick={() => setView('hub')}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
              {t('hub.nav.home')}
            </button>
            <span className="text-[var(--color-border)]">/</span>
            <span
              className="text-[var(--color-text-primary)] font-medium truncate max-w-[400px]"
              title={currentDesign?.name ?? ''}
            >
              {currentDesign?.name ?? t('sidebar.noDesign')}
            </span>
          </div>
        )}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-[var(--space-2)]" style={noDragStyle}>
        <ModelSwitcher variant="topbar" />
        {unreadErrorCount > 0 ? (
          <button
            type="button"
            onClick={() => openSettingsTab('diagnostics')}
            aria-label={t('topbar.unreadErrors', { count: unreadErrorCount })}
            title={t('topbar.unreadErrors', { count: unreadErrorCount })}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-[var(--radius-sm)] border border-[var(--color-error)]/30 text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors"
          >
            <AlertCircle className="w-3.5 h-3.5" aria-hidden />
            <span className="text-[11px] font-semibold">
              {unreadErrorCount > 99 ? '99+' : unreadErrorCount}
            </span>
          </button>
        ) : null}
        <div className="flex items-center gap-[1px]">
          <LanguageToggle />
          <ThemeToggle />
          <IconButton label={t('settings.title')} size="md" onClick={() => setView('settings')}>
            <SettingsIcon className="w-[16px] h-[16px]" />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
