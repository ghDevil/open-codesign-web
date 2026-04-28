import { useT } from '@open-codesign/i18n';
import { Button } from '@open-codesign/ui';
import { Bot, Loader2, LogOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCodesignStore } from '../store';

export interface CopilotAuthStatus {
  loggedIn: boolean;
  login: string | null;
  host: string | null;
  expiresAt: number | null;
}

interface CopilotOAuthApi {
  status(): Promise<CopilotAuthStatus>;
  login(): Promise<CopilotAuthStatus>;
  logout(): Promise<CopilotAuthStatus>;
}

type PushToastLike = (toast: { variant: 'error'; title: string; description?: string }) => unknown;

export interface CopilotLoginCardProps {
  onStatusChange?: () => void | Promise<void>;
}

function getCopilotOAuthApi(): CopilotOAuthApi | null {
  const codesign = window.codesign as (typeof window.codesign & {
    copilotOAuth?: CopilotOAuthApi;
  }) | null;
  return codesign?.copilotOAuth ?? null;
}

async function fetchStatus(
  api: CopilotOAuthApi,
  setStatus: (status: CopilotAuthStatus | null) => void,
  pushToast: PushToastLike,
  isMounted: () => boolean,
  strings: { failedTitle: string; unknownError: string },
): Promise<void> {
  try {
    const next = await api.status();
    if (isMounted()) setStatus(next);
  } catch (err) {
    if (!isMounted()) return;
    setStatus(null);
    pushToast({
      variant: 'error',
      title: strings.failedTitle,
      description: err instanceof Error ? err.message : strings.unknownError,
    });
  }
}

export function CopilotLoginCard({ onStatusChange }: CopilotLoginCardProps) {
  const t = useT();
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [status, setStatus] = useState<CopilotAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const api = getCopilotOAuthApi();
    if (api === null) return;
    void fetchStatus(api, setStatus, pushToast, () => mountedRef.current, {
      failedTitle: t('settings.providers.copilotLogin.statusFailedTitle'),
      unknownError: t('settings.providers.copilotLogin.unknownError'),
    });
  }, [pushToast, t]);

  const handleLogin = useCallback(async () => {
    const api = getCopilotOAuthApi();
    if (api === null) return;
    setLoading(true);
    try {
      const next = await api.login();
      if (mountedRef.current) setStatus(next);
      await onStatusChange?.();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.copilotLogin.loginFailedTitle'),
        description:
          err instanceof Error ? err.message : t('settings.providers.copilotLogin.unknownError'),
      });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [onStatusChange, pushToast, t]);

  const handleLogout = useCallback(async () => {
    const api = getCopilotOAuthApi();
    if (api === null) return;
    if (!window.confirm(t('settings.providers.copilotLogin.confirmLogout'))) return;
    try {
      const next = await api.logout();
      if (mountedRef.current) setStatus(next);
      await onStatusChange?.();
    } catch (err) {
      pushToast({
        variant: 'error',
        title: t('settings.providers.copilotLogin.logoutFailedTitle'),
        description:
          err instanceof Error ? err.message : t('settings.providers.copilotLogin.unknownError'),
      });
    }
  }, [onStatusChange, pushToast, t]);

  const api = getCopilotOAuthApi();
  if (api === null) return null;

  if (status?.loggedIn) {
    const identity = status.login ?? status.host;
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] border-l-[var(--size-accent-stripe)] border-l-[var(--color-accent)] bg-[var(--color-accent-tint)] px-[var(--space-3)] py-[var(--space-2_5)] flex items-center gap-[var(--space-3)]">
        <div className="min-w-0 flex-1 flex items-center gap-[var(--space-2)] flex-wrap">
          <span className="inline-flex items-center gap-[var(--space-1)] px-[var(--space-1_5)] py-[var(--space-0_5)] rounded-full border border-[var(--color-accent)] text-[var(--color-accent)] bg-transparent text-[var(--font-size-badge)] font-medium leading-none">
            <Bot className="w-[var(--size-icon-xs)] h-[var(--size-icon-xs)]" />
            {t('settings.providers.copilotLogin.loggedInBadge')}
          </span>
          {identity !== null && identity.length > 0 && (
            <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] truncate">
              {identity}
            </span>
          )}
        </div>
        <div className="shrink-0">
          <Button variant="secondary" size="sm" onClick={() => void handleLogout()}>
            <LogOut className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)]" />
            {t('settings.providers.copilotLogin.logout')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2_5)] flex items-start gap-[var(--space-3)]">
      <div className="min-w-0 flex-1">
        <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
          {t('settings.providers.copilotLogin.title')}
        </div>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-[var(--space-0_5)] leading-[var(--leading-body)]">
          {t('settings.providers.copilotLogin.description')}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-[var(--space-2)]">
        <Button variant="primary" size="sm" onClick={() => void handleLogin()} disabled={loading}>
          {loading ? (
            <Loader2 className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)] animate-spin" />
          ) : (
            <Bot className="w-[var(--size-icon-sm)] h-[var(--size-icon-sm)]" />
          )}
          {loading
            ? t('settings.providers.copilotLogin.inProgress')
            : t('settings.providers.copilotLogin.signIn')}
        </Button>
      </div>
    </div>
  );
}