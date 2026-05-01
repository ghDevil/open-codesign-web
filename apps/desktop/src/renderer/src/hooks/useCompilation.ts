import { useMemo } from 'react';
import { type CompilationResult, compileRemotionCode } from '../lib/remotion-compiler';

export type { CompilationResult };

export function useCompilation(code: string): CompilationResult {
  return useMemo(() => compileRemotionCode(code), [code]);
}
