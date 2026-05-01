import {
  buildRemotionProjectFilesFromCode,
  extractAnimationCodeFromHtml,
  extractAnimationTimelineFromCode,
  type AnimationProjectFile,
  OPEN_CODESIGN_ANIMATION_CODE_SCRIPT_ID,
  parseAnimationCodeMeta,
  type AnimationTimelineLane,
} from '@open-codesign/shared';
import { Player, type ErrorFallback, type PlayerRef } from '@remotion/player';
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  Music4,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  StepBack,
  StepForward,
  TimerReset,
  Video,
  X,
} from 'lucide-react';
import type { ExportFormat, ExportInvokeResponse, ExportProgressEvent } from '../../../preload/index';
import type { ReactElement } from 'react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompilation } from '../hooks/useCompilation';
import {
  assembleCompositionSource,
  buildAnimationProjectFilesFromHtml,
  buildAnimationProjectPlaceholderHtml,
  extractProjectCompositions,
  listProjectEditorFiles,
} from '../lib/remotion-project';
import { useCodesignStore } from '../store';

const RemotionCodeEditor = lazy(() =>
  import('./animation/RemotionCodeEditor').then((mod) => ({ default: mod.RemotionCodeEditor })),
);

type LeftTab = 'compositions' | 'assets';
type StudioMenu = 'file' | 'view' | 'tools' | 'render' | null;

interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  onSelect: () => void | Promise<void>;
}

type ExportDialogStatus = 'idle' | 'choosing' | 'exporting' | 'success' | 'error' | 'cancelled';

interface ExportDialogState {
  open: boolean;
  format: ExportFormat;
  status: ExportDialogStatus;
  progress: number;
  message: string;
  exportId: string | null;
  path: string | undefined;
  bytes: number | undefined;
  error: string | undefined;
}

type StudioAssetKind = 'image' | 'video' | 'audio' | 'file';

interface StudioAsset {
  id: string;
  key: string;
  name: string;
  path: string;
  kind: StudioAssetKind;
  dataUrl?: string;
  mimeType?: string;
  size: number;
}

type QuickSwitcherMode = 'default' | 'commands' | 'docs';

interface QuickSwitcherItem {
  id: string;
  label: string;
  subtitle?: string;
  onSelect: () => void;
}

const EXPORT_OPTIONS: Array<{ format: ExportFormat; label: string; hint: string }> = [
  { format: 'mp4', label: 'MP4 video', hint: 'Remotion render' },
  { format: 'html', label: 'HTML snapshot', hint: 'Portable preview' },
  { format: 'pdf', label: 'PDF', hint: 'Static handoff' },
  { format: 'pptx', label: 'PowerPoint', hint: 'Slides' },
  { format: 'zip', label: 'ZIP package', hint: 'Bundle assets' },
  { format: 'markdown', label: 'Markdown', hint: 'Notes + structure' },
];

const STARTER_TEMPLATE = `// @fps 30
// @duration 150
// @width 1920
// @height 1080

import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const introOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const introScale = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 180 },
  });
  const panelY = interpolate(frame, [50, 80], [50, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const panelOpacity = interpolate(frame, [48, 72], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: '#08111f',
        color: '#f6f7fb',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <Sequence name="Intro" from={0} durationInFrames={60}>
        <AbsoluteFill
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              opacity: introOpacity,
              transform: \`scale(\${introScale})\`,
              fontSize: 96,
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            Hello Remotion
          </div>
        </AbsoluteFill>
      </Sequence>

      <Sequence name="Details" from={54} durationInFrames={72}>
        <AbsoluteFill
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            padding: 80,
          }}
        >
          <div
            style={{
              width: 720,
              borderRadius: 28,
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              padding: '36px 40px',
              transform: \`translateY(\${panelY}px)\`,
              opacity: panelOpacity,
              boxShadow: '0 32px 80px rgba(0,0,0,0.24)',
            }}
          >
            <div style={{ fontSize: 18, color: 'rgba(246,247,251,0.65)' }}>Starter scene</div>
            <div style={{ marginTop: 14, fontSize: 44, fontWeight: 650, lineHeight: 1.05 }}>
              Add more beats with Sequence or Series.Sequence
            </div>
            <div
              style={{
                marginTop: 18,
                maxWidth: 520,
                fontSize: 22,
                lineHeight: 1.45,
                color: 'rgba(246,247,251,0.72)',
              }}
            >
              The timeline below will lay out each scene automatically once the composition is structured.
            </div>
          </div>
        </AbsoluteFill>
      </Sequence>
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

function laneColor(lane: AnimationTimelineLane): string {
  const palette =
    lane.kind === 'series'
      ? ['#6f7cff', '#5ea8ff', '#52d3b8', '#b480ff']
      : ['#ff8a5b', '#ffbc57', '#ff6a7a', '#f59e0b'];
  return palette[lane.depth % palette.length] ?? palette[0] ?? '#6f7cff';
}

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

function formatExportSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExportExtension(format: ExportFormat): string {
  return format === 'markdown' ? 'md' : format;
}

function slugifyFilenamePart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'animation';
}

function makeExportId(): string {
  return `animation-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function inferAssetKind(mimeType: string | undefined, name: string): StudioAssetKind {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(lower)) return 'video';
  if (/\.(mp3|wav|ogg|m4a)$/.test(lower)) return 'audio';
  return 'file';
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
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

function withAnimationCodeHtml(baseHtml: string, code: string): string {
  const scriptTag = `<script id="${OPEN_CODESIGN_ANIMATION_CODE_SCRIPT_ID}" type="text/plain">\n${code}\n</script>`;
  if (!baseHtml.trim()) {
    return [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <title>Animation Export</title>',
      '  </head>',
      '  <body>',
      `    ${scriptTag}`,
      '  </body>',
      '</html>',
    ].join('\n');
  }

  const existing = new RegExp(
    `<script[^>]*id=["']${OPEN_CODESIGN_ANIMATION_CODE_SCRIPT_ID}["'][^>]*>[\\s\\S]*?<\\/script>`,
    'i',
  );
  if (existing.test(baseHtml)) {
    return baseHtml.replace(existing, scriptTag);
  }
  if (baseHtml.includes('</body>')) {
    return baseHtml.replace('</body>', `  ${scriptTag}\n</body>`);
  }
  return `${baseHtml}\n${scriptTag}`;
}

interface AnimationStudioPanelProps {
  html: string;
}

