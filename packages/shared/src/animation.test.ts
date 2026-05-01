import { describe, expect, it } from 'vitest';
import {
  OPEN_CODESIGN_ANIMATION_CODE_SCRIPT_ID,
  OPEN_CODESIGN_ANIMATION_SCRIPT_ID,
  aspectRatioToDimensions,
  buildRemotionProjectFilesFromCode,
  extractAnimationCodeFromHtml,
  extractAnimationComponentName,
  extractRegisteredCompositions,
  extractAnimationSpecFromHtml,
  extractAnimationTimelineFromCode,
  normalizeAnimationSpec,
  parseAnimationCodeMeta,
} from './animation';

describe('animation helpers', () => {
  it('extracts and normalizes an embedded animation spec from HTML', () => {
    const html = `<!doctype html>
<html lang="en">
  <body>
    <main>Storyboard</main>
    <script id="${OPEN_CODESIGN_ANIMATION_SCRIPT_ID}" type="application/json">
      {
        "version": 1,
        "title": "Launch teaser",
        "aspectRatio": "16:9",
        "fps": 30,
        "durationInFrames": 180,
        "motionStyle": "cinematic",
        "palette": {
          "background": "#08111f",
          "surface": "rgba(255,255,255,0.10)",
          "text": "#f6f7fb",
          "muted": "rgba(246,247,251,0.72)",
          "accent": "#7c9cff",
          "accent2": "#5eead4"
        },
        "scenes": [
          { "id": "hero", "layout": "hero", "title": "Launch", "durationInFrames": 90 },
          { "id": "cta", "layout": "cta", "title": "Try it", "durationInFrames": 120 }
        ]
      }
    </script>
  </body>
</html>`;

    const spec = extractAnimationSpecFromHtml(html);
    expect(spec?.title).toBe('Launch teaser');
    expect(spec?.durationInFrames).toBe(210);
    expect(spec?.scenes[0]?.align).toBe('left');
  });

  it('fills in missing scene durations evenly', () => {
    const spec = normalizeAnimationSpec({
      version: 1,
      title: 'Explainer',
      aspectRatio: '9:16',
      fps: 30,
      durationInFrames: 180,
      motionStyle: 'snappy',
      palette: {
        background: '#000',
        surface: '#111',
        text: '#fff',
        muted: '#ddd',
        accent: '#09f',
        accent2: '#6ff',
      },
      scenes: [
        { id: 'one', layout: 'hero', title: 'One' },
        { id: 'two', layout: 'cards', title: 'Two' },
        { id: 'three', layout: 'cta', title: 'Three' },
      ],
    });

    expect(spec.scenes.every((scene) => typeof scene.durationInFrames === 'number')).toBe(true);
    expect(spec.durationInFrames).toBe(180);
  });

  it('maps aspect ratios to expected dimensions', () => {
    expect(aspectRatioToDimensions('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(aspectRatioToDimensions('9:16')).toEqual({ width: 1080, height: 1920 });
  });

  it('extracts animation code and metadata from HTML', () => {
    const html = `<!doctype html>
<html lang="en">
  <body>
    <script id="${OPEN_CODESIGN_ANIMATION_CODE_SCRIPT_ID}" type="text/plain">
// @fps 24
// @duration 96
// @width 1080
// @height 1920
import { AbsoluteFill, useCurrentFrame } from 'remotion';
export const MyComposition = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill>{frame}</AbsoluteFill>;
};
    </script>
  </body>
</html>`;

    const code = extractAnimationCodeFromHtml(html);
    expect(code).toContain('export const MyComposition');
    expect(parseAnimationCodeMeta(code ?? '')).toEqual({
      fps: 24,
      durationInFrames: 96,
      width: 1080,
      height: 1920,
    });
    expect(extractAnimationComponentName(code ?? '')).toBe('MyComposition');
  });

  it('extracts sequence lanes from remotion code', () => {
    const code = `
// @fps 30
// @duration 180
// @width 1920
// @height 1080
import { AbsoluteFill, Sequence, Series, useVideoConfig } from 'remotion';

export const MyComposition = () => {
  const { fps } = useVideoConfig();
  const beat = fps * 2;

  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={beat} name="Intro">
        <div>Intro</div>
      </Sequence>
      <Series>
        <Series.Sequence durationInFrames={beat} name="Middle">
          <div>Middle</div>
        </Series.Sequence>
        <Series.Sequence durationInFrames={90} offset={-15} name="Outro">
          <Sequence from={15} durationInFrames={30} name="Tag">
            <div>Tag</div>
          </Sequence>
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
`;

    expect(extractAnimationTimelineFromCode(code)).toEqual([
      {
        id: 'sequence-0',
        label: 'Intro',
        startFrame: 0,
        durationInFrames: 60,
        endFrame: 60,
        depth: 0,
        kind: 'sequence',
      },
      {
        id: 'series-1',
        label: 'Middle',
        startFrame: 0,
        durationInFrames: 60,
        endFrame: 60,
        depth: 0,
        kind: 'series',
      },
      {
        id: 'series-2',
        label: 'Outro',
        startFrame: 45,
        durationInFrames: 90,
        endFrame: 135,
        depth: 0,
        kind: 'series',
      },
      {
        id: 'sequence-3',
        label: 'Tag',
        startFrame: 60,
        durationInFrames: 30,
        endFrame: 90,
        depth: 1,
        kind: 'sequence',
      },
    ]);
  });

  it('builds a project-backed Remotion file set from component code', () => {
    const files = buildRemotionProjectFilesFromCode(
      `// @fps 30
// @duration 180
// @width 1280
// @height 720
export const Promo = () => {
  return <div>Hello</div>;
};`,
      { compositionId: 'promo-video' },
    );

    expect(files.map((file) => file.path)).toEqual([
      'src/index.ts',
      'src/Root.tsx',
      'src/compositions/Promo.tsx',
    ]);
    expect(files[0]?.content).toContain('registerRoot');
    expect(files[1]?.content).toContain('id="promo-video"');
    expect(files[2]?.content).toContain("from 'remotion'");
  });

  it('extracts registered compositions from a Remotion root project', () => {
    const files = [
      {
        path: 'src/index.ts',
        content: "import { registerRoot } from 'remotion';\nimport { Root } from './Root';\nregisterRoot(Root);\n",
      },
      {
        path: 'src/Root.tsx',
        content: `import React from 'react';
import { Composition } from 'remotion';
import { IntroComp } from './compositions/IntroComp';
import { OutroComp } from './compositions/OutroComp';

const fps = 30;
const introFrames = fps * 2;

export const Root: React.FC = () => (
  <>
    <Composition id="intro" component={IntroComp} durationInFrames={introFrames} width={1920} height={1080} fps={fps} defaultProps={{}} />
    <Composition id="outro" component={OutroComp} durationInFrames={90} width={1080} height={1080} fps={30} defaultProps={{}} />
  </>
);`,
      },
      {
        path: 'src/compositions/IntroComp.tsx',
        content: "export const IntroComp = () => null;\n",
      },
      {
        path: 'src/compositions/OutroComp.tsx',
        content: "export const OutroComp = () => null;\n",
      },
    ];

    expect(extractRegisteredCompositions(files)).toEqual([
      {
        id: 'intro',
        componentName: 'IntroComp',
        filePath: 'src/compositions/IntroComp.tsx',
        durationInFrames: 60,
        width: 1920,
        height: 1080,
        fps: 30,
      },
      {
        id: 'outro',
        componentName: 'OutroComp',
        filePath: 'src/compositions/OutroComp.tsx',
        durationInFrames: 90,
        width: 1080,
        height: 1080,
        fps: 30,
      },
    ]);
  });
});
