import { useMemo } from 'react';
import {
  type CompilationResult,
  type RemotionCompileAsset,
  compileRemotionCode,
} from '../lib/remotion-compiler';

export type { CompilationResult };

export function useCompilation(code: string, assets: RemotionCompileAsset[] = []): CompilationResult {
  return useMemo(() => compileRemotionCode(code, assets), [assets, code]);
}
