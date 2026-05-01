import { useMemo } from 'react';
import {
  type CompilationResult,
  type RemotionCompileAsset,
  compileRemotionCode,
} from '../lib/remotion-compiler';

export type { CompilationResult };

export function useCompilation(
  code: string,
  assets: RemotionCompileAsset[] = [],
  opts?: {
    componentNameOverride?: string;
  },
): CompilationResult {
  return useMemo(() => compileRemotionCode(code, assets, opts), [assets, code, opts]);
}
