import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { ReactElement } from 'react';
import { useCallback, useRef } from 'react';

const REMOTION_TYPES = `
declare module 'remotion' {
  import type * as React from 'react';
  export const AbsoluteFill: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties; className?: string }>;
  export const Sequence: React.FC<{ children?: React.ReactNode; from?: number; durationInFrames?: number; layout?: 'absolute-fill' | 'none' }>;
  export const Series: React.FC<{ children?: React.ReactNode }> & {
    Sequence: React.FC<{ children?: React.ReactNode; durationInFrames: number; offset?: number }>;
  };
  export const Img: React.FC<React.ImgHTMLAttributes<HTMLImageElement>>;
  export function useCurrentFrame(): number;
  export function useVideoConfig(): { fps: number; width: number; height: number; durationInFrames: number };
  export function interpolate(input: number, inputRange: number[], outputRange: number[], options?: { extrapolateLeft?: 'clamp' | 'extend' | 'identity' | 'wrap'; extrapolateRight?: 'clamp' | 'extend' | 'identity' | 'wrap'; easing?: (n: number) => number }): number;
  export function spring(opts: { frame: number; fps: number; from?: number; to?: number; config?: { damping?: number; stiffness?: number; mass?: number } }): number;
  export function random(seed: string | number | null): number;
  export function staticFile(path: string): string;
  export const Easing: { ease: (t: number) => number; linear: (t: number) => number; bezier: (a: number, b: number, c: number, d: number) => (t: number) => number };
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
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleEditorMount = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      monacoRef.current = monaco;
      editorRef.current = editorInstance;

      // biome-ignore lint/suspicious/noExplicitAny: monaco language services are not typed
      const ts = (monaco.languages as any).typescript;
      if (ts) {
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
          // The injected component model intentionally references globals
          // (useCurrentFrame, AbsoluteFill, etc.) and removes imports — full
          // semantic validation would surface false positives. We just want
          // syntax validation and JSX support.
          noSemanticValidation: true,
          noSyntaxValidation: false,
        });
        ts.typescriptDefaults?.addExtraLib(REMOTION_TYPES, 'remotion.d.ts');
      }
    },
    [],
  );

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
          Loading editor…
        </div>
      }
    />
  );
}
