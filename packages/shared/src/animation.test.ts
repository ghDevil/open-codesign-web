import { describe, expect, it } from 'vitest';
import {
  OPEN_CODESIGN_ANIMATION_SCRIPT_ID,
  aspectRatioToDimensions,
  extractAnimationSpecFromHtml,
  normalizeAnimationSpec,
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
});
