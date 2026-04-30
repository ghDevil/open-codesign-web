import { z } from 'zod';

export const OPEN_CODESIGN_ANIMATION_SCRIPT_ID = 'open-codesign-animation';
export const OPEN_CODESIGN_ANIMATION_COMPOSITION_ID = 'OpenCodesignAnimation';

export const AnimationAspectRatio = z.enum(['16:9', '9:16', '1:1', '4:5', '21:9']);
export type AnimationAspectRatio = z.infer<typeof AnimationAspectRatio>;

export const AnimationMotionStyle = z.enum(['cinematic', 'snappy', 'calm', 'playful']);
export type AnimationMotionStyle = z.infer<typeof AnimationMotionStyle>;

export const AnimationPalette = z.object({
  background: z.string().default('#08111f'),
  surface: z.string().default('rgba(255,255,255,0.10)'),
  text: z.string().default('#f6f7fb'),
  muted: z.string().default('rgba(246,247,251,0.72)'),
  accent: z.string().default('#7c9cff'),
  accent2: z.string().default('#5eead4'),
});
export type AnimationPalette = z.infer<typeof AnimationPalette>;

export const AnimationCard = z.object({
  eyebrow: z.string().max(80).optional(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(280),
  icon: z.string().max(32).optional(),
});
export type AnimationCard = z.infer<typeof AnimationCard>;

export const AnimationStat = z.object({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(80),
});
export type AnimationStat = z.infer<typeof AnimationStat>;

export const AnimationQuote = z.object({
  text: z.string().min(1).max(240),
  attribution: z.string().max(120).optional(),
});
export type AnimationQuote = z.infer<typeof AnimationQuote>;

export const AnimationSceneLayout = z.enum(['hero', 'split', 'cards', 'quote', 'metrics', 'cta']);
export type AnimationSceneLayout = z.infer<typeof AnimationSceneLayout>;

export const AnimationScene = z.object({
  id: z.string().min(1).max(80),
  layout: AnimationSceneLayout.default('hero'),
  durationInFrames: z.number().int().min(15).max(1800).optional(),
  kicker: z.string().max(80).optional(),
  title: z.string().min(1).max(160),
  body: z.string().max(400).optional(),
  align: z.enum(['left', 'center']).default('left'),
  background: z.string().max(120).optional(),
  accent: z.string().max(32).optional(),
  bullets: z.array(z.string().min(1).max(140)).max(6).optional(),
  cards: z.array(AnimationCard).max(6).optional(),
  stats: z.array(AnimationStat).max(4).optional(),
  quote: AnimationQuote.optional(),
  ctaLabel: z.string().max(60).optional(),
  imagePrompt: z.string().max(160).optional(),
});
export type AnimationScene = z.infer<typeof AnimationScene>;

export const AnimationSpec = z.object({
  version: z.literal(1).default(1),
  title: z.string().min(1).max(120).default('Animated concept'),
  aspectRatio: AnimationAspectRatio.default('16:9'),
  fps: z.number().int().min(12).max(60).default(30),
  durationInFrames: z.number().int().min(30).max(3600).default(180),
  motionStyle: AnimationMotionStyle.default('cinematic'),
  narration: z.string().max(400).optional(),
  soundtrack: z.string().max(160).optional(),
  palette: AnimationPalette.default({
    background: '#08111f',
    surface: 'rgba(255,255,255,0.10)',
    text: '#f6f7fb',
    muted: 'rgba(246,247,251,0.72)',
    accent: '#7c9cff',
    accent2: '#5eead4',
  }),
  scenes: z.array(AnimationScene).min(1).max(8),
});
export type AnimationSpec = z.infer<typeof AnimationSpec>;

export const AnimationContext = z.object({
  aspectRatio: AnimationAspectRatio.default('16:9'),
  fps: z.number().int().min(12).max(60).default(30),
  durationInFrames: z.number().int().min(30).max(3600).default(180),
  motionStyle: AnimationMotionStyle.default('cinematic'),
  narration: z.string().max(400).optional(),
});
export type AnimationContext = z.infer<typeof AnimationContext>;

const SCRIPT_RE = new RegExp(
  `<script[^>]*id=["']${OPEN_CODESIGN_ANIMATION_SCRIPT_ID}["'][^>]*type=["']application/json["'][^>]*>([\\s\\S]*?)<\\/script>`,
  'i',
);

export function aspectRatioToDimensions(aspectRatio: AnimationAspectRatio): {
  width: number;
  height: number;
} {
  switch (aspectRatio) {
    case '9:16':
      return { width: 1080, height: 1920 };
    case '1:1':
      return { width: 1080, height: 1080 };
    case '4:5':
      return { width: 1080, height: 1350 };
    case '21:9':
      return { width: 1680, height: 720 };
    case '16:9':
    default:
      return { width: 1920, height: 1080 };
  }
}

export function normalizeAnimationSpec(spec: AnimationSpec): AnimationSpec {
  const base = AnimationSpec.parse(spec);
  const scenes = base.scenes.length > 0 ? [...base.scenes] : [];
  if (scenes.length === 0) return base;

  const specified = scenes.every((scene) => typeof scene.durationInFrames === 'number');
  if (!specified) {
    const evenDuration = Math.max(15, Math.floor(base.durationInFrames / scenes.length));
    let assigned = 0;
    const nextScenes = scenes.map((scene, index) => {
      const remaining = scenes.length - index;
      const budget = base.durationInFrames - assigned;
      const duration =
        remaining === 1 ? Math.max(15, budget) : Math.max(15, Math.min(evenDuration, budget));
      assigned += duration;
      return { ...scene, durationInFrames: duration };
    });
    return { ...base, scenes: nextScenes, durationInFrames: assigned };
  }

  const total = scenes.reduce((sum, scene) => sum + (scene.durationInFrames ?? 0), 0);
  return { ...base, durationInFrames: total };
}

export function extractAnimationSpecFromHtml(html: string): AnimationSpec | null {
  const match = html.match(SCRIPT_RE);
  if (!match?.[1]) return null;
  try {
    return normalizeAnimationSpec(AnimationSpec.parse(JSON.parse(match[1].trim())));
  } catch {
    return null;
  }
}
