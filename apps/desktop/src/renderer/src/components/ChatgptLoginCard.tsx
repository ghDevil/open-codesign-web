import { Button } from '@open-codesign/ui';
import { Loader2, LogOut, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { CodexOAuthStatus } from '../../../preload/index';
import { useCodesignStore } from '../store';

export interface ChatgptLoginCardProps {
  /** Called after a successful login or logout so the parent can refresh its provider list. */
  onStatusChange?: () => void | Promise<void>;
}

export type ChatgptViewState = 'not-logged-in' | 'loading' | 'logged-in';

export function resolveViewState(
  status: CodexOAuthStatus | null,
  loading: boolean,
): ChatgptViewState {
  if (loading) return 'loading';
  if (status?.loggedIn) return 'logged-in';
  return 'not-logged-in';
}

interface CodexOAuthApi {
  status(): Promise<CodexOAuthStatus>;
  login(): Promise<CodexOAuthStatus>;
  logout(): Promise<CodexOAuthStatus>;
}

type PushToastLike = (toast: { variant: 'error'; title: string; description?: string }) => unknown;

export interface PerformLoginDeps {
  api: CodexOAuthApi;
  setStatus: (s: CodexOAuthStatus) => void;
  setLoading: (v: boolean) => void;
  pushToast: PushToastLike;
  onStatusChange?: () => void | Promise<void>;
}

export async function performLogin(deps: PerformLoginDeps): Promise<void> {
  deps.setLoading(true);
  try {
    const next = await deps.api.login();
    deps.setStatus(next);
    await deps.onStatusChange?.();
  } catch (err) {
    deps.pushToast({
      variant: 'error',
      title: 'ChatGPT 登录失败',
      description: err instanceof Error ? err.message : '未知错误',
    });
  } finally {
    deps.setLoading(false);
  }
}

export interface PerformLogoutDeps {
  api: CodexOAuthApi;
  setStatus: (s: CodexOAuthStatus) => void;
  pushToast: PushToastLike;
  confirm: (message: string) => boolean;
  onStatusChange?: () => void | Promise<void>;
}

export async function performLogout(deps: PerformLogoutDeps): Promise<boolean> {
  if (!deps.confirm('确定登出 ChatGPT 订阅吗？')) return false;
  try {
    const next = await deps.api.logout();
    deps.setStatus(next);
    await deps.onStatusChange?.();
    return true;
  } catch (err) {
    deps.pushToast({
      variant: 'error',
      title: 'ChatGPT 登出失败',
      description: err instanceof Error ? err.message : '未知错误',
    });
    return false;
  }
}

export function ChatgptLoginCard({ onStatusChange }: ChatgptLoginCardProps) {
  const pushToast = useCodesignStore((s) => s.pushToast);
  const [status, setStatus] = useState<CodexOAuthStatus | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!window.codesign) return;
    let cancelled = false;
    void window.codesign.codexOAuth
      .status()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = useCallback(async () => {
    if (!window.codesign) return;
    await performLogin({
      api: window.codesign.codexOAuth,
      setStatus,
      setLoading,
      pushToast,
      ...(onStatusChange !== undefined ? { onStatusChange } : {}),
    });
  }, [onStatusChange, pushToast]);

  const handleLogout = useCallback(async () => {
    if (!window.codesign) return;
    await performLogout({
      api: window.codesign.codexOAuth,
      setStatus,
      pushToast,
      confirm: (message) => window.confirm(message),
      ...(onStatusChange !== undefined ? { onStatusChange } : {}),
    });
  }, [onStatusChange, pushToast]);

  const viewState = resolveViewState(status, loading);

  if (viewState === 'logged-in' && status) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] border-l-[var(--size-accent-stripe)] border-l-[var(--color-accent)] bg-[var(--color-accent-tint)] px-[var(--space-3)] py-[var(--space-2_5)] flex items-center gap-[var(--space-3)]">
        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-[var(--color-accent)] text-[var(--color-accent)] bg-transparent text-[var(--font-size-badge)] font-medium leading-none">
            <Sparkles className="w-2.5 h-2.5" />
            已登录 ChatGPT
          </span>
          {status.email !== null && status.email.length > 0 && (
            <span className="text-[var(--text-xs)] text-[var(--color-text-muted)] truncate">
              {status.email}
            </span>
          )}
        </div>
        <div className="shrink-0">
          <Button variant="secondary" size="sm" onClick={() => void handleLogout()}>
            <LogOut className="w-3.5 h-3.5" />
            登出
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2_5)] flex items-start gap-[var(--space-3)]">
      <div className="min-w-0 flex-1">
        <div className="text-[var(--text-sm)] font-medium text-[var(--color-text-primary)]">
          用 ChatGPT 订阅登录
        </div>
        <p className="text-[var(--text-xs)] text-[var(--color-text-muted)] mt-0.5 leading-[var(--leading-body)]">
          登录后可以直接用你的 ChatGPT Plus/Pro/Team 订阅额度调用 Codex 模型（gpt-5.3-codex
          等），无需 API key。
        </p>
      </div>
      <div className="shrink-0">
        {viewState === 'loading' ? (
          <Button variant="primary" size="sm" disabled>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            已打开浏览器，完成授权后自动返回…
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => void handleLogin()}>
            <Sparkles className="w-3.5 h-3.5" />用 ChatGPT 订阅登录
          </Button>
        )}
      </div>
    </div>
  );
}
