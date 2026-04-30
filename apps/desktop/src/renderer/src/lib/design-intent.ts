import type { AnimationAspectRatio, AnimationContext, AnimationMotionStyle } from '@open-codesign/shared';

export type ProjectKind = 'prototype' | 'slideDeck' | 'mobile' | 'animation' | 'other';
export type Fidelity = 'wireframe' | 'high';

export interface ProjectIntent {
  kind: ProjectKind;
  fidelity?: Fidelity;
  speakerNotes?: boolean;
  animation?: AnimationContext;
}

const INTENT_STORAGE_KEY = 'open-codesign:new-design-intent';

const DEFAULT_ANIMATION_CONTEXT: AnimationContext = {
  aspectRatio: '16:9',
  fps: 30,
  durationInFrames: 180,
  motionStyle: 'cinematic',
};

function sanitizeAnimationContext(input: unknown): AnimationContext | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const value = input as Record<string, unknown>;
  const aspectRatio = value['aspectRatio'];
  const fps = value['fps'];
  const durationInFrames = value['durationInFrames'];
  const motionStyle = value['motionStyle'];
  const narration = value['narration'];
  const validAspectRatios = new Set<AnimationAspectRatio>(['16:9', '9:16', '1:1', '4:5', '21:9']);
  const validMotionStyles = new Set<AnimationMotionStyle>([
    'cinematic',
    'snappy',
    'calm',
    'playful',
  ]);
  return {
    aspectRatio:
      typeof aspectRatio === 'string' && validAspectRatios.has(aspectRatio as AnimationAspectRatio)
        ? (aspectRatio as AnimationAspectRatio)
        : DEFAULT_ANIMATION_CONTEXT.aspectRatio,
    fps:
      typeof fps === 'number' && Number.isFinite(fps) && fps >= 12 && fps <= 60
        ? Math.round(fps)
        : DEFAULT_ANIMATION_CONTEXT.fps,
    durationInFrames:
      typeof durationInFrames === 'number' &&
      Number.isFinite(durationInFrames) &&
      durationInFrames >= 30 &&
      durationInFrames <= 3600
        ? Math.round(durationInFrames)
        : DEFAULT_ANIMATION_CONTEXT.durationInFrames,
    motionStyle:
      typeof motionStyle === 'string' &&
      validMotionStyles.has(motionStyle as AnimationMotionStyle)
        ? (motionStyle as AnimationMotionStyle)
        : DEFAULT_ANIMATION_CONTEXT.motionStyle,
    ...(typeof narration === 'string' && narration.trim().length > 0
      ? { narration: narration.trim().slice(0, 400) }
      : {}),
  };
}

function sanitizeIntent(input: unknown): ProjectIntent | null {
  if (typeof input !== 'object' || input === null) return null;
  const value = input as Record<string, unknown>;
  const kind = value['kind'];
  if (
    kind !== 'prototype' &&
    kind !== 'slideDeck' &&
    kind !== 'mobile' &&
    kind !== 'animation' &&
    kind !== 'other'
  ) {
    return null;
  }
  const intent: ProjectIntent = { kind };
  if (value['fidelity'] === 'wireframe' || value['fidelity'] === 'high') {
    intent.fidelity = value['fidelity'];
  }
  if (typeof value['speakerNotes'] === 'boolean') {
    intent.speakerNotes = value['speakerNotes'];
  }
  const animation = sanitizeAnimationContext(value['animation']);
  if (animation) intent.animation = animation;
  return intent;
}

export function readDesignIntent(designId: string): ProjectIntent | null {
  try {
    const raw = window.localStorage.getItem(`${INTENT_STORAGE_KEY}:${designId}`);
    if (!raw) return null;
    return sanitizeIntent(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeDesignIntent(designId: string, intent: ProjectIntent): void {
  try {
    window.localStorage.setItem(`${INTENT_STORAGE_KEY}:${designId}`, JSON.stringify(intent));
  } catch {
    /* localStorage unavailable */
  }
}

export function clearDesignIntent(designId: string): void {
  try {
    window.localStorage.removeItem(`${INTENT_STORAGE_KEY}:${designId}`);
  } catch {
    /* localStorage unavailable */
  }
}

export function copyDesignIntent(sourceDesignId: string, targetDesignId: string): void {
  const source = readDesignIntent(sourceDesignId);
  if (!source) return;
  writeDesignIntent(targetDesignId, source);
}

export function ensureAnimationContext(input: AnimationContext | undefined): AnimationContext {
  return sanitizeAnimationContext(input) ?? DEFAULT_ANIMATION_CONTEXT;
}
