import { useT } from '@open-codesign/i18n';
import type { LocalInputFile, OnboardingState } from '@open-codesign/shared';
import { useEffect, useRef, useState } from 'react';
import { useAgentStream } from '../hooks/useAgentStream';
import { useCodesignStore } from '../store';
import { ModelSwitcher } from './ModelSwitcher';
import { ProjectContextPanel } from './ProjectContextPanel';
import { ChatMessageList } from './chat/ChatMessageList';
import { ClarificationCard } from './chat/ClarificationCard';
import { CommentChipBar } from './chat/CommentChipBar';
import { EmptyState } from './chat/EmptyState';
import { PromptInput, type PromptInputHandle } from './chat/PromptInput';

export interface SidebarProps {
  prompt: string;
  setPrompt: (value: string) => void;
  onSubmit: () => void;
}

interface ComposerContextItem {
  key: string;
  label: string;
  icon: 'file' | 'url' | 'workspace' | 'designSystem';
  actionLabel?: string;
}

export function buildComposerContextItems(input: {
  inputFiles: LocalInputFile[];
  referenceUrl: string;
  workspacePath?: string | null;
  config: OnboardingState | null;
}): ComposerContextItem[] {
  const items: ComposerContextItem[] = input.inputFiles.map((file) => ({
    key: `file:${file.path}`,
    label: file.name,
    icon: 'file',
    actionLabel: file.path,
  }));

  const referenceUrl = input.referenceUrl.trim();
  if (referenceUrl.length > 0) {
    const isFigmaReference = /https?:\/\/(?:www\.)?figma\.com\/(?:file|design)\//i.test(referenceUrl);
    items.push({
      key: 'reference-url',
      label: isFigmaReference ? 'Figma frame reference' : referenceUrl,
      icon: 'url',
      actionLabel: referenceUrl,
    });
  }

  const workspacePath = input.workspacePath?.trim() ?? '';
  if (workspacePath.length > 0) {
    items.push({
      key: 'workspace-path',
      label: workspacePath,
      icon: 'workspace',
      actionLabel: workspacePath,
    });
  }

  const designSystem = input.config?.designSystem ?? null;
  if (designSystem) {
    items.push({
      key: 'design-system',
      label: designSystem.summary,
      icon: 'designSystem',
      actionLabel: designSystem.rootPath,
    });
  }

  return items;
}

