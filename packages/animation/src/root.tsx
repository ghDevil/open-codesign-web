import { Composition, registerRoot } from 'remotion';
import {
  type AnimationSpec,
  OPEN_CODESIGN_ANIMATION_COMPOSITION_ID,
  normalizeAnimationSpec,
} from '@open-codesign/shared';
import { OpenCodesignAnimation, animationDimensions } from './index';

const defaultSpec: AnimationSpec = normalizeAnimationSpec({
  version: 1,
  title: 'Animated concept',
  aspectRatio: '16:9',
  fps: 30,
  durationInFrames: 180,
  motionStyle: 'cinematic',
  palette: {
    background: '#08111f',
    surface: 'rgba(255,255,255,0.10)',
    text: '#f6f7fb',
    muted: 'rgba(246,247,251,0.72)',
    accent: '#7c9cff',
    accent2: '#5eead4',
  },
  scenes: [
    {
      id: 'scene-1',
      layout: 'hero',
      align: 'left',
      durationInFrames: 180,
      kicker: 'Open CoDesign',
      title: 'Animated concept',
      body: 'Replace this with a generated animation spec.',
      cards: [
        {
          eyebrow: 'Spec',
          title: 'Scene system',
          body: 'Each scene is rendered with a shared motion system.',
        },
      ],
    },
  ],
});

const dimensions = animationDimensions(defaultSpec);

function RemotionRoot() {
  return (
    <Composition
      id={OPEN_CODESIGN_ANIMATION_COMPOSITION_ID}
      component={OpenCodesignAnimation}
      width={dimensions.width}
      height={dimensions.height}
      fps={defaultSpec.fps}
      durationInFrames={defaultSpec.durationInFrames}
      defaultProps={{ spec: defaultSpec }}
      calculateMetadata={({ props }) => {
        const spec = normalizeAnimationSpec((props as { spec?: AnimationSpec }).spec ?? defaultSpec);
        const size = animationDimensions(spec);
        return {
          width: size.width,
          height: size.height,
          fps: spec.fps,
          durationInFrames: spec.durationInFrames,
          props: { spec },
        };
      }}
    />
  );
}

registerRoot(RemotionRoot);