export function AnimationStudioPanel({ html }: AnimationStudioPanelProps): ReactElement {
  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const inputFiles = useCodesignStore((s) => s.inputFiles);
  const isGenerating = useCodesignStore((s) => s.isGenerating);
  const generatingDesignId = useCodesignStore((s) => s.generatingDesignId);
  const pickInputFiles = useCodesignStore((s) => s.pickInputFiles);
  const removeInputFile = useCodesignStore((s) => s.removeInputFile);
  const setPreviewHtml = useCodesignStore((s) => s.setPreviewHtml);
  const lastFsUpdate = useCodesignStore((s) => s.lastFsUpdate);
  const generatedCode = useMemo(() => extractAnimationCodeFromHtml(html), [html]);
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<AnimationProjectFile[]>([]);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [selectedCompositionId, setSelectedCompositionId] = useState<string | null>(null);
  const [editorPath, setEditorPath] = useState<string>('src/compositions/MyComposition.tsx');
  const [leftTab, setLeftTab] = useState<LeftTab>('compositions');
  const [showCodePanel, setShowCodePanel] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<StudioMenu>(null);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [quickSwitcherQuery, setQuickSwitcherQuery] = useState('');
  const [quickSwitcherIndex, setQuickSwitcherIndex] = useState(0);
  const [exportDialog, setExportDialog] = useState<ExportDialogState>({
    open: false,
    format: 'mp4',
    status: 'idle',
    progress: 0,
    message: 'Choose an export format to render or package this animation.',
    exportId: null,
    path: undefined,
    bytes: undefined,
    error: undefined,
  });
  const playerRef = useRef<PlayerRef>(null);
  const menuBarRef = useRef<HTMLDivElement | null>(null);
  const exportHasLiveProgressRef = useRef(false);
  const quickSwitcherInputRef = useRef<HTMLInputElement | null>(null);

  const loadProjectFiles = useCallback(
    async (seedIfMissing: boolean) => {
      if (!currentDesignId || !window.codesign?.files?.list || !window.codesign.files.view) {
        const fallback = buildRemotionProjectFilesFromCode(generatedCode ?? STARTER_TEMPLATE);
        setProjectFiles(fallback);
        setProjectLoading(false);
        setProjectError(null);
        return;
      }

      setProjectLoading(true);
      setProjectError(null);
      try {
        const listed = await window.codesign.files.list(currentDesignId);
        const relevant = listed.filter(
          (file) => file.path.startsWith('src/') || file.path === 'index.html' || file.path.startsWith('assets/'),
        );
        const hydrated = (
          await Promise.all(
            relevant.map(async (file) => {
              const viewed = await window.codesign?.files?.view(currentDesignId, file.path);
              return viewed ? { path: viewed.path, content: viewed.content } : null;
            }),
          )
        ).filter((file): file is AnimationProjectFile => file !== null);

        const hasRoot = hydrated.some((file) => file.path === 'src/Root.tsx');
        const hasEntry = hydrated.some((file) => file.path === 'src/index.ts' || file.path === 'src/index.tsx');
        const hasComposition = hydrated.some((file) => file.path.startsWith('src/compositions/'));

        if ((!hasRoot || !hasEntry || !hasComposition) && seedIfMissing && window.codesign.files.upsert) {
          const seeded = buildAnimationProjectFilesFromHtml(html, STARTER_TEMPLATE);
          for (const file of seeded) {
            await window.codesign.files.upsert(currentDesignId, file.path, file.content);
          }
          setPreviewHtml(buildAnimationProjectPlaceholderHtml(seeded[2]?.content ?? STARTER_TEMPLATE));
          setProjectFiles(seeded);
          setProjectLoading(false);
          return;
        }

        if (hydrated.length === 0 && seedIfMissing && window.codesign.files.upsert) {
          const seeded = buildRemotionProjectFilesFromCode(generatedCode ?? STARTER_TEMPLATE);
          for (const file of seeded) {
            await window.codesign.files.upsert(currentDesignId, file.path, file.content);
          }
          setPreviewHtml(buildAnimationProjectPlaceholderHtml(seeded[2]?.content ?? STARTER_TEMPLATE));
          setProjectFiles(seeded);
          setProjectLoading(false);
          return;
        }

        setProjectFiles(hydrated);
      } catch (error) {
        setProjectError(error instanceof Error ? error.message : String(error));
      } finally {
        setProjectLoading(false);
      }
    },
    [currentDesignId, generatedCode, html, setPreviewHtml],
  );

  useEffect(() => {
    setEditedCode(null);
    setCurrentFrame(0);
  }, [generatedCode]);

  useEffect(() => {
    void loadProjectFiles(true);
  }, [loadProjectFiles]);

  useEffect(() => {
    if (!lastFsUpdate || lastFsUpdate.designId !== currentDesignId) return;
    if (
      lastFsUpdate.path !== 'index.html' &&
      !lastFsUpdate.path.startsWith('src/') &&
      !lastFsUpdate.path.startsWith('assets/')
    ) {
      return;
    }
    void loadProjectFiles(false);
  }, [currentDesignId, lastFsUpdate, loadProjectFiles]);

  useEffect(() => {
    if (!isGenerating || generatingDesignId !== currentDesignId) return;
    const timer = window.setInterval(() => {
      void loadProjectFiles(false);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [currentDesignId, generatingDesignId, isGenerating, loadProjectFiles]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const frame = player.getCurrentFrame();
      setCurrentFrame(frame);
    }, 80);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!activeMenu) return;
    function onPointerDown(event: MouseEvent): void {
      if (!menuBarRef.current) return;
      if (event.target instanceof Node && menuBarRef.current.contains(event.target)) return;
      setActiveMenu(null);
    }
    function onEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') setActiveMenu(null);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [activeMenu]);

  useEffect(() => {
    if (!window.codesign?.onExportProgress) return;
    return window.codesign.onExportProgress((event: ExportProgressEvent) => {
      setExportDialog((current) => {
        if (!current.open || !current.exportId || current.exportId !== event.exportId) {
          return current;
        }
        exportHasLiveProgressRef.current = true;
        return {
          ...current,
          status: event.phase === 'done' ? 'exporting' : 'exporting',
          progress: Math.max(current.progress, Math.min(0.99, event.progress)),
          message: event.message,
        };
      });
    });
  }, []);

  useEffect(() => {
    if (!exportDialog.open) {
      exportHasLiveProgressRef.current = false;
      return;
    }
    if (exportDialog.status !== 'choosing' && exportDialog.status !== 'exporting') return;
    const timer = window.setInterval(() => {
      if (exportHasLiveProgressRef.current) return;
      setExportDialog((current) => {
        if (current.status !== 'choosing' && current.status !== 'exporting') return current;
        const ceiling = current.status === 'choosing' ? 0.16 : 0.84;
        const increment = current.status === 'choosing' ? 0.01 : 0.03;
        return {
          ...current,
          progress: Math.min(ceiling, current.progress + increment),
        };
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, [exportDialog.open, exportDialog.status]);

  const projectCompositions = useMemo(() => extractProjectCompositions(projectFiles), [projectFiles]);
  const selectedComposition = useMemo(() => {
    if (projectCompositions.length === 0) return null;
    return (
      projectCompositions.find((composition) => composition.id === selectedCompositionId) ??
      projectCompositions[0] ??
      null
    );
  }, [projectCompositions, selectedCompositionId]);
  const editorFiles = useMemo(
    () => listProjectEditorFiles(projectFiles, selectedComposition),
    [projectFiles, selectedComposition],
  );
  const persistedEditorCode = useMemo(
    () => projectFiles.find((file) => file.path === editorPath)?.content ?? '',
    [editorPath, projectFiles],
  );
  const code = editedCode ?? persistedEditorCode;
  const showStarter = projectFiles.length === 0 || editorFiles.length === 0;
  const workingProjectFiles = useMemo(() => {
    if (!editorPath || projectFiles.length === 0) return projectFiles;
    return projectFiles.map((file) => (file.path === editorPath ? { ...file, content: code } : file));
  }, [code, editorPath, projectFiles]);
  const workingComposition = useMemo(() => {
    if (!selectedComposition) return null;
    return (
      extractProjectCompositions(workingProjectFiles).find(
        (composition) => composition.id === selectedComposition.id,
      ) ?? selectedComposition
    );
  }, [selectedComposition, workingProjectFiles]);
  const projectCompileSource = useMemo(
    () =>
      workingComposition
        ? assembleCompositionSource(workingProjectFiles, workingComposition)
        : null,
    [workingComposition, workingProjectFiles],
  );
  const codeForCompilation = projectCompileSource ?? (showStarter ? STARTER_TEMPLATE : code);
  const studioAssets = useMemo<StudioAsset[]>(
    () =>
      inputFiles.map((file) => ({
        id: file.path,
        key: file.name,
        name: file.name,
        path: file.path,
        kind: inferAssetKind(file.mimeType, file.name),
        ...(file.dataUrl ? { dataUrl: file.dataUrl } : {}),
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        size: file.size,
      })),
    [inputFiles],
  );
  const compileAssets = useMemo(
    () =>
      studioAssets
        .filter((asset) => typeof asset.dataUrl === 'string' && asset.dataUrl.length > 0)
        .flatMap((asset) => [
          { key: asset.name, dataUrl: asset.dataUrl as string },
          { key: asset.path, dataUrl: asset.dataUrl as string },
        ]),
    [studioAssets],
  );
  const compilationOptions = useMemo(
    () =>
      projectCompileSource
        ? {
            componentNameOverride: '__OpenCodesignSelectedComposition',
          }
        : undefined,
    [projectCompileSource],
  );
  const { Component, error } = useCompilation(codeForCompilation, compileAssets, compilationOptions);
  const fallbackMeta = useMemo(() => parseAnimationCodeMeta(codeForCompilation), [codeForCompilation]);
  const selectedCompositionCode = useMemo(() => {
    if (!selectedComposition?.filePath) return code;
    return workingProjectFiles.find((file) => file.path === selectedComposition.filePath)?.content ?? code;
  }, [code, selectedComposition, workingProjectFiles]);
  const meta = useMemo(
    () =>
      workingComposition
        ? {
            fps: workingComposition.fps,
            durationInFrames: workingComposition.durationInFrames,
            width: workingComposition.width,
            height: workingComposition.height,
          }
        : fallbackMeta,
    [fallbackMeta, workingComposition],
  );
  const compositionName = useMemo(
    () => workingComposition?.id ?? extractCompositionName(codeForCompilation),
    [codeForCompilation, workingComposition],
  );
  const assetRefs = useMemo(() => extractAssetRefs(selectedCompositionCode), [selectedCompositionCode]);
  const timelineLanes = useMemo(
    () => extractAnimationTimelineFromCode(selectedCompositionCode),
    [selectedCompositionCode],
  );
  const isPlaying = playerRef.current?.isPlaying() ?? false;

  const visibleLanes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return timelineLanes;
    return timelineLanes.filter((lane) => lane.label.toLowerCase().includes(query));
  }, [searchQuery, timelineLanes]);

  const visibleAssets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return studioAssets;
    return studioAssets.filter(
      (asset) =>
        asset.name.toLowerCase().includes(query) ||
        asset.path.toLowerCase().includes(query) ||
        asset.kind.toLowerCase().includes(query),
    );
  }, [searchQuery, studioAssets]);

  useEffect(() => {
    if (!selectedComposition && projectCompositions.length === 0) {
      setSelectedCompositionId(null);
      return;
    }
    if (selectedComposition) return;
    setSelectedCompositionId(projectCompositions[0]?.id ?? null);
  }, [projectCompositions, selectedComposition]);

  useEffect(() => {
    if (selectedComposition?.filePath && selectedComposition.filePath !== editorPath) {
      setEditorPath(selectedComposition.filePath);
    }
  }, [editorPath, selectedComposition]);

  useEffect(() => {
    setEditedCode(null);
  }, [currentDesignId, editorPath]);

  useEffect(() => {
    if (visibleLanes.length === 0) {
      setSelectedLaneId(null);
      return;
    }
    if (selectedLaneId && visibleLanes.some((lane) => lane.id === selectedLaneId)) return;
    setSelectedLaneId(visibleLanes[0]?.id ?? null);
  }, [selectedLaneId, visibleLanes]);

  const activeLaneIds = useMemo(
    () =>
      new Set(
        timelineLanes
          .filter((lane) => currentFrame >= lane.startFrame && currentFrame < lane.endFrame)
          .map((lane) => lane.id),
      ),
    [currentFrame, timelineLanes],
  );

  const timelineRows = Math.max(visibleLanes.length, 1);
  const timelineHeight = 46 + timelineRows * 34;

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

  const quickSwitcherMode: QuickSwitcherMode = quickSwitcherQuery.startsWith('>')
    ? 'commands'
    : quickSwitcherQuery.startsWith('?')
      ? 'docs'
      : 'default';

  useEffect(() => {
    if (
      editedCode === null ||
      !currentDesignId ||
      !editorPath ||
      !window.codesign?.files?.upsert
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void window.codesign?.files
        ?.upsert(currentDesignId, editorPath, editedCode)
        .then((saved) => {
          setProjectFiles((current) => {
            const next = current.filter((file) => file.path !== saved.path);
            return [...next, { path: saved.path, content: saved.content }].sort((a, b) =>
              a.path.localeCompare(b.path),
            );
          });
          if (selectedComposition?.filePath === saved.path) {
            setPreviewHtml(buildAnimationProjectPlaceholderHtml(saved.content));
          }
        })
        .catch((error) => {
          setProjectError(error instanceof Error ? error.message : String(error));
        });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [currentDesignId, editedCode, editorPath, selectedComposition, setPreviewHtml]);

  const handleCodeChange = useCallback((next: string) => setEditedCode(next), []);
  const handleResetEdits = useCallback(() => setEditedCode(null), []);
  const handleEditStarter = useCallback(() => {
    setEditedCode(STARTER_TEMPLATE);
    if (!editorPath) setEditorPath('src/compositions/MyComposition.tsx');
  }, [editorPath]);
  const handleSeek = useCallback((frame: number) => {
    playerRef.current?.seekTo(frame);
    setCurrentFrame(frame);
  }, []);
  const handleSelectLane = useCallback(
    (lane: AnimationTimelineLane) => {
      setSelectedLaneId(lane.id);
      handleSeek(lane.startFrame);
    },
    [handleSeek],
  );
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
  const closeExportDialog = useCallback(() => {
    exportHasLiveProgressRef.current = false;
    setExportDialog({
      open: false,
      format: 'mp4',
      status: 'idle',
      progress: 0,
      message: 'Choose an export format to render or package this animation.',
      exportId: null,
      path: undefined,
      bytes: undefined,
      error: undefined,
    });
  }, []);
  const openExportDialog = useCallback((format: ExportFormat) => {
    exportHasLiveProgressRef.current = false;
    setExportDialog({
      open: true,
      format,
      status: 'idle',
      progress: 0,
      message: format === 'mp4' ? 'Render an MP4 using the Remotion export pipeline.' : 'Export the current animation artifact.',
      exportId: null,
      path: undefined,
      bytes: undefined,
      error: undefined,
    });
  }, []);
  const handleRunExport = useCallback(async () => {
    if (!window.codesign) {
      setExportDialog((current) => ({
        ...current,
        status: 'error',
        progress: 0,
        error: 'Renderer bridge is unavailable.',
        message: 'Export is unavailable because the renderer bridge is disconnected.',
      }));
      return;
    }

    const exportId = makeExportId();
    const format = exportDialog.format;
    const extension = getExportExtension(format);
    const defaultFilename = `${slugifyFilenamePart(compositionName)}-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19)}.${extension}`;

    exportHasLiveProgressRef.current = false;
    setExportDialog((current) => ({
      ...current,
      status: 'choosing',
      progress: 0.04,
      exportId,
      path: undefined,
      bytes: undefined,
      error: undefined,
      message: 'Choose where to save the export.',
    }));

    try {
      const exportHtml =
        selectedComposition?.filePath && selectedCompositionCode
          ? buildAnimationProjectPlaceholderHtml(selectedCompositionCode)
          : editedCode !== null || showStarter
            ? withAnimationCodeHtml(html, codeForCompilation)
            : html;
      const result: ExportInvokeResponse = await window.codesign.export({
        format,
        htmlContent: exportHtml,
        defaultFilename,
        exportId,
        ...(workingProjectFiles.length > 0 ? { projectFiles: workingProjectFiles } : {}),
        ...(selectedComposition?.id ? { compositionId: selectedComposition.id } : {}),
      });
      if (result.status === 'cancelled') {
        exportHasLiveProgressRef.current = false;
        setExportDialog((current) => ({
          ...current,
          status: 'cancelled',
          progress: 0,
          exportId: null,
          message: 'Export cancelled.',
        }));
        return;
      }

      exportHasLiveProgressRef.current = false;
      setExportDialog((current) => ({
        ...current,
        status: 'success',
        progress: 1,
        exportId: null,
        path: result.path,
        bytes: result.bytes,
        message: 'Export finished successfully.',
      }));
    } catch (error) {
      exportHasLiveProgressRef.current = false;
      setExportDialog((current) => ({
        ...current,
        status: 'error',
        exportId: null,
        error: error instanceof Error ? error.message : String(error),
        message: 'Export failed.',
      }));
    }
  }, [
    codeForCompilation,
    compositionName,
    editedCode,
    exportDialog.format,
    html,
    selectedComposition,
    selectedCompositionCode,
    showStarter,
    workingProjectFiles,
  ]);
  const handleShowExportedItem = useCallback(() => {
    if (!exportDialog.path || !/[\\/]/.test(exportDialog.path)) return;
    void window.codesign?.diagnostics?.showItemInFolder(exportDialog.path);
  }, [exportDialog.path]);
  const openExternalDoc = useCallback((url: string) => {
    void window.codesign?.openExternal(url);
  }, []);
  const handleAttachAssets = useCallback(() => {
    void pickInputFiles();
    setLeftTab('assets');
  }, [pickInputFiles]);
  const copyToClipboard = useCallback((value: string, message: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setExportDialog((current) =>
          current.open
            ? current
            : {
                ...current,
                open: false,
                status: current.status,
                message,
              },
        );
      },
      () => {},
    );
  }, []);
  const handleCopyAssetRef = useCallback(
    (asset: StudioAsset) => {
      copyToClipboard(`staticFile("${asset.name}")`, `Copied staticFile("${asset.name}")`);
    },
    [copyToClipboard],
  );
  const handleCopyAssetName = useCallback(
    (asset: StudioAsset) => {
      copyToClipboard(asset.name, `Copied ${asset.name}`);
    },
    [copyToClipboard],
  );
  const commandItems = useMemo<QuickSwitcherItem[]>(
    () => [
      {
        id: 'command-render',
        label: 'Render MP4 video',
        subtitle: 'Open export dialog',
        onSelect: () => openExportDialog('mp4'),
      },
      {
        id: 'command-assets',
        label: 'Attach local assets',
        subtitle: 'Add images, video or audio to this project',
        onSelect: handleAttachAssets,
      },
      {
        id: 'command-toggle-code',
        label: showCodePanel ? 'Hide code panel' : 'Show code panel',
        subtitle: 'Toggle the right-hand editor',
        onSelect: () => setShowCodePanel((value) => !value),
      },
      {
        id: 'command-compositions',
        label: 'Open compositions rail',
        subtitle: 'Switch left panel',
        onSelect: () => setLeftTab('compositions'),
      },
      {
        id: 'command-assets-rail',
        label: 'Open assets rail',
        subtitle: 'Switch left panel',
        onSelect: () => setLeftTab('assets'),
      },
    ],
    [handleAttachAssets, openExportDialog, showCodePanel],
  );
  const docItems = useMemo<QuickSwitcherItem[]>(
    () => [
      {
        id: 'doc-studio',
        label: 'Starting the Studio',
        subtitle: 'Official Remotion docs',
        onSelect: () => openExternalDoc('https://www.remotion.dev/docs/studio'),
      },
      {
        id: 'doc-keyboard',
        label: 'Keyboard navigation',
        subtitle: 'Official Remotion docs',
        onSelect: () => openExternalDoc('https://www.remotion.dev/docs/studio/keyboard-navigation'),
      },
      {
        id: 'doc-switcher',
        label: 'Quick switcher',
        subtitle: 'Official Remotion docs',
        onSelect: () => openExternalDoc('https://www.remotion.dev/docs/studio/quick-switcher'),
      },
      {
        id: 'doc-ai',
        label: 'Building with Remotion and AI',
        subtitle: 'Official Remotion docs',
        onSelect: () => openExternalDoc('https://www.remotion.dev/docs/ai'),
      },
      {
        id: 'doc-compile',
        label: 'Just-in-time compilation',
        subtitle: 'Official Remotion docs',
        onSelect: () => openExternalDoc('https://www.remotion.dev/docs/ai/dynamic-compilation'),
      },
    ],
    [openExternalDoc],
  );
  const defaultQuickItems = useMemo<QuickSwitcherItem[]>(
    () => [
      ...projectCompositions.map((composition) => ({
        id: `composition:${composition.id}`,
        label: composition.id,
        subtitle: `${composition.width}x${composition.height} / ${composition.fps} FPS / ${formatDuration(composition.durationInFrames, composition.fps)}${currentDesignId ? ` / ${currentDesignId}` : ''}`,
        onSelect: () => {
          setLeftTab('compositions');
          setSelectedCompositionId(composition.id);
          handleSeek(0);
        },
      })),
      ...studioAssets.map((asset) => ({
        id: `asset:${asset.id}`,
        label: asset.name,
        subtitle: `${asset.kind} / ${asset.path}`,
        onSelect: () => {
          setLeftTab('assets');
          handleCopyAssetRef(asset);
        },
      })),
    ],
    [
      handleCopyAssetRef,
      handleSeek,
      currentDesignId,
      projectCompositions,
      studioAssets,
    ],
  );
  const filteredQuickItems = useMemo(() => {
    const rawQuery = quickSwitcherQuery.trim();
    const query =
      quickSwitcherMode === 'commands' || quickSwitcherMode === 'docs'
        ? rawQuery.slice(1).trim().toLowerCase()
        : rawQuery.toLowerCase();
    const source =
      quickSwitcherMode === 'commands'
        ? commandItems
        : quickSwitcherMode === 'docs'
          ? docItems
          : defaultQuickItems;
    if (!query) return source;
    return source.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.subtitle?.toLowerCase().includes(query),
    );
  }, [commandItems, defaultQuickItems, docItems, quickSwitcherMode, quickSwitcherQuery]);

  useEffect(() => {
    if (!quickSwitcherOpen) return;
    setQuickSwitcherIndex(0);
    const timer = window.setTimeout(() => quickSwitcherInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [quickSwitcherOpen]);

  useEffect(() => {
    setQuickSwitcherIndex((current) =>
      filteredQuickItems.length === 0 ? 0 : Math.min(current, filteredQuickItems.length - 1),
    );
  }, [filteredQuickItems.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const metaOrCtrl = event.metaKey || event.ctrlKey;
      if (metaOrCtrl && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuickSwitcherOpen(true);
        return;
      }
      if (quickSwitcherOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setQuickSwitcherOpen(false);
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setQuickSwitcherIndex((current) =>
            filteredQuickItems.length === 0 ? 0 : (current + 1) % filteredQuickItems.length,
          );
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setQuickSwitcherIndex((current) =>
            filteredQuickItems.length === 0
              ? 0
              : (current - 1 + filteredQuickItems.length) % filteredQuickItems.length,
          );
          return;
        }
        if (event.key === 'Enter') {
          const selected = filteredQuickItems[quickSwitcherIndex];
          if (!selected) return;
          event.preventDefault();
          selected.onSelect();
          setQuickSwitcherOpen(false);
          return;
        }
        return;
      }
      if (isTypingTarget(event.target) || exportDialog.open) return;
      if (event.code === 'Space') {
        event.preventDefault();
        handleTogglePlayback();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekBy(event.shiftKey ? -meta.fps : -1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekBy(event.shiftKey ? meta.fps : 1);
        return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    exportDialog.open,
    filteredQuickItems,
    handleTogglePlayback,
    meta.fps,
    quickSwitcherIndex,
    quickSwitcherOpen,
    seekBy,
  ]);
  const runMenuAction = useCallback((action: () => void | Promise<void>) => {
    setActiveMenu(null);
    void action();
  }, []);

  const fileMenuItems = useMemo<MenuItem[]>(
    () => [
      {
        id: 'file-export-mp4',
        label: 'Export MP4 video',
        hint: 'Remotion render',
        onSelect: () => openExportDialog('mp4'),
      },
      {
        id: 'file-export-html',
        label: 'Export HTML snapshot',
        hint: '.html',
        onSelect: () => openExportDialog('html'),
      },
      {
        id: 'file-export-pdf',
        label: 'Export PDF',
        hint: '.pdf',
        onSelect: () => openExportDialog('pdf'),
      },
      {
        id: 'file-export-pptx',
        label: 'Export PowerPoint',
        hint: '.pptx',
        onSelect: () => openExportDialog('pptx'),
      },
      {
        id: 'file-export-zip',
        label: 'Export ZIP package',
        hint: '.zip',
        onSelect: () => openExportDialog('zip'),
      },
      {
        id: 'file-export-markdown',
        label: 'Export Markdown',
        hint: '.md',
        onSelect: () => openExportDialog('markdown'),
      },
    ],
    [openExportDialog],
  );

  const viewMenuItems = useMemo<MenuItem[]>(
    () => [
      {
        id: 'view-toggle-code',
        label: showCodePanel ? 'Hide code panel' : 'Show code panel',
        hint: 'Side panel',
        onSelect: () => setShowCodePanel((value) => !value),
      },
      {
        id: 'view-compositions',
        label: 'Show compositions rail',
        hint: 'Left panel',
        onSelect: () => setLeftTab('compositions'),
      },
      {
        id: 'view-assets',
        label: 'Show assets rail',
        hint: 'Left panel',
        onSelect: () => setLeftTab('assets'),
      },
      {
        id: 'view-fullscreen',
        label: 'Open fullscreen preview',
        hint: 'Player',
        onSelect: handleFullscreen,
      },
    ],
    [handleFullscreen, showCodePanel],
  );

  const toolsMenuItems = useMemo<MenuItem[]>(
    () => [
      {
        id: 'tools-docs-studio',
        label: 'Open Remotion Studio docs',
        hint: 'Official docs',
        onSelect: () => openExternalDoc('https://www.remotion.dev/docs/studio'),
      },
      {
        id: 'tools-docs-ai',
        label: 'Open Remotion AI docs',
        hint: 'Official docs',
        onSelect: () => openExternalDoc('https://www.remotion.dev/docs/ai'),
      },
      {
        id: 'tools-docs-compile',
        label: 'Open JIT compilation guide',
        hint: 'Dynamic compilation',
        onSelect: () => openExternalDoc('https://www.remotion.dev/docs/ai/dynamic-compilation'),
      },
      {
        id: 'tools-docs-prompt',
        label: 'Open system prompt guide',
        hint: 'LLM integration',
        onSelect: () => openExternalDoc('https://www.remotion.dev/docs/ai/system-prompt'),
      },
    ],
    [openExternalDoc],
  );

  const renderMenuItems = useMemo<MenuItem[]>(
    () => [
      {
        id: 'render-mp4',
        label: 'Render MP4 video',
        hint: 'Open export dialog',
        onSelect: () => openExportDialog('mp4'),
      },
    ],
    [openExportDialog],
  );
  const canShowExportedItem =
    exportDialog.status === 'success' &&
    typeof exportDialog.path === 'string' &&
    /[\\/]/.test(exportDialog.path) &&
    Boolean(window.codesign?.diagnostics?.showItemInFolder);

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
      {projectLoading || projectError ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[rgba(255,255,255,0.06)] bg-[#15191d] px-3 py-2 text-[11px]">
          {projectLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[rgba(255,255,255,0.5)]" /> : null}
          {projectError ? <AlertCircle className="h-3.5 w-3.5 text-red-400" /> : null}
          <span className={projectError ? 'text-red-300' : 'text-[rgba(255,255,255,0.58)]'}>
            {projectError ?? 'Syncing Remotion project files...'}
          </span>
        </div>
      ) : null}

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
                <div className="mt-2 flex items-center gap-2 text-[10.5px] text-[rgba(255,255,255,0.5)]">
                  <span>{projectCompositions.length} composition{projectCompositions.length === 1 ? '' : 's'}</span>
                  <span>/</span>
                  <span>{timelineLanes.length} timed lane{timelineLanes.length === 1 ? '' : 's'}</span>
                  <span>/</span>
                  <span>{assetRefs.length} asset{assetRefs.length === 1 ? '' : 's'}</span>
                </div>
              </div>
              <div className="px-3 py-2">
                <label className="flex items-center gap-2 rounded-md border border-[rgba(255,255,255,0.08)] bg-[#14171a] px-2 py-1.5 text-[11px] text-[rgba(255,255,255,0.45)]">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search sequences"
                    className="min-w-0 flex-1 bg-transparent text-[11px] text-[rgba(255,255,255,0.72)] outline-none placeholder:text-[rgba(255,255,255,0.35)]"
                  />
                </label>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
                <div className="space-y-1">
                  {projectCompositions.map((composition) => {
                    const active = composition.id === selectedComposition?.id;
                    return (
                      <button
                        key={composition.id}
                        type="button"
                        onClick={() => {
                          setSelectedCompositionId(composition.id);
                          setCurrentFrame(0);
                          handleSeek(0);
                        }}
                        className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                          active
                            ? 'border-[rgba(111,124,255,0.45)] bg-[rgba(111,124,255,0.14)]'
                            : 'border-[rgba(255,255,255,0.05)] bg-[#14171a] hover:bg-[#1b2026]'
                        }`}
                      >
                        <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-[rgba(255,255,255,0.65)]" />
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-medium text-[rgba(255,255,255,0.95)]">
                            {composition.id}
                          </div>
                          <div className="mt-0.5 text-[10.5px] text-[rgba(255,255,255,0.5)]">
                            {composition.width}x{composition.height}, {composition.fps} FPS
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 space-y-1">
                  {visibleLanes.length > 0 ? (
                    visibleLanes.map((lane) => {
                      const selected = lane.id === selectedLaneId;
                      const active = activeLaneIds.has(lane.id);
                      return (
                        <button
                          key={lane.id}
                          type="button"
                          onClick={() => handleSelectLane(lane)}
                          className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                            selected
                              ? 'border-[rgba(111,124,255,0.45)] bg-[rgba(111,124,255,0.14)]'
                              : 'border-[rgba(255,255,255,0.05)] bg-[#14171a] hover:bg-[#1b2026]'
                          }`}
                        >
                          <span
                            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: laneColor(lane) }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[11.5px] font-medium text-[rgba(255,255,255,0.92)]">
                                {lane.label}
                              </span>
                              {active ? (
                                <span className="rounded-full bg-[rgba(255,255,255,0.1)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-[rgba(255,255,255,0.76)]">
                                  live
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 text-[10px] text-[rgba(255,255,255,0.46)]">
                              {lane.kind === 'series' ? 'Series' : 'Sequence'} /{' '}
                              {formatFrameClock(lane.startFrame, meta.fps)} -{' '}
                              {formatFrameClock(lane.endFrame, meta.fps)}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-md border border-dashed border-[rgba(255,255,255,0.08)] bg-[#14171a] px-4 py-5 text-[11px] leading-[1.6] text-[rgba(255,255,255,0.5)]">
                      No explicit `Sequence` or `Series.Sequence` blocks yet. The studio will lay out lanes as soon as the composition is scene-structured.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-[rgba(255,255,255,0.06)] px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-semibold text-[rgba(255,255,255,0.95)]">Project assets</div>
                    <div className="mt-1 text-[11px] text-[rgba(255,255,255,0.48)]">
                      Attach local media, then reference it in code with <code>staticFile("filename")</code>.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAttachAssets}
                    className="inline-flex items-center gap-1 rounded-md border border-[rgba(255,255,255,0.08)] bg-[#14171a] px-2.5 py-1.5 text-[11px] text-[rgba(255,255,255,0.82)] transition-colors hover:bg-[#1b2026]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>
                <div className="mt-3">
                  <label className="flex items-center gap-2 rounded-md border border-[rgba(255,255,255,0.08)] bg-[#14171a] px-2 py-1.5 text-[11px] text-[rgba(255,255,255,0.45)]">
                    <Search className="h-3.5 w-3.5" />
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search assets"
                      className="min-w-0 flex-1 bg-transparent text-[11px] text-[rgba(255,255,255,0.72)] outline-none placeholder:text-[rgba(255,255,255,0.35)]"
                    />
                  </label>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
                {visibleAssets.length > 0 ? (
                  <div className="space-y-2">
                    {visibleAssets.map((asset) => (
                      <div
                        key={asset.id}
                        className="rounded-md border border-[rgba(255,255,255,0.06)] bg-[#14171a] p-2"
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#0f1114]">
                            {asset.kind === 'image' && asset.dataUrl ? (
                              <img src={asset.dataUrl} alt={asset.name} className="h-full w-full object-cover" />
                            ) : asset.kind === 'video' ? (
                              <Video className="h-4 w-4 text-[rgba(255,255,255,0.55)]" />
                            ) : asset.kind === 'audio' ? (
                              <Music4 className="h-4 w-4 text-[rgba(255,255,255,0.55)]" />
                            ) : (
                              <ImageIcon className="h-4 w-4 text-[rgba(255,255,255,0.55)]" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-medium text-[rgba(255,255,255,0.92)]">
                              {asset.name}
                            </div>
                            <div className="mt-0.5 truncate text-[10px] text-[rgba(255,255,255,0.45)]">
                              {asset.path}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[rgba(255,255,255,0.42)]">
                              <span>{asset.kind}</span>
                              <span>/</span>
                              <span>{formatExportSize(asset.size)}</span>
                              {assetRefs.includes(asset.name) ? (
                                <>
                                  <span>/</span>
                                  <span className="text-[rgba(124,156,255,0.82)]">in code</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleCopyAssetRef(asset)}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10.5px] text-[rgba(255,255,255,0.82)] transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                          >
                            <Copy className="h-3 w-3" />
                            Copy staticFile()
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyAssetName(asset)}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10.5px] text-[rgba(255,255,255,0.62)] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.9)]"
                          >
                            Copy name
                          </button>
                          <button
                            type="button"
                            onClick={() => removeInputFile(asset.path)}
                            className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[10.5px] text-[rgba(255,255,255,0.48)] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.88)]"
                          >
                            <X className="h-3 w-3" />
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-[rgba(255,255,255,0.08)] bg-[#14171a] px-4 py-5 text-[11px] leading-[1.6] text-[rgba(255,255,255,0.5)]">
                    No project assets yet. Add local media here, then reference it inside the composition using <code>staticFile("filename")</code>.
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-[#111315]">
          <div
            ref={menuBarRef}
            className="relative flex h-8 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-[#181b1f] px-3 text-[11px]"
          >
            <div className="flex items-center gap-1 text-[rgba(255,255,255,0.55)]">
              <StudioMenuButton
                label="File"
                open={activeMenu === 'file'}
                onClick={() => setActiveMenu((value) => (value === 'file' ? null : 'file'))}
              />
              <StudioMenuButton
                label="View"
                open={activeMenu === 'view'}
                onClick={() => setActiveMenu((value) => (value === 'view' ? null : 'view'))}
              />
              <StudioMenuButton
                label="Tools"
                open={activeMenu === 'tools'}
                onClick={() => setActiveMenu((value) => (value === 'tools' ? null : 'tools'))}
              />
              <StudioMenuButton
                label="Render"
                open={activeMenu === 'render'}
                onClick={() => setActiveMenu((value) => (value === 'render' ? null : 'render'))}
              />
              {activeMenu === 'file' ? (
                <StudioMenuDropdown items={fileMenuItems} onSelect={runMenuAction} />
              ) : null}
              {activeMenu === 'view' ? (
                <StudioMenuDropdown items={viewMenuItems} onSelect={runMenuAction} />
              ) : null}
              {activeMenu === 'tools' ? (
                <StudioMenuDropdown items={toolsMenuItems} onSelect={runMenuAction} />
              ) : null}
              {activeMenu === 'render' ? (
                <StudioMenuDropdown items={renderMenuItems} onSelect={runMenuAction} />
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setQuickSwitcherOpen(true)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[rgba(255,255,255,0.55)] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.95)]"
              title="Quick switcher (Ctrl/Cmd+K)"
            >
              <Search className="h-3.5 w-3.5" />
              Jump
            </button>
            <button
              type="button"
              onClick={handleAttachAssets}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[rgba(255,255,255,0.82)] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.96)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Assets
            </button>
            <button
              type="button"
              onClick={() => openExportDialog('mp4')}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[rgba(255,255,255,0.82)] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.96)]"
            >
              <Download className="h-3.5 w-3.5" />
              Render
            </button>
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

                  <div
                    className="relative mt-3 overflow-hidden rounded-md border border-[rgba(255,255,255,0.06)] bg-[#0f1114]"
                    style={{ height: timelineHeight }}
                  >
                    <div className="absolute inset-x-0 top-0 flex h-7 items-center border-b border-[rgba(255,255,255,0.05)] px-3">
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[rgba(255,255,255,0.34)]">
                        <span>Timeline</span>
                        <span className="text-[rgba(255,255,255,0.18)]">/</span>
                        <span>{visibleLanes.length > 0 ? `${visibleLanes.length} lanes` : 'Awaiting scene lanes'}</span>
                      </div>
                    </div>

                    <div className="absolute inset-0 top-7">
                      <div className="absolute inset-x-0 top-0 grid h-6 border-b border-[rgba(255,255,255,0.05)] text-[10px] text-[rgba(255,255,255,0.34)]">
                        <div className="grid h-full grid-cols-6">
                          {timelineTicks.slice(0, 6).map((tick) => (
                            <div
                              key={tick.frame}
                              className="border-r border-[rgba(255,255,255,0.04)] px-3 py-1 last:border-r-0"
                            >
                              {tick.label}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="absolute inset-x-0 bottom-0 top-6">
                        <div className="absolute inset-0 grid grid-cols-6">
                          {timelineTicks.slice(0, 6).map((tick) => (
                            <div
                              key={tick.frame}
                              className="border-r border-[rgba(255,255,255,0.04)] last:border-r-0"
                            />
                          ))}
                        </div>
                        {visibleLanes.length > 0 ? (
                          visibleLanes.map((lane, index) => {
                            const top = index * 34 + 6;
                            const leftPct = (lane.startFrame / meta.durationInFrames) * 100;
                            const widthPct = (lane.durationInFrames / meta.durationInFrames) * 100;
                            const selected = lane.id === selectedLaneId;
                            return (
                              <button
                                key={lane.id}
                                type="button"
                                onClick={() => handleSelectLane(lane)}
                                className={`absolute left-0 right-0 mx-3 flex h-7 items-center rounded-md text-left transition-transform hover:scale-[1.01] ${
                                  selected ? 'ring-1 ring-white/20' : ''
                                }`}
                                style={{ top }}
                              >
                                <div className="w-28 shrink-0 pr-3 text-[10px] text-[rgba(255,255,255,0.52)]">
                                  <div className="truncate">{lane.label}</div>
                                </div>
                                <div className="relative h-full flex-1 rounded bg-[rgba(255,255,255,0.04)]">
                                  <div
                                    className="absolute inset-y-0 rounded"
                                    style={{
                                      left: `${leftPct}%`,
                                      width: `${Math.max(widthPct, 2)}%`,
                                      backgroundColor: laneColor(lane),
                                      opacity: selected || activeLaneIds.has(lane.id) ? 0.95 : 0.72,
                                    }}
                                  />
                                </div>
                              </button>
                            );
                          })
                        ) : (
                          <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-[rgba(255,255,255,0.44)]">
                            Generate a scene-based Remotion composition to populate timeline lanes.
                          </div>
                        )}
                        <div className="pointer-events-none absolute inset-y-0 left-[124px] right-3">
                          <div
                            className="absolute bottom-0 top-0 w-px bg-[#ff503b]"
                            style={{
                              left: `${Math.min(currentFrame / meta.durationInFrames, 1) * 100}%`,
                            }}
                          >
                            <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border border-[#ff7a67] bg-[#ff503b]" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={meta.durationInFrames}
                    step={1}
                    value={Math.min(currentFrame, meta.durationInFrames)}
                    onChange={(event) => handleSeek(Number(event.target.value))}
                    className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[rgba(255,255,255,0.12)] accent-[#ff503b]"
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px] text-[rgba(255,255,255,0.46)]">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-1">
                      <TimerReset className="h-3.5 w-3.5" />
                      Scrub to inspect timings
                    </span>
                    {selectedLaneId ? (
                      <span className="rounded-full bg-[rgba(255,255,255,0.05)] px-2 py-1">
                        Selected:{' '}
                        {visibleLanes.find((lane) => lane.id === selectedLaneId)?.label ?? compositionName}
                      </span>
                    ) : null}
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
                      <span className="font-medium text-[rgba(255,255,255,0.9)]">
                        {editorPath.split('/').slice(-2).join('/') || 'Project file'}
                      </span>
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
                  <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[rgba(255,255,255,0.06)] px-3 py-2">
                    {editorFiles.map((filePath) => {
                      const active = filePath === editorPath;
                      return (
                        <button
                          key={filePath}
                          type="button"
                          onClick={() => setEditorPath(filePath)}
                          className={`rounded px-2 py-1 text-[10.5px] transition-colors ${
                            active
                              ? 'bg-[rgba(124,156,255,0.16)] text-[#a8bbff]'
                              : 'text-[rgba(255,255,255,0.56)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.88)]'
                          }`}
                        >
                          {filePath.replace(/^src\//, '')}
                        </button>
                      );
                    })}
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
                      Project-backed preview - live compiled from Remotion source files
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

      {quickSwitcherOpen ? (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-[rgba(6,8,12,0.42)] p-6">
          <div className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#15181c] shadow-[0_32px_96px_rgba(0,0,0,0.45)]">
            <div className="border-b border-[rgba(255,255,255,0.06)] px-4 py-3">
              <div className="flex items-center gap-2 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#101316] px-3 py-2">
                <Search className="h-4 w-4 text-[rgba(255,255,255,0.46)]" />
                <input
                  ref={quickSwitcherInputRef}
                  value={quickSwitcherQuery}
                  onChange={(event) => setQuickSwitcherQuery(event.target.value)}
                  placeholder='Search compositions and assets. Use ">" for commands, "?" for docs.'
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-[rgba(255,255,255,0.92)] outline-none placeholder:text-[rgba(255,255,255,0.36)]"
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px] text-[rgba(255,255,255,0.42)]">
                <span>Ctrl/Cmd+K to open</span>
                <span>/</span>
                <span>Enter to select</span>
                <span>/</span>
                <span>Esc to close</span>
              </div>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-2">
              {filteredQuickItems.length > 0 ? (
                filteredQuickItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setQuickSwitcherIndex(index)}
                    onClick={() => {
                      item.onSelect();
                      setQuickSwitcherOpen(false);
                    }}
                    className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      index === quickSwitcherIndex
                        ? 'bg-[rgba(124,156,255,0.14)] text-[rgba(255,255,255,0.96)]'
                        : 'text-[rgba(255,255,255,0.82)] hover:bg-[rgba(255,255,255,0.05)]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium">{item.label}</div>
                      {item.subtitle ? (
                        <div className="mt-0.5 text-[10.5px] text-[rgba(255,255,255,0.45)]">
                          {item.subtitle}
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-4 py-10 text-center text-[12px] text-[rgba(255,255,255,0.45)]">
                  Nothing matched that query.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {exportDialog.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,8,12,0.72)] p-4 backdrop-blur-sm">
          <div className="flex max-h-[80vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#15181c] shadow-[0_32px_96px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-3 border-b border-[rgba(255,255,255,0.06)] px-5 py-4">
              <div>
                <div className="text-[15px] font-semibold text-[rgba(255,255,255,0.96)]">
                  Export animation
                </div>
                <div className="mt-1 text-[12px] leading-[1.5] text-[rgba(255,255,255,0.55)]">
                  Remotion renders the current composition separately from the live preview, so exports get their own visible workflow and status.
                </div>
              </div>
              <button
                type="button"
                onClick={closeExportDialog}
                disabled={exportDialog.status === 'choosing' || exportDialog.status === 'exporting'}
                className="rounded-md p-2 text-[rgba(255,255,255,0.46)] transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.92)] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Close export dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-2">
                {EXPORT_OPTIONS.map((option) => {
                  const active = option.format === exportDialog.format;
                  return (
                    <button
                      key={option.format}
                      type="button"
                      disabled={exportDialog.status === 'choosing' || exportDialog.status === 'exporting'}
                      onClick={() =>
                        setExportDialog((current) => ({
                          ...current,
                          format: option.format,
                          status: current.status === 'success' || current.status === 'error' || current.status === 'cancelled' ? 'idle' : current.status,
                          progress:
                            current.status === 'success' || current.status === 'error' || current.status === 'cancelled'
                              ? 0
                              : current.progress,
                          message:
                            option.format === 'mp4'
                              ? 'Render an MP4 using the Remotion export pipeline.'
                              : 'Export the current animation artifact.',
                          error: undefined,
                          path: undefined,
                          bytes: undefined,
                        }))
                      }
                      className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                        active
                          ? 'border-[rgba(124,156,255,0.44)] bg-[rgba(124,156,255,0.12)]'
                          : 'border-[rgba(255,255,255,0.07)] bg-[#1a1e23] hover:bg-[#20252b]'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <div className="text-[12px] font-medium text-[rgba(255,255,255,0.94)]">
                        {option.label}
                      </div>
                      <div className="mt-1 text-[10.5px] text-[rgba(255,255,255,0.45)]">
                        {option.hint}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[#101316] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-[rgba(255,255,255,0.48)]">
                  <span>{compositionName}</span>
                  <span>/</span>
                  <span>{meta.width}x{meta.height}</span>
                  <span>/</span>
                  <span>{meta.fps} FPS</span>
                  <span>/</span>
                  <span>{formatDuration(meta.durationInFrames, meta.fps)}</span>
                </div>
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] font-medium text-[rgba(255,255,255,0.92)]">
                      {exportDialog.message}
                    </div>
                    <div className="text-[11px] text-[rgba(255,255,255,0.44)]">
                      {Math.round(exportDialog.progress * 100)}%
                    </div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                    <div
                      className={`h-full rounded-full transition-[width,background-color] duration-200 ${
                        exportDialog.status === 'error'
                          ? 'bg-[#ef4444]'
                          : exportDialog.status === 'success'
                            ? 'bg-[#22c55e]'
                            : 'bg-[#7c9cff]'
                      }`}
                      style={{ width: `${Math.max(exportDialog.progress * 100, exportDialog.status === 'idle' ? 0 : 6)}%` }}
                    />
                  </div>
                </div>
                {exportDialog.status === 'choosing' || exportDialog.status === 'exporting' ? (
                  <div className="mt-3 inline-flex items-center gap-2 text-[11px] text-[rgba(255,255,255,0.56)]">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    {exportDialog.format === 'mp4'
                      ? 'Rendering with Remotion and encoding the video output.'
                      : 'Preparing the export package.'}
                  </div>
                ) : null}
                {exportDialog.status === 'success' ? (
                  <div className="mt-3 rounded-lg border border-[rgba(34,197,94,0.25)] bg-[rgba(34,197,94,0.08)] px-3 py-2 text-[11px] text-[rgba(220,252,231,0.92)]">
                    Saved {exportDialog.path ?? 'export'} ({formatExportSize(exportDialog.bytes)}).
                  </div>
                ) : null}
                {exportDialog.status === 'cancelled' ? (
                  <div className="mt-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[11px] text-[rgba(255,255,255,0.72)]">
                    Export was cancelled before rendering started.
                  </div>
                ) : null}
                {exportDialog.status === 'error' && exportDialog.error ? (
                  <div className="mt-3 rounded-lg border border-[rgba(239,68,68,0.24)] bg-[rgba(239,68,68,0.08)] px-3 py-2 text-[11px] leading-[1.5] text-[rgba(254,226,226,0.94)]">
                    {exportDialog.error}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[rgba(255,255,255,0.06)] px-5 py-4">
              <div className="text-[11px] text-[rgba(255,255,255,0.42)]">
                {exportDialog.format === 'mp4'
                  ? 'MP4 exports use the Remotion render pipeline behind the scenes.'
                  : 'Non-video exports package the current artifact for handoff.'}
              </div>
              <div className="flex items-center gap-2">
                {canShowExportedItem ? (
                  <button
                    type="button"
                    onClick={handleShowExportedItem}
                    className="rounded-md border border-[rgba(255,255,255,0.08)] px-3 py-2 text-[12px] text-[rgba(255,255,255,0.86)] transition-colors hover:bg-[rgba(255,255,255,0.05)]"
                  >
                    Show in folder
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={closeExportDialog}
                  disabled={exportDialog.status === 'choosing' || exportDialog.status === 'exporting'}
                  className="rounded-md border border-[rgba(255,255,255,0.08)] px-3 py-2 text-[12px] text-[rgba(255,255,255,0.86)] transition-colors hover:bg-[rgba(255,255,255,0.05)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {exportDialog.status === 'success' || exportDialog.status === 'cancelled' ? 'Done' : 'Close'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRunExport()}
                  disabled={exportDialog.status === 'choosing' || exportDialog.status === 'exporting'}
                  className="inline-flex items-center gap-2 rounded-md bg-[#7c9cff] px-3 py-2 text-[12px] font-medium text-[#0d1220] transition-opacity hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {exportDialog.status === 'choosing' || exportDialog.status === 'exporting' ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : exportDialog.status === 'success' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {exportDialog.status === 'success'
                    ? 'Export again'
                    : `Export ${EXPORT_OPTIONS.find((option) => option.format === exportDialog.format)?.label ?? exportDialog.format.toUpperCase()}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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

function StudioMenuButton({
  label,
  open,
  onClick,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 transition-colors ${
        open
          ? 'bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.95)]'
          : 'hover:bg-[rgba(255,255,255,0.06)] hover:text-[rgba(255,255,255,0.92)]'
      }`}
    >
      {label}
    </button>
  );
}

function StudioMenuDropdown({
  items,
  onSelect,
}: {
  items: MenuItem[];
  onSelect: (action: () => void | Promise<void>) => void;
}) {
  return (
    <div className="absolute left-3 top-[calc(100%+4px)] z-20 min-w-[248px] overflow-hidden rounded-lg border border-[rgba(255,255,255,0.08)] bg-[#171a1e] shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.onSelect)}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.05)]"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-[rgba(255,255,255,0.94)]">
              {item.label}
            </div>
            {item.hint ? (
              <div className="text-[10px] text-[rgba(255,255,255,0.44)]">{item.hint}</div>
            ) : null}
          </div>
          {item.label.toLowerCase().includes('docs') || item.label.toLowerCase().includes('guide') ? (
            <ExternalLink className="h-3.5 w-3.5 text-[rgba(255,255,255,0.34)]" />
          ) : null}
        </button>
      ))}
    </div>
  );
}
