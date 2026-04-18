import { PROVIDER_SHORTLIST, type SupportedOnboardingProvider } from '@open-codesign/shared';
import { Wordmark } from '@open-codesign/ui';
import { useState } from 'react';
import { useCodesignStore } from '../store';
import { ChooseModel } from './ChooseModel';
import { PasteKey } from './PasteKey';
import { Welcome } from './Welcome';

type Step = 'welcome' | 'paste' | 'model';

export function Onboarding() {
  const completeOnboarding = useCodesignStore((s) => s.completeOnboarding);
  const [step, setStep] = useState<Step>('welcome');
  const [provider, setProvider] = useState<SupportedOnboardingProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleValidated(p: SupportedOnboardingProvider, key: string) {
    setProvider(p);
    setApiKey(key);
    setStep('model');
  }

  async function handleConfirm(modelPrimary: string, modelFast: string) {
    if (provider === null) return;
    if (!window.codesign) {
      setErrorMessage('Renderer is not connected to the main process.');
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      const next = await window.codesign.onboarding.saveKey({
        provider,
        apiKey,
        modelPrimary,
        modelFast,
      });
      completeOnboarding(next);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save key.');
    } finally {
      setSaving(false);
    }
  }

  const idx = stepIndex(step);

  return (
    <div className="h-full flex items-center justify-center bg-[var(--color-background)] px-[var(--space-6)] py-[var(--space-8)] relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% 0%, var(--color-accent-soft), transparent 70%)',
        }}
      />
      <div className="relative w-full max-w-[480px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-2xl)] shadow-[var(--shadow-card)] p-[var(--space-8)] flex flex-col gap-[var(--space-6)]">
        <header className="flex items-center justify-between">
          <Wordmark badge="pre-alpha" />
          <Stepper current={idx} total={3} />
        </header>

        {step === 'welcome' ? (
          <Welcome
            onPickKey={() => setStep('paste')}
            onPickFreeTier={() => {
              setProvider('openrouter');
              setStep('paste');
            }}
            ollamaDetected={false}
          />
        ) : null}
        {step === 'paste' ? (
          <PasteKey onValidated={handleValidated} onBack={() => setStep('welcome')} />
        ) : null}
        {step === 'model' && provider !== null ? (
          <ChooseModel
            provider={provider}
            saving={saving}
            errorMessage={errorMessage}
            onConfirm={handleConfirm}
            onBack={() => setStep('paste')}
          />
        ) : null}
      </div>
    </div>
  );
}

function Stepper({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-[var(--space-2)]">
      <span className="text-[var(--text-xs)] font-mono text-[var(--color-text-muted)] tracking-[0.04em]">
        {current.toString().padStart(2, '0')} / {total.toString().padStart(2, '0')}
      </span>
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: stepper dots are positional
            key={i}
            className={`h-[3px] rounded-[var(--radius-full)] transition-[width,background-color] duration-[var(--duration-base)] ease-[var(--ease-out)] ${
              i < current
                ? 'w-[14px] bg-[var(--color-accent)]'
                : 'w-[6px] bg-[var(--color-border-strong)]'
            }`}
          />
        ))}
      </span>
    </div>
  );
}

function stepIndex(step: Step): number {
  if (step === 'welcome') return 1;
  if (step === 'paste') return 2;
  return 3;
}

// Re-export for convenience.
export { PROVIDER_SHORTLIST };
