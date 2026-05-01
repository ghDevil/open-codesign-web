import { extractAnimationCodeFromHtml, parseAnimationCodeMeta } from '@open-codesign/shared';
import { Player, type ErrorFallback, type PlayerRef } from '@remotion/player';
import {
  AlertCircle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Code2,
  FolderOpen,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  StepBack,
  StepForward,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompilation } from '../hooks/useCompilation';

const RemotionCodeEditor = lazy(() =>
  import('./animation/RemotionCodeEditor').then((mod) => ({ default: mod.RemotionCodeEditor })),
);

type LeftTab = 'compositions' | 'assets';

const STARTER_TEMPLATE = `// @fps 30
// @duration 150
// @width 1920
// @height 1080

export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

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

function formatFrameClock(frame: number, fps: number): string {
  const safeFrame = Math.max(0, Math.round(frame));
  const totalSeconds = Math.floor(safeFrame / fps);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const remainder = safeFrame % fps;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
    remainder,
  ).padStart(2, '0')}`;
}

function formatDuration(frames: number, fps: number): string {
  const totalSeconds = frames / fps;
  return `${totalSeconds.toFixed(2)}s`;
}

function extractCompositionName(code: string): string {
  const fnMatch = code.match(/export\s+(?:const|function)\s+(\w+)/);
  return fnMatch?.[1] ?? 'MyComposition';
}

