import { parseAnimationCodeMeta, extractAnimationCodeFromHtml } from '@open-codesign/shared';
import { Player } from '@remotion/player';
import { AlertCircle, ChevronDown, ChevronUp, Code2, Play } from 'lucide-react';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCompilation } from '../hooks/useCompilation';

interface AnimationStudioPanelProps {
  html: string;
}

export function AnimationStudioPanel({ html }: AnimationStudioPanelProps): ReactElement {
  const rawCode = useMemo(() => extractAnimationCodeFromHtml(html) ?? '', [html]);
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    setEditedCode(null);
  }, [rawCode]);

  const code = editedCode ?? rawCode;
  const { Component, error } = useCompilation(code);
  const meta = useMemo(() => parseAnimationCodeMeta(code), [code]);

  const handleReset = useCallback(() => setEditedCode(null), []);

  if (!rawCode) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-background)] p-8">
        <div className="max-w-[560px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <div className="flex items-center gap-2 text-[16px] font-medium text-[var(--color-text-primary)]">
            <Play className="h-4 w-4 text-[var(--color-accent)]" />
            Animation studio
          </div>
          <p className="mt-2 mb-0 text-[13px] leading-[1.6] text-[var(--color-text-muted)]">
            This design is in animation mode. Ask the model to generate a Remotion
            composition and it will appear here as live code.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-background)]">
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#040812]">
        {Component && !error ? (
          <Player
            component={Component}
            durationInFrames={meta.durationInFrames}
            compositionWidth={meta.width}
            compositionHeight={meta.height}
            fps={meta.fps}
            controls
            showVolumeControls={false}
            clickToPlay
            doubleClickToFullscreen
            moveToBeginningWhenEnded
            loop
            style={{
              width: '100%',
              maxHeight: '100%',
              aspectRatio: `${meta.width} / ${meta.height}`,
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            {error ? (
              <>
                <AlertCircle className="h-8 w-8 text-red-400" />
                <div className="text-[13px] font-medium text-red-400">Compilation error</div>
                <pre className="max-w-[640px] overflow-auto rounded-[var(--radius-md)] bg-[rgba(255,0,0,0.08)] px-4 py-3 text-left text-[11px] leading-[1.6] text-red-300 whitespace-pre-wrap">
                  {error}
                </pre>
              </>
            ) : (
              <div className="text-[13px] text-[rgba(255,255,255,0.4)]">Compiling...</div>
            )}
          </div>
        )}

        <div className="absolute top-3 right-3 rounded-full bg-[rgba(0,0,0,0.55)] px-3 py-1 text-[11px] text-[rgba(255,255,255,0.7)] backdrop-blur-sm">
          {meta.width}x{meta.height} · {meta.fps}fps ·{' '}
          {Math.round((meta.durationInFrames / meta.fps) * 10) / 10}s
        </div>
      </div>

      <div className="border-t border-[var(--color-border)] bg-[var(--color-background-secondary)]">
        <button
          type="button"
          onClick={() => setShowCode((value) => !value)}
          className="flex w-full items-center gap-2 px-4 py-2 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          <Code2 className="h-3.5 w-3.5" />
          <span className="font-medium">Animation code</span>
          {editedCode !== null ? (
            <span className="ml-1 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] text-[var(--color-on-accent)]">
              edited
            </span>
          ) : null}
          <span className="ml-auto">
            {showCode ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </span>
        </button>

        {showCode ? (
          <div className="flex flex-col border-t border-[var(--color-border)]">
            <textarea
              value={code}
              onChange={(event) => setEditedCode(event.target.value)}
              spellCheck={false}
              className="h-[280px] resize-none bg-[#0d1117] px-4 py-3 font-mono text-[12px] leading-[1.65] text-[#e6edf3] focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-4 py-2">
              <span className="text-[11px] text-[var(--color-text-muted)]">
                Edit the Remotion code above. The player recompiles live.
              </span>
              {editedCode !== null ? (
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-[11px] text-[var(--color-accent)] hover:underline"
                >
                  Reset to generated
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