export function Sidebar({ prompt, setPrompt, onSubmit }: SidebarProps) {
  const t = useT();
  const isGenerating = useCodesignStore(
    (s) => s.isGenerating && s.generatingDesignId === s.currentDesignId,
  );
  const cancelGeneration = useCodesignStore((s) => s.cancelGeneration);
  const lastUsage = useCodesignStore((s) => s.lastUsage);
  const chatMessages = useCodesignStore((s) => s.chatMessages);
  const chatLoaded = useCodesignStore((s) => s.chatLoaded);
  const isClarifying = useCodesignStore((s) => s.isClarifying);
  const pendingClarification = useCodesignStore((s) => s.pendingClarification);
  const streamingAssistantText = useCodesignStore((s) => s.streamingAssistantText);
  const pendingToolCalls = useCodesignStore((s) => s.pendingToolCalls);
  const loadChatForCurrentDesign = useCodesignStore((s) => s.loadChatForCurrentDesign);
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const designs = useCodesignStore((s) => s.designs);
  const submitPendingClarification = useCodesignStore((s) => s.submitPendingClarification);
  const skipPendingClarification = useCodesignStore((s) => s.skipPendingClarification);
  const [sidebarPane, setSidebarPane] = useState<'chat' | 'context'>('chat');

  useAgentStream();

  const promptInputRef = useRef<PromptInputHandle>(null);
  const handlePickStarter = (starterPrompt: string): void => {
    setPrompt(starterPrompt);
    promptInputRef.current?.focus();
  };

  const currentDesign = designs.find((d) => d.id === currentDesignId) ?? null;
  const activeClarification =
    pendingClarification && pendingClarification.designId === currentDesignId
      ? pendingClarification
      : null;

  useEffect(() => {
    if (currentDesignId && !chatLoaded) {
      void loadChatForCurrentDesign();
    }
  }, [currentDesignId, chatLoaded, loadChatForCurrentDesign]);

  const lastTokens = lastUsage ? lastUsage.inputTokens + lastUsage.outputTokens : null;

  return (
    <aside
      className="flex h-full flex-col overflow-x-hidden border-r border-[var(--color-border)] bg-[var(--color-background-secondary)]"
      style={{ minHeight: 0, minWidth: 0 }}
      aria-label={t('sidebar.ariaLabel')}
    >
      <div className="shrink-0 border-b border-[var(--color-border-subtle)] px-[var(--space-4)] py-[var(--space-3)]">
        <div className="space-y-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
              {currentDesign?.name ?? t('sidebar.noDesign')}
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {sidebarPane === 'chat'
                ? t('sidebar.contextPanel.chatMode')
                : t('sidebar.contextPanel.contextMode')}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
            {(['chat', 'context'] as const).map((pane) => {
              const active = sidebarPane === pane;
              const label =
                pane === 'chat'
                  ? t('sidebar.contextPanel.chatTab')
                  : t('sidebar.contextPanel.contextTab');
              return (
                <button
                  key={pane}
                  type="button"
                  onClick={() => setSidebarPane(pane)}
                  aria-pressed={active}
                  className={`h-8 rounded-[var(--radius-sm)] text-[12px] font-medium transition-colors ${
                    active
                      ? 'bg-[var(--color-background)] text-[var(--color-text-primary)] shadow-[var(--shadow-soft)]'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {sidebarPane === 'chat' ? (
        <>
          <div className="flex-1 overflow-y-auto px-[var(--space-4)] py-[var(--space-4)]">
            <ChatMessageList
              messages={chatMessages}
              loading={!chatLoaded}
              isGenerating={isGenerating}
              pendingToolCalls={pendingToolCalls}
              streamingText={
                streamingAssistantText && streamingAssistantText.designId === currentDesignId
                  ? streamingAssistantText.text
                  : null
              }
              empty={<EmptyState onPickStarter={handlePickStarter} />}
            />
          </div>

          <div className="space-y-[10px] border-t border-[var(--color-border-subtle)] bg-[var(--color-background-secondary)] px-[var(--space-4)] pt-[var(--space-3)] pb-[var(--space-3)]">
            <CommentChipBar />
            {isClarifying && !activeClarification ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-3)] py-[var(--space-2)] text-[12px] text-[var(--color-text-secondary)]">
                {t('sidebar.clarify.loading')}
              </div>
            ) : null}
            {activeClarification ? (
              <ClarificationCard
                intro={activeClarification.intro}
                questions={activeClarification.questions}
                onSubmit={(answers) => {
                  void submitPendingClarification(answers);
                }}
                onSkip={() => {
                  void skipPendingClarification();
                }}
              />
            ) : null}
            <PromptInput
              ref={promptInputRef}
              prompt={prompt}
              setPrompt={setPrompt}
              onSubmit={onSubmit}
              onCancel={cancelGeneration}
              isGenerating={isGenerating}
              disabled={isClarifying || activeClarification !== null}
              {...(() => {
                const disabledReason =
                  activeClarification !== null
                    ? t('sidebar.clarify.disabledReason')
                    : isClarifying
                      ? t('sidebar.clarify.loading')
                      : null;
                return disabledReason ? { disabledReason } : {};
              })()}
            />
            <div className="flex items-center justify-between gap-[var(--space-2)] px-[2px]">
              <ModelSwitcher variant="sidebar" />
              {lastTokens !== null ? (
                <span
                  className="shrink-0 tabular-nums text-[10.5px] text-[var(--color-text-muted)]"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {t('sidebar.chat.tokensLine', { count: lastTokens })}
                </span>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <ProjectContextPanel />
        </div>
      )}
    </aside>
  );
}
