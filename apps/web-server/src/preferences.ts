import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Preferences {
  updateChannel: 'stable' | 'beta';
  generationTimeoutSec: number;
  checkForUpdatesOnStartup: boolean;
  dismissedUpdateVersion: string;
  diagnosticsLastReadTs: number;
}

const DEFAULTS: Preferences = {
  updateChannel: 'stable',
  generationTimeoutSec: 1200,
  checkForUpdatesOnStartup: false,
  dismissedUpdateVersion: '',
  diagnosticsLastReadTs: 0,
};

export async function readPreferences(dataDir: string): Promise<Preferences> {
  try {
    const raw = await readFile(join(dataDir, 'preferences.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writePreferences(dataDir: string, prefs: Preferences): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, 'preferences.json'),
    JSON.stringify({ schemaVersion: 5, ...prefs }, null, 2),
    'utf8',
  );
}
