import { useT } from '@open-codesign/i18n';
import { useEffect, useRef } from 'react';
import { type RendererChatMessage, useCodesignStore } from '../../store';
import { AssistantMessage } from './AssistantMessage';

export function ChatHistory() {
  const t = useT();
  const messages = useCodesignStore((s) => s.messages);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageCount = messages.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: count and stage are intentional trigger dependencies — we re-pin scroll on every new message and on every generation toggle.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messageCount, isGenerating]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
      {messages.length === 0 ? (
        <p className="text-[var(--text-sm)] text-[var(--color-text-muted)] leading-[var(--leading-body)]">
          {t('sidebar.startHint')}
        </p>
      ) : (
        messages.map((m, i) => <Bubble key={`${i}-${m.role}`} index={i} message={m} />)
      )}
    </div>
  );
}

function Bubble({ message, index }: { message: RendererChatMessage; index: number }) {
  if (message.role === 'user') {
    return (
      <div className="px-[var(--space-4)] py-[var(--space-3)] rounded-[var(--radius-lg)] text-[var(--text-sm)] leading-[var(--leading-body)] whitespace-pre-wrap break-words bg-[var(--color-accent-soft)] text-[var(--color-text-primary)] border border-[var(--color-accent-muted)]">
        {message.content}
      </div>
    );
  }
  return <AssistantMessage message={message} index={index} />;
}
