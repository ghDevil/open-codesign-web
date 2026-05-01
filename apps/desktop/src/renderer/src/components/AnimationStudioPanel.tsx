import { extractAnimationCodeFromHtml, parseAnimationCodeMeta } from '@open-codesign/shared';
import { Player, type ErrorFallback, type PlayerRef } from '@remotion/player';
import { AlertCircle, Code2, Eye, RotateCcw, Sparkles, SplitSquareHorizontal } from 'lucide-react';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompilation } from '../hooks/useCompilation';
import { RemotionCodeEditor } from './animation/RemotionCodeEditor';

type StudioMode = 'preview' | 'split' | 'code';

const STARTER_TEMPLATE = `// @fps 30
// @duration 150
// @width 1920
// @height 1080

export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const scale = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 180 },
  });

  return (
    <AbsoluteFill
      style={{
        background: '#08111f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          opacity,
          transform: \`scale(\${scale})\`,
          color: '#f6f7fb',
          fontSize: 96,
          fontWeight: 700,
          fontFamily: 'Inter, sans-serif',
          letterSpacing: '-0.02em',
        }}
      >
        Hello Remotion
      </div>
    </AbsoluteFill>
  );
};
`;

const errorFallback: ErrorFallback = ({ error }) => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#0d1320] p-6 text-center text-[rgba(255,255,255,0.85)]">
    <AlertCircle className="h-7 w-7 text-red-400" />
    <div className="text-[13px] font-medium text-red-400">Runtime error</div>
    <pre className="max-w-[640px] overflow-auto rounded-md bg-[rgba(255,0,0,0.08)] px-4 py-3 text-left text-[11px] leading-[1.6] text-red-300 whitespace-pre-wrap">
      {error.message ?? 'An error occurred while rendering'}
    </pre>
  </div>
);

interface AnimationStudioPanelProps {
  html: string;
}

