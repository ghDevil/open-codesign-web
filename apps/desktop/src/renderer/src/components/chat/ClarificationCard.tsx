import { useT } from '@open-codesign/i18n';
import type { ClarifyPromptQuestion } from '../../../../preload/index';
import { useMemo, useState } from 'react';
import type { ClarificationAnswer } from '../../store';

interface ClarificationCardProps {
  intro: string;
  questions: ClarifyPromptQuestion[];
  onSubmit: (answers: ClarificationAnswer[]) => void;
  onSkip: () => void;
}

function isAnswered(
  question: ClarifyPromptQuestion,
  values: Record<string, string>,
  customValues: Record<string, string>,
  multiValues: Record<string, string[]>,
): boolean {
  if (question.kind === 'text') {
    return (values[question.id] ?? '').trim().length > 0;
  }
  const selected = multiValues[question.id] ?? [];
  const custom = (customValues[question.id] ?? '').trim();
  return selected.length > 0 || custom.length > 0;
}

export function ClarificationCard({
  intro,
  questions,
  onSubmit,
  onSkip,
}: ClarificationCardProps) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [multiValues, setMultiValues] = useState<Record<string, string[]>>({});

  const canSubmit = useMemo(
    () => questions.every((question) => isAnswered(question, values, customValues, multiValues)),
    [customValues, multiValues, questions, values],
  );

  function toggleMulti(questionId: string, option: string): void {
    setMultiValues((current) => {
      const existing = current[questionId] ?? [];
      const next = existing.includes(option)
        ? existing.filter((value) => value !== option)
        : [...existing, option];
      return { ...current, [questionId]: next };
    });
  }

  function handleSubmit(): void {
    if (!canSubmit) return;
    onSubmit(
      questions.map((question) => {
        if (question.kind === 'text') {
          return {
            questionId: question.id,
            label: question.label,
            answer: (values[question.id] ?? '').trim(),
          };
        }
        const selected = multiValues[question.id] ?? [];
        const custom = (customValues[question.id] ?? '').trim();
        return {
          questionId: question.id,
          label: question.label,
          answer: [...selected, ...(custom.length > 0 ? [custom] : [])].join(', '),
        };
      }),
    );
  }

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--space-4)] py-[var(--space-4)] space-y-[var(--space-4)]">
      <div className="space-y-[var(--space-1)]">
        <p className="m-0 text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-text-muted)]">
          {t('sidebar.clarify.title')}
        </p>
        <p className="m-0 text-[13px] leading-[1.5] text-[var(--color-text-primary)]">
          {intro.trim().length > 0 ? intro : t('sidebar.clarify.defaultIntro')}
        </p>
      </div>

      <div className="space-y-[var(--space-3)]">
        {questions.map((question) => (
          <div key={question.id} className="space-y-[var(--space-2)]">
            <label className="block text-[12px] font-medium text-[var(--color-text-primary)]">
              {question.label}
            </label>

            {question.kind === 'text' ? (
              <input
                type="text"
                value={values[question.id] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [question.id]: event.target.value }))
                }
                placeholder={question.placeholder ?? t('sidebar.clarify.textPlaceholder')}
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-[12px] py-[10px] text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              />
            ) : (
              <div className="space-y-[var(--space-2)]">
                {(question.options ?? []).map((option) => {
                  const selected = (multiValues[question.id] ?? []).includes(option);
                  return (
                    <label
                      key={option}
                      className="flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-background-secondary)] px-[10px] py-[8px] text-[13px] text-[var(--color-text-primary)]"
                    >
                      <input
                        type={question.kind === 'single_choice' ? 'radio' : 'checkbox'}
                        name={question.id}
                        checked={selected}
                        onChange={() => {
                          if (question.kind === 'single_choice') {
                            setMultiValues((current) => ({ ...current, [question.id]: [option] }));
                            return;
                          }
                          toggleMulti(question.id, option);
                        }}
                      />
                      <span>{option}</span>
                    </label>
                  );
                })}

                {question.allowCustom ? (
                  <input
                    type="text"
                    value={customValues[question.id] ?? ''}
                    onChange={(event) =>
                      setCustomValues((current) => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))
                    }
                    placeholder={t('sidebar.clarify.customPlaceholder')}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-[12px] py-[10px] text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                  />
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-[var(--space-3)]">
        <button
          type="button"
          onClick={onSkip}
          className="text-[12px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          {t('sidebar.clarify.skip')}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="inline-flex items-center justify-center rounded-full bg-[var(--color-accent)] px-[14px] py-[8px] text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('sidebar.clarify.submit')}
        </button>
      </div>
    </section>
  );
}