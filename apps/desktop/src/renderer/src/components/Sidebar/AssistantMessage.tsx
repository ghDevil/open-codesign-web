import { useT } from '@open-codesign/i18n';
import { Check, Copy, MessageSquareText, RefreshCcw, Star } from 'lucide-react';
import { useState } from 'react';
import { type RendererChatMessage, useCodesignStore } from '../../store';

export interface AssistantMessageProps {
  message: RendererChatMessage;
  index: number;
}

const ACTION_BTN =
  'inline-flex items-center gap-1 h-[24px] px-2 rounded-md text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors';

export function AssistantMessage({ message, index }: AssistantMessageProps) {
  const t = useT();
  const isError = message.content.startsWith('Error:');
  const previewHtml = useCodesignStore((s) => s.previewHtml);
  const messages = useCodesignStore((s) => s.messages);
  const regenerate = useCodesignStore((s) => s.regenerateLast);
  const saveSnapshot = useCodesignStore((s) => s.saveSnapshot);
  const appliedComments = useCodesignStore((s) => s.appliedComments);
  const [copied, setCopied] = useState(false);
  const [snapped, setSnapped] = useState(false);

  const isLast = index === messages.length - 1;
  const hasArtifact = isLast && previewHtml !== null && !isError;
  const ownComments = message.id
    ? appliedComments.filter((c) => c.targetMessageId === message.id)
    : [];

  async function copyArtifact(): Promise<void> {
    if (!previewHtml) return;
    try {
      await navigator.clipboard.writeText(previewHtml);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  }

  function snapshot(): void {
    saveSnapshot(index);
    setSnapped(true);
    window.setTimeout(() => setSnapped(false), 1500);
  }

  return (
    <div
      className={`px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-lg)] text-[var(--text-sm)] leading-[var(--leading-body)] break-words border ${
        isError
          ? 'bg-[var(--color-surface)] border-[var(--color-border-muted)] text-[var(--color-text-primary)]'
          : 'bg-[var(--color-surface)] border-[var(--color-border-muted)] text-[var(--color-text-primary)]'
      }`}
    >
      <div className="whitespace-pre-wrap">{message.content}</div>

      {hasArtifact ? (
        <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">
          {t('assistantMessage.artifactReady')}
        </div>
      ) : null}

      {ownComments.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ownComments.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-[3px] text-[11px] text-[var(--color-text-secondary)]"
              title={`${c.label.display} \u2014 ${c.comment}`}
            >
              <MessageSquareText className="h-3 w-3 text-[var(--color-accent)] shrink-0" />
              <span className="truncate max-w-[260px]">
                {t('comment.chip', { target: c.label.display, edit: c.comment })}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {isLast && !isError ? (
        <div className="mt-2 -mb-1 flex items-center gap-1 flex-wrap">
          <button type="button" onClick={() => void regenerate()} className={ACTION_BTN}>
            <RefreshCcw className="w-3 h-3" />
            {t('assistantMessage.regenerate')}
          </button>
          {hasArtifact ? (
            <>
              <button type="button" onClick={() => void copyArtifact()} className={ACTION_BTN}>
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? t('common.copied') : t('assistantMessage.copyCode')}
              </button>
              <button type="button" onClick={snapshot} className={ACTION_BTN}>
                {snapped ? <Check className="w-3 h-3" /> : <Star className="w-3 h-3" />}
                {snapped ? t('assistantMessage.snapshotSaved') : t('assistantMessage.saveSnapshot')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