export function AnimationStudioPanel({ html }: AnimationStudioPanelProps): ReactElement {
  const generatedCode = useMemo(() => extractAnimationCodeFromHtml(html), [html]);
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [mode, setMode] = useState<StudioMode>('split');
  const playerRef = useRef<PlayerRef>(null);

  // When a new generation comes in, drop manual edits.
  useEffect(() => {
    setEditedCode(null);
  }, [generatedCode]);

  const code = editedCode ?? generatedCode ?? '';
  const showStarter = !code;
  const codeForCompilation = showStarter ? STARTER_TEMPLATE : code;

  const { Component, error } = useCompilation(codeForCompilation);
  const meta = useMemo(() => parseAnimationCodeMeta(codeForCompilation), [codeForCompilation]);

  const handleResetEdits = useCallback(() => setEditedCode(null), []);
  const handleEditStarter = useCallback(() => setEditedCode(STARTER_TEMPLATE), []);
  const handleCodeChange = useCallback((next: string) => setEditedCode(next), []);

  const PlayerArea = (
    <div className="relative flex h-full flex-col bg-[#040812]">
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        {Component && !error ? (
          <Player
            ref={playerRef}
            // The component identity changes on every recompile; keying by it
            // ensures the player remounts cleanly instead of replaying stale
            // animation state.
            key={Component.toString()}
            component={Component}
            durationInFrames={meta.durationInFrames}
            compositionWidth={meta.width}
            compositionHeight={meta.height}
            fps={meta.fps}
            controls
            autoPlay
            loop
            errorFallback={errorFallback}
            spaceKeyToPlayOrPause={false}
            clickToPlay={false}
            style={{
              width: '100%',
              maxHeight: '100%',
              aspectRatio: `${meta.width} / ${meta.height}`,
              boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
              borderRadius: 8,
            }}
          />
        ) : (
          <div className="flex max-w-[640px] flex-col items-center gap-3 p-8 text-center">
            {error ? (
              <>
                <AlertCircle className="h-7 w-7 text-red-400" />
                <div className="text-[13px] font-medium text-red-400">Compilation error</div>
                <pre className="max-w-full overflow-auto rounded-md bg-[rgba(255,0,0,0.08)] px-4 py-3 text-left text-[11px] leading-[1.6] text-red-300 whitespace-pre-wrap">
                  {error}
                </pre>
              </>
            ) : (
              <div className="text-[13px] text-[rgba(255,255,255,0.4)]">Compiling…</div>
            )}
          </div>
        )}

        <div className="absolute top-3 right-3 rounded-full bg-[rgba(0,0,0,0.55)] px-3 py-1 text-[11px] text-[rgba(255,255,255,0.75)] backdrop-blur-sm">
          {meta.width}×{meta.height} · {meta.fps}fps · {Math.round((meta.durationInFrames / meta.fps) * 10) / 10}s
        </div>

        {showStarter ? (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-[rgba(124,156,255,0.15)] px-3 py-1 text-[11px] font-medium text-[#7c9cff] backdrop-blur-sm">
            <Sparkles className="h-3 w-3" />
            Starter — describe your animation in chat to replace
          </div>
        ) : null}
      </div>
    </div>
  );

  const EditorArea = (
    <div className="flex h-full flex-col bg-[#1e1e1e]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[rgba(255,255,255,0.06)] bg-[#252526] px-3 py-2">
        <Code2 className="h-3.5 w-3.5 text-[rgba(255,255,255,0.55)]" />
        <span className="text-[12px] font-medium text-[rgba(255,255,255,0.85)]">
          MyComposition.tsx
        </span>
        {editedCode !== null ? (
          <span className="rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-on-accent)]">
            edited
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {showStarter ? (
            <button
              type="button"
              onClick={handleEditStarter}
              className="inline-flex items-center gap-1 rounded-md bg-[rgba(124,156,255,0.15)] px-2 py-1 text-[11px] text-[#7c9cff] hover:bg-[rgba(124,156,255,0.25)]"
            >
              <Sparkles className="h-3 w-3" />
              Edit starter
            </button>
          ) : null}
          {editedCode !== null ? (
            <button
              type="button"
              onClick={handleResetEdits}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[rgba(255,255,255,0.6)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.9)]"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          ) : null}
        </div>
      </div>
      {showStarter && editedCode === null ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-[320px] space-y-3">
            <Sparkles className="mx-auto h-7 w-7 text-[rgba(124,156,255,0.6)]" />
            <div className="text-[13px] font-medium text-[rgba(255,255,255,0.9)]">
              No animation yet
            </div>
            <p className="text-[12px] leading-[1.55] text-[rgba(255,255,255,0.5)]">
              Describe what you want to animate in the chat on the left, or click{' '}
              <strong>Edit starter</strong> to begin from a blank Remotion composition.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <RemotionCodeEditor value={code} onChange={handleCodeChange} />
        </div>
      )}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[rgba(255,255,255,0.06)] bg-[#252526] px-3 py-2">
        <span className="text-[10.5px] text-[rgba(255,255,255,0.4)]">
          Live compilation · @babel/standalone · Remotion APIs pre-injected
        </span>
        {error ? (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-red-400">
            <AlertCircle className="h-3 w-3" />
            error
          </span>
        ) : (
          <span className="text-[10.5px] text-[rgba(124,180,140,0.85)]">✓ compiles</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-[var(--color-background)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-background-secondary)] px-3 py-1.5">
        <span className="mr-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
          Animation studio
        </span>
        <div className="flex items-center gap-0.5 rounded-md bg-[var(--color-surface)] p-0.5">
          <ModeButton
            active={mode === 'preview'}
            onClick={() => setMode('preview')}
            icon={<Eye className="h-3.5 w-3.5" />}
            label="Preview"
          />
          <ModeButton
            active={mode === 'split'}
            onClick={() => setMode('split')}
            icon={<SplitSquareHorizontal className="h-3.5 w-3.5" />}
            label="Split"
          />
          <ModeButton
            active={mode === 'code'}
            onClick={() => setMode('code')}
            icon={<Code2 className="h-3.5 w-3.5" />}
            label="Code"
          />
        </div>
      </div>

      <div className="relative flex flex-1 min-h-0">
        {mode === 'preview' ? PlayerArea : null}
        {mode === 'code' ? EditorArea : null}
        {mode === 'split' ? (
          <>
            <div className="min-w-0 flex-1">{PlayerArea}</div>
            <div className="w-px shrink-0 bg-[var(--color-border)]" />
            <div className="min-w-0 flex-1">{EditorArea}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactElement;
  label: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
        active
          ? 'bg-[var(--color-background)] text-[var(--color-text-primary)] shadow-sm'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
