import { useEffect, useState } from 'react';
import type { DesignFile } from '@open-codesign/shared';

export type DesignFileKind = 'html' | 'asset';

export interface DesignFileEntry {
  path: string;
  kind: DesignFileKind;
  updatedAt: string;
  size?: number;
}

export interface UseDesignFilesResult {
  files: DesignFileEntry[];
  loading: boolean;
  backend: 'snapshots' | 'files-ipc';
}

function classifyKind(path: string): DesignFileKind {
  return /\.html?$/i.test(path) ? 'html' : 'asset';
}

function toEntry(file: DesignFile): DesignFileEntry {
  return {
    path: file.path,
    kind: classifyKind(file.path),
    updatedAt: file.updatedAt,
    size: file.content.length,
  };
}

export function useDesignFiles(designId: string | null): UseDesignFilesResult {
  const [files, setFiles] = useState<DesignFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const filesIpcAvailable =
    typeof window !== 'undefined' &&
    Boolean((window.codesign as unknown as { files?: unknown })?.files);

  useEffect(() => {
    let cancelled = false;
    if (!designId || !window.codesign?.files?.list) {
      setFiles([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    window.codesign.files
      .list(designId)
      .then((result) => {
        if (cancelled) return;
        setFiles(result.map(toEntry));
      })
      .catch(() => {
        if (cancelled) return;
        setFiles([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [designId]);

  return {
    files,
    loading,
    backend: filesIpcAvailable ? 'files-ipc' : 'snapshots',
  };
}

export function formatRelativeTime(isoTime: string, now: Date = new Date()): string {
  const then = new Date(isoTime).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Math.max(0, now.getTime() - then);
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(months / 12);
  return `${years}y ago`;
}

export function formatAbsoluteTime(isoTime: string): string {
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