function extractAssetRefs(code: string): string[] {
  const found = new Set<string>();
  const staticFilePattern = /staticFile\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  const importPattern = /import\s+.+?\s+from\s+['"`]([^'"`]+\.(?:png|jpg|jpeg|gif|svg|mp4|webm|wav|mp3))['"`]/g;

  for (const pattern of [staticFilePattern, importPattern]) {
    let match: RegExpExecArray | null = pattern.exec(code);
    while (match) {
      if (match[1]) found.add(match[1]);
      match = pattern.exec(code);
    }
  }

  return [...found];
}

interface AnimationStudioPanelProps {
  html: string;
}

export function AnimationStudioPanel({ html }: AnimationStudioPanelProps): ReactElement {
  const generatedCode = useMemo(() => extractAnimationCodeFromHtml(html), [html]);
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>('compositions');
  const [showCodePanel, setShowCodePanel] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const playerRef = useRef<PlayerRef>(null);

  useEffect(() => {
    setEditedCode(null);
    setCurrentFrame(0);
  }, [generatedCode]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const frame = player.getCurrentFrame();
      setCurrentFrame(frame);
    }, 80);

    return () => window.clearInterval(timer);
  }, []);

  const code = editedCode ?? generatedCode ?? '';
  const showStarter = !code;
  const codeForCompilation = showStarter ? STARTER_TEMPLATE : code;
  const { Component, error } = useCompilation(codeForCompilation);
  const meta = useMemo(() => parseAnimationCodeMeta(codeForCompilation), [codeForCompilation]);
  const compositionName = useMemo(() => extractCompositionName(codeForCompilation), [codeForCompilation]);
  const assetRefs = useMemo(() => extractAssetRefs(codeForCompilation), [codeForCompilation]);
  const isPlaying = playerRef.current?.isPlaying() ?? false;

  const playerKey = useMemo(
    () =>
      `${meta.width}:${meta.height}:${meta.fps}:${meta.durationInFrames}:${codeForCompilation.length}:${codeForCompilation.slice(0, 120)}`,
    [codeForCompilation, meta.durationInFrames, meta.fps, meta.height, meta.width],
  );

  const timelineTicks = useMemo(() => {
    const secondCount = Math.max(1, Math.floor(meta.durationInFrames / meta.fps));
    return Array.from({ length: secondCount + 1 }, (_, index) => ({
      frame: Math.min(index * meta.fps, meta.durationInFrames),
      label: `${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`,
    }));
  }, [meta.durationInFrames, meta.fps]);

  const handleCodeChange = useCallback((next: string) => setEditedCode(next), []);
  const handleResetEdits = useCallback(() => setEditedCode(null), []);
  const handleEditStarter = useCallback(() => setEditedCode(STARTER_TEMPLATE), []);
  const handleSeek = useCallback((frame: number) => {
    playerRef.current?.seekTo(frame);
    setCurrentFrame(frame);
  }, []);
  const seekBy = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(meta.durationInFrames, currentFrame + delta));
      handleSeek(next);
    },
    [currentFrame, handleSeek, meta.durationInFrames],
  );
  const handleTogglePlayback = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isPlaying()) {
      player.pause();
      setCurrentFrame(player.getCurrentFrame());
      return;
    }
    player.play();
  }, []);
  const handleResetToStart = useCallback(() => {
    playerRef.current?.pause();
    handleSeek(0);
  }, [handleSeek]);
  const handleFullscreen = useCallback(() => {
    playerRef.current?.requestFullscreen();
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111315] text-[rgba(255,255,255,0.9)]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-[#101214] px-3 text-[11px]">
        <div className="flex items-center gap-3">
          <span className="font-medium text-[rgba(255,255,255,0.96)]">Animation Studio</span>
          <span className="text-[rgba(255,255,255,0.35)]">/</span>
          <span className="text-[rgba(255,255,255,0.55)]">{compositionName}</span>
        </div>
        <div className="flex items-center gap-2 text-[rgba(255,255,255,0.45)]">
          <span>{meta.width}x{meta.height}</span>
          <span>{meta.fps} FPS</span>
          <span>{formatDuration(meta.durationInFrames, meta.fps)}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[248px] shrink-0 flex-col border-r border-[rgba(255,255,255,0.06)] bg-[#191c20]">
          <div className="flex shrink-0 items-center gap-1 border-b border-[rgba(255,255,255,0.06)] px-2 py-2">
            <StudioTabButton
              active={leftTab === 'compositions'}
              onClick={() => setLeftTab('compositions')}
              icon={<Clapperboard className="h-3.5 w-3.5" />}
              label="Compositions"
            />
            <StudioTabButton
              active={leftTab === 'assets'}
              onClick={() => setLeftTab('assets')}
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              label="Assets"
            />
          </div>

          {leftTab === 'compositions' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-[rgba(255,255,255,0.06)] px-3 py-3">
                <div className="text-[13px] font-semibold text-[rgba(255,255,255,0.95)]">
                  {compositionName}
                </div>
                <div className="mt-1 text-[11px] text-[rgba(255,255,255,0.55)]">
                  {meta.width}x{meta.height}, {meta.fps} FPS
                </div>
                <div className="text-[11px] text-[rgba(255,255,255,0.45)]">
                  Duration {formatDuration(meta.durationInFrames, meta.fps)}
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="flex items-center gap-2 rounded-md border border-[rgba(255,255,255,0.08)] bg-[#14171a] px-2 py-1.5 text-[11px] text-[rgba(255,255,255,0.45)]">
                  <Search className="h-3.5 w-3.5" />
                  <span>Search compositions</span>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
                <button
                  type="button"
                  onClick={() => handleSeek(0)}
                  className="flex w-full items-start gap-2 rounded-md bg-[#2a2e34] px-3 py-2 text-left transition-colors hover:bg-[#323741]"
                >
                  <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-[rgba(255,255,255,0.65)]" />
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-[rgba(255,255,255,0.95)]">
                      {compositionName}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-[rgba(255,255,255,0.5)]">
                      {meta.width}x{meta.height}, {meta.fps} FPS
                    </div>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
              {assetRefs.length > 0 ? (
                <div className="space-y-2">
                  {assetRefs.map((asset) => (
                    <div
                      key={asset}
                      className="rounded-md border border-[rgba(255,255,255,0.06)] bg-[#14171a] px-3 py-2"
                    >
                      <div className="truncate text-[12px] font-medium text-[rgba(255,255,255,0.9)]">
                        {asset}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-[rgba(255,255,255,0.08)] bg-[#14171a] px-4 py-5 text-[11px] leading-[1.6] text-[rgba(255,255,255,0.5)]">
                  No imported assets yet. The composition is currently self-contained.
                </div>
              )}
            </div>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-[#111315]">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-[#181b1f] px-3 text-[11px]">
            <div className="flex items-center gap-2 text-[rgba(255,255,255,0.55)]">
              <span>File</span>
              <span>View</span>
              <span>Tools</span>
              <span>Render</span>
            </div>
            <button
              type="button"
              onClick={() => setShowCodePanel((value) => !value)}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 transition-colors ${
                showCodePanel
                  ? 'bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.95)]'
                  : 'text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.06)]'
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              Code
            </button>
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-8 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-[#15181b] px-3 text-[11px]">
                <div className="flex items-center gap-2 text-[rgba(255,255,255,0.5)]">
                  <button
                    type="button"
                    onClick={() => seekBy(-meta.fps)}
                    className="rounded p-1 transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.95)]"
                    aria-label="Jump backward"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => seekBy(meta.fps)}
                    className="rounded p-1 transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.95)]"
                    aria-label="Jump forward"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="truncate text-[rgba(255,255,255,0.62)]">
                  {compositionName} / {showStarter ? 'Starter composition' : 'Generated composition'}
                </div>
                <div className="text-[rgba(255,255,255,0.42)]">{formatFrameClock(currentFrame, meta.fps)}</div>
              </div>

              <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#0d0f11] p-5">
                {Component && !error ? (
                  <Player
                    ref={playerRef}
                    key={playerKey}
                    component={Component}
                    durationInFrames={meta.durationInFrames}
                    compositionWidth={meta.width}
                    compositionHeight={meta.height}
                    fps={meta.fps}
                    controls={false}
                    autoPlay={false}
                    loop
                    errorFallback={errorFallback}
                    moveToBeginningWhenEnded
                    spaceKeyToPlayOrPause={false}
                    clickToPlay={false}
                    doubleClickToFullscreen={false}
                    playbackRate={playbackRate}
                    style={{
                      width: '100%',
                      maxHeight: '100%',
                      aspectRatio: `${meta.width} / ${meta.height}`,
                      boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
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
                      <div className="text-[13px] text-[rgba(255,255,255,0.4)]">Compiling...</div>
                    )}
                  </div>
                )}

                {showStarter ? (
                  <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-[rgba(124,156,255,0.16)] px-3 py-1 text-[11px] font-medium text-[#8ca8ff]">
                    <Sparkles className="h-3 w-3" />
                    Starter composition loaded
                  </div>
                ) : null}
              </div>

              <div className="border-t border-[rgba(255,255,255,0.06)] bg-[#14171a]">
                <div className="flex items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] px-4 py-2">
                  <div className="flex items-center gap-1 text-[rgba(255,255,255,0.72)]">
                    <button
                      type="button"
                      onClick={handleResetToStart}
                      className="rounded p-1.5 transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                      aria-label="Reset to start"
                    >
                      <StepBack className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => seekBy(-1)}
                      className="rounded p-1.5 transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                      aria-label="Previous frame"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleTogglePlayback}
                      className="rounded bg-[rgba(255,255,255,0.08)] p-2 transition-colors hover:bg-[rgba(255,255,255,0.12)]"
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => seekBy(1)}
                      className="rounded p-1.5 transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                      aria-label="Next frame"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => seekBy(meta.fps)}
                      className="rounded p-1.5 transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                      aria-label="Jump forward"
                    >
                      <StepForward className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-[11px]">
                    <div className="rounded bg-[#1d2126] px-2 py-1 text-[rgba(255,255,255,0.7)]">Fit</div>
                    <select
                      value={String(playbackRate)}
                      onChange={(event) => setPlaybackRate(Number(event.target.value))}
                      className="rounded border border-[rgba(255,255,255,0.08)] bg-[#1d2126] px-2 py-1 text-[rgba(255,255,255,0.78)] outline-none"
                    >
                      <option value="0.5">0.5x</option>
                      <option value="1">1x</option>
                      <option value="1.5">1.5x</option>
                      <option value="2">2x</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleFullscreen}
                      className="rounded p-1.5 text-[rgba(255,255,255,0.72)] transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                      aria-label="Fullscreen"
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="px-4 py-3">
                  <div className="flex items-center justify-between text-[11px] text-[rgba(255,255,255,0.42)]">
                    <span>{formatFrameClock(currentFrame, meta.fps)}</span>
                    <span>{formatFrameClock(meta.durationInFrames, meta.fps)}</span>
                  </div>

                  <div className="relative mt-3 h-28 overflow-hidden rounded-md border border-[rgba(255,255,255,0.06)] bg-[#0f1114]">
                    <div className="absolute inset-x-0 top-0 flex h-7 items-center border-b border-[rgba(255,255,255,0.05)] px-3">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-[rgba(255,255,255,0.34)]">
                        Timeline
                      </div>
                    </div>

                    <div className="absolute inset-x-0 top-7 px-3 pt-3">
                      <div className="relative h-9 rounded bg-[#171b20]">
                        <div
                          className="absolute left-0 top-1.5 h-6 rounded bg-[linear-gradient(90deg,#6f7cff,#4a9eff)]"
                          style={{ width: '100%' }}
                        />
                        <div className="absolute inset-y-0 left-3 flex items-center text-[11px] font-medium text-white">
                          {compositionName}
                        </div>
                      </div>

                      <input
                        type="range"
                        min={0}
                        max={meta.durationInFrames}
                        step={1}
                        value={Math.min(currentFrame, meta.durationInFrames)}
                        onChange={(event) => handleSeek(Number(event.target.value))}
                        className="mt-4 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[rgba(255,255,255,0.12)] accent-[#ff503b]"
                      />

                      <div className="mt-3 grid grid-cols-6 gap-0 text-[10px] text-[rgba(255,255,255,0.34)]">
                        {timelineTicks.slice(0, 6).map((tick) => (
                          <div key={tick.frame}>{tick.label}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {showCodePanel ? (
              <>
                <div className="w-px shrink-0 bg-[rgba(255,255,255,0.06)]" />
                <aside className="flex w-[430px] shrink-0 flex-col bg-[#171a1e]">
                  <div className="flex h-8 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.06)] px-3 text-[11px]">
                    <div className="flex items-center gap-2">
                      <Code2 className="h-3.5 w-3.5 text-[rgba(255,255,255,0.55)]" />
                      <span className="font-medium text-[rgba(255,255,255,0.9)]">Composition.tsx</span>
                      {editedCode !== null ? (
                        <span className="rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-on-accent)]">
                          edited
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      {showStarter ? (
                        <button
                          type="button"
                          onClick={handleEditStarter}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[#7c9cff] transition-colors hover:bg-[rgba(124,156,255,0.14)]"
                        >
                          <Sparkles className="h-3 w-3" />
                          Edit starter
                        </button>
                      ) : null}
                      {editedCode !== null ? (
                        <button
                          type="button"
                          onClick={handleResetEdits}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[rgba(255,255,255,0.65)] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.95)]"
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
                          No animation code yet
                        </div>
                        <p className="text-[12px] leading-[1.55] text-[rgba(255,255,255,0.5)]">
                          Start from the built-in composition or describe a motion brief in chat and let the model replace it.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <Suspense
                        fallback={
                          <div className="flex h-full w-full items-center justify-center text-[12px] text-[rgba(255,255,255,0.4)]">
                            Loading editor...
                          </div>
                        }
                      >
                        <RemotionCodeEditor value={code} onChange={handleCodeChange} />
                      </Suspense>
                    </div>
                  )}

                  <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[rgba(255,255,255,0.06)] bg-[#1c2025] px-3 py-2">
                    <span className="text-[10.5px] text-[rgba(255,255,255,0.4)]">
                      Live compilation - @babel/standalone - Remotion APIs pre-injected
                    </span>
                    {error ? (
                      <span className="inline-flex items-center gap-1 text-[10.5px] text-red-400">
                        <AlertCircle className="h-3 w-3" />
                        error
                      </span>
                    ) : (
                      <span className="text-[10.5px] text-[rgba(124,180,140,0.85)]">Compiled</span>
                    )}
                  </div>
                </aside>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function StudioTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactElement;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'bg-[#2a2e34] text-[rgba(255,255,255,0.95)]'
          : 'text-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.05)] hover:text-[rgba(255,255,255,0.85)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
