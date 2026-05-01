import Editor, { type Monaco, loader } from '@monaco-editor/react';
import type { ReactElement } from 'react';
import { useCallback, useRef } from 'react';

// `@monaco-editor/react` is a React wrapper around Monaco. The actual editor
// runtime is fetched by `@monaco-editor/loader`, which is the simplest setup
// for our hosted web build and matches the general pattern Remotion documents
// for browser-side AI editing surfaces.
loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs',
  },
});

const REMOTION_TYPES = `
declare module 'remotion' {
  import type * as React from 'react';
  export const AbsoluteFill: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties; className?: string }>;
  export const Audio: React.FC<Record<string, unknown>>;
  export const Video: React.FC<Record<string, unknown>>;
  export const OffthreadVideo: React.FC<Record<string, unknown>>;
  export const Html5Video: React.FC<Record<string, unknown>>;
  export const Html5Audio: React.FC<Record<string, unknown>>;
  export const AnimatedImage: React.FC<Record<string, unknown>>;
  export const Freeze: React.FC<{ frame: number; children?: React.ReactNode }>;
  export const Loop: React.FC<{ durationInFrames?: number; times?: number; children?: React.ReactNode }>;
  export const Sequence: React.FC<{ children?: React.ReactNode; from?: number; durationInFrames?: number; layout?: 'absolute-fill' | 'none' }>;
  export const Series: React.FC<{ children?: React.ReactNode }> & {
    Sequence: React.FC<{ children?: React.ReactNode; durationInFrames: number; offset?: number }>;
  };
  export const Img: React.FC<React.ImgHTMLAttributes<HTMLImageElement>>;
  export const IFrame: React.FC<Record<string, unknown>>;
  export const HtmlInCanvas: React.FC<Record<string, unknown>>;
  export function useCurrentFrame(): number;
  export function useCurrentScale(): number;
  export function useVideoConfig(): { fps: number; width: number; height: number; durationInFrames: number };
  export function interpolate(input: number, inputRange: number[], outputRange: number[], options?: { extrapolateLeft?: 'clamp' | 'extend' | 'identity' | 'wrap'; extrapolateRight?: 'clamp' | 'extend' | 'identity' | 'wrap'; easing?: (n: number) => number }): number;
  export function interpolateColors(input: number, inputRange: number[], outputRange: string[]): string;
  export function spring(opts: { frame: number; fps: number; from?: number; to?: number; config?: { damping?: number; stiffness?: number; mass?: number } }): number;
  export function measureSpring(...args: unknown[]): number;
  export function delayRender(label?: string): number;
  export function continueRender(handle: number): void;
  export function cancelRender(error: Error): void;
  export function prefetch(url: string): Promise<void>;
  export function random(seed: string | number | null): number;
  export function staticFile(path: string): string;
  export function watchStaticFile(path: string): string;
  export function getInputProps<T = Record<string, unknown>>(): T;
  export const Easing: { ease: (t: number) => number; linear: (t: number) => number; bezier: (a: number, b: number, c: number, d: number) => (t: number) => number };
}

declare module '@remotion/shapes' {
  import type * as React from 'react';
  export const Rect: React.FC<Record<string, unknown>>;
  export const Circle: React.FC<Record<string, unknown>>;
  export const Triangle: React.FC<Record<string, unknown>>;
  export const Star: React.FC<Record<string, unknown>>;
  export const Polygon: React.FC<Record<string, unknown>>;
  export const Ellipse: React.FC<Record<string, unknown>>;
  export const Heart: React.FC<Record<string, unknown>>;
  export const Pie: React.FC<Record<string, unknown>>;
  export function makeRect(...args: unknown[]): unknown;
  export function makeCircle(...args: unknown[]): unknown;
  export function makeTriangle(...args: unknown[]): unknown;
  export function makeStar(...args: unknown[]): unknown;
  export function makePolygon(...args: unknown[]): unknown;
  export function makeEllipse(...args: unknown[]): unknown;
  export function makeHeart(...args: unknown[]): unknown;
  export function makePie(...args: unknown[]): unknown;
}

declare module '@remotion/transitions' {
  import type * as React from 'react';
  export const TransitionSeries: React.FC<Record<string, unknown>> & {
    Sequence: React.FC<Record<string, unknown>>;
    Transition: React.FC<Record<string, unknown>>;
  };
  export function linearTiming(...args: unknown[]): unknown;
  export function springTiming(...args: unknown[]): unknown;
  export function useTransitionProgress(): number;
}

declare module '@remotion/transitions/fade' {
  export function fade(...args: unknown[]): unknown;
}
declare module '@remotion/transitions/slide' {
  export function slide(...args: unknown[]): unknown;
}
declare module '@remotion/transitions/wipe' {
  export function wipe(...args: unknown[]): unknown;
}
declare module '@remotion/transitions/flip' {
  export function flip(...args: unknown[]): unknown;
}
declare module '@remotion/transitions/clock-wipe' {
  export function clockWipe(...args: unknown[]): unknown;
}
declare module '@remotion/transitions/none' {
  export function none(...args: unknown[]): unknown;
}
declare module '@remotion/transitions/zoom-blur' {
  export function zoomBlur(...args: unknown[]): unknown;
  export function zoomBlurShader(...args: unknown[]): unknown;
}
`;

interface RemotionCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  isStreaming?: boolean;
}

export function RemotionCodeEditor({
  value,
  onChange,
  readOnly = false,
  isStreaming = false,
}: RemotionCodeEditorProps): ReactElement {
  const monacoRef = useRef<Monaco | null>(null);

  const handleEditorMount = useCallback((_editor: unknown, monaco: Monaco) => {
    monacoRef.current = monaco;

    // biome-ignore lint/suspicious/noExplicitAny: Monaco language services are loosely typed here.
    const ts = (monaco.languages as any).typescript;
    if (!ts) return;

    ts.typescriptDefaults?.setCompilerOptions({
      target: ts.ScriptTarget?.ESNext,
      module: ts.ModuleKind?.ESNext,
      jsx: ts.JsxEmit?.Preserve,
      allowNonTsExtensions: true,
      strict: false,
      noEmit: true,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind?.NodeJs,
      skipLibCheck: true,
      allowJs: true,
    });
    ts.typescriptDefaults?.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    ts.typescriptDefaults?.addExtraLib(REMOTION_TYPES, 'remotion.d.ts');
  }, []);

  return (
    <Editor
      height="100%"
      language={isStreaming ? 'plaintext' : 'typescript'}
      theme="vs-dark"
      path="MyComposition.tsx"
      value={value}
      onChange={(next) => onChange(next ?? '')}
      onMount={handleEditorMount}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        padding: { top: 12, bottom: 12 },
        glyphMargin: false,
        lineNumbersMinChars: 3,
        folding: true,
        fontFamily: '"Geist Mono", "JetBrains Mono", Menlo, Consolas, monospace',
        fontLigatures: false,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: 'on',
        renderLineHighlight: 'gutter',
      }}
      loading={
        <div className="flex h-full w-full items-center justify-center bg-[#1e1e1e] text-[12px] text-[rgba(255,255,255,0.4)]">
          Loading editor...
        </div>
      }
    />
  );
}
