import { type ExporterFormat, exportArtifact } from '@open-codesign/exporters';
import { CodesignError, ERROR_CODES } from '@open-codesign/shared';
import { BrowserWindow } from 'electron';
import { dialog, ipcMain } from './electron-runtime';

const FORMAT_FILTERS: Record<ExporterFormat, Electron.FileFilter[]> = {
  html: [{ name: 'HTML', extensions: ['html'] }],
  mp4: [{ name: 'MP4 video', extensions: ['mp4'] }],
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  pptx: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  zip: [{ name: 'ZIP archive', extensions: ['zip'] }],
  markdown: [{ name: 'Markdown', extensions: ['md'] }],
};

export interface ExportRequest {
  format: ExporterFormat;
  htmlContent: string;
  defaultFilename?: string;
  exportId?: string;
}

export interface ExportResponse {
  status: 'saved' | 'cancelled';
  path?: string;
  bytes?: number;
}

export interface ExportProgressEvent {
  exportId: string;
  format: ExporterFormat;
  phase: 'queued' | 'preparing' | 'rendering' | 'encoding' | 'finalizing' | 'done';
  progress: number;
  message: string;
  renderedFrames?: number;
  encodedFrames?: number;
  totalFrames?: number;
}

export function parseRequest(raw: unknown): ExportRequest {
  if (raw === null || typeof raw !== 'object') {
    throw new CodesignError('export expects an object payload', ERROR_CODES.IPC_BAD_INPUT);
  }
  const r = raw as Record<string, unknown>;
  const format = r['format'];
  const html = r['htmlContent'];
  const defaultFilename = r['defaultFilename'];
  const exportId = r['exportId'];
  if (
    format !== 'html' &&
    format !== 'mp4' &&
    format !== 'pdf' &&
    format !== 'pptx' &&
    format !== 'zip' &&
    format !== 'markdown'
  ) {
    throw new CodesignError(
      `Unknown export format: ${String(format)}`,
      ERROR_CODES.EXPORTER_UNKNOWN,
    );
  }
  if (typeof html !== 'string' || html.length === 0) {
    throw new CodesignError('export requires non-empty htmlContent', ERROR_CODES.IPC_BAD_INPUT);
  }
  const out: ExportRequest = { format, htmlContent: html };
  if (typeof defaultFilename === 'string' && defaultFilename.length > 0) {
    out.defaultFilename = defaultFilename;
  }
  if (typeof exportId === 'string' && exportId.length > 0) {
    out.exportId = exportId;
  }
  return out;
}

export function registerExporterIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('codesign:export', async (evt, raw: unknown): Promise<ExportResponse> => {
    const req = parseRequest(raw);
    const win = getWindow();
    const sendProgress = (event: Omit<ExportProgressEvent, 'exportId' | 'format'>): void => {
      if (!req.exportId) return;
      const target = win ?? BrowserWindow.fromWebContents(evt.sender);
      target?.webContents.send('codesign:export-progress', {
        exportId: req.exportId,
        format: req.format,
        ...event,
      } satisfies ExportProgressEvent);
    };

    const defaultExt = req.format === 'markdown' ? 'md' : req.format;
    const opts: Electron.SaveDialogOptions = {
      title: `Export design as ${req.format.toUpperCase()}`,
      defaultPath: req.defaultFilename ?? `design.${defaultExt}`,
      filters: FORMAT_FILTERS[req.format],
    };
    const picked = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (picked.canceled || !picked.filePath) {
      return { status: 'cancelled' };
    }

    sendProgress({
      phase: 'queued',
      progress: 0.02,
      message: 'Save location selected',
    });

    const result = await exportArtifact(req.format, req.htmlContent, picked.filePath, (update) => {
      sendProgress(update);
    });

    sendProgress({
      phase: 'done',
      progress: 1,
      message: 'Export complete',
    });
    return { status: 'saved', path: result.path, bytes: result.bytes };
  });
}
