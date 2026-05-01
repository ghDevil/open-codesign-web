---
schemaVersion: 1
name: motion-design
description: >
  Guides motion design for web UIs: animation timing, easing curves, scroll-driven
  effects, and cinematic multi-phase storytelling. Use when building anything with
  CSS/JS animation, page transitions, scroll effects, or interactive prototypes
  that need polished motion. Also covers Remotion for programmatic video generation.
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Motion Design Standards

### Easing Curve Selection (Most Critical Choice)

Wrong easing makes motion feel mechanical. Right easing makes it feel alive.

**For UI entrances:** `cubic-bezier(0.16, 1, 0.3, 1)` â€” expo-out. Fast start, smooth deceleration. Elements arrive with confidence.

**For UI exits:** `cubic-bezier(0.5, 0, 1, 0.5)` â€” ease-in. Slow start, accelerates away. Elements leave quickly without jarring.

**For hover/state changes:** `cubic-bezier(0.4, 0, 0.2, 1)` â€” standard material ease. Balanced, feels responsive.

**For elastic/spring:** `cubic-bezier(0.34, 1.56, 0.64, 1)` â€” slight overshoot. Use sparingly for playful interfaces.

**Never use:** `linear` (robotic), `ease` (CSS default, mediocre), `ease-in-out` (fine but generic).

**CSS custom properties for reuse:**
```css
:root {
  --ease-entrance: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-exit: cubic-bezier(0.5, 0, 1, 0.5);
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

---

### Timing Guidelines by Interaction Type

| Interaction | Duration | Easing |
|---|---|---|
| Button hover | 120ms | ease-standard |
| Menu open | 200ms | ease-entrance |
| Menu close | 150ms | ease-exit |
| Modal appear | 250ms | ease-entrance |
| Modal dismiss | 180ms | ease-exit |
| Page section reveal | 400-600ms | ease-entrance |
| Hero animation (staggered) | 800-1200ms total | ease-entrance per element |
| Scroll parallax | Tied to scroll position | No easing (linear scroll) |

**Rule:** Anything over 600ms feels slow for a UI transition. Anything under 100ms feels instant (no animation perceived). Sweet spot for "feels premium": 200-400ms.

---

### Scroll-Driven Animation Patterns

**Intersection Observer pattern (CSS class toggle):**
```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(el => {
    if (el.isIntersecting) el.target.classList.add('visible');
  });
}, { threshold: 0.15 });

document.querySelectorAll('[data-animate]').forEach(el => observer.observe(el));
```

```css
[data-animate] {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 500ms var(--ease-entrance), transform 500ms var(--ease-entrance);
}
[data-animate].visible {
  opacity: 1;
  transform: none;
}
```

**Staggered group reveals:**
```css
[data-stagger] > * {
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 400ms var(--ease-entrance), transform 400ms var(--ease-entrance);
}
[data-stagger].visible > *:nth-child(1) { transition-delay: 0ms; }
[data-stagger].visible > *:nth-child(2) { transition-delay: 80ms; }
[data-stagger].visible > *:nth-child(3) { transition-delay: 160ms; }
[data-stagger].visible > * { opacity: 1; transform: none; }
```

---

### Multi-Phase Animation (Cinematic Storytelling)

For hero animations or onboarding sequences, divide into phases:

**Phase structure:**
1. **Context** (0â€“15%): Establish the world. Background, ambient elements.
2. **Reveal** (15â€“45%): Main content arrives. Logo, headline, hero image.
3. **Elaboration** (45â€“75%): Supporting content builds. Features, stats, subtext.
4. **Resolution** (75â€“100%): CTA, call to action, final state.

**Implementation with JS timeline:**
```javascript
const timeline = [
  { delay: 0,    el: '.bg-elements',  animation: 'fadeIn 600ms ease-entrance' },
  { delay: 200,  el: '.hero-headline', animation: 'slideUp 500ms ease-entrance' },
  { delay: 400,  el: '.hero-sub',      animation: 'fadeIn 400ms ease-entrance' },
  { delay: 600,  el: '.hero-cta',      animation: 'slideUp 300ms ease-spring' },
  { delay: 800,  el: '.nav',           animation: 'fadeIn 200ms ease-standard' },
];

timeline.forEach(({ delay, el, animation }) => {
  const element = document.querySelector(el);
  if (!element) return;
  setTimeout(() => element.style.animation = animation, delay);
});
```

**Text reveal rule:** Text that users need to read should stay visible for â‰¥3 seconds before any exit animation. Never auto-advance narrative text faster than reading speed.

---

### Remotion Integration (Animation Mode)

This app now has a dedicated **Animation Studio** that compiles Remotion code live in the preview. When a design is of kind `animation`, produce the app's normal HTML output and make sure the resulting `index.html` embeds raw React/Remotion component code in a special `<script>` tag.

**CRITICAL rules:**
1. Do not load Remotion from a CDN.
2. Do not render the animation in the HTML body yourself.
3. Output one exported React component named `MyComposition`.
4. Keep imports limited to `react` and `remotion` only.
5. Do not wrap the component in `<Composition>` or call `registerRoot()`.
6. If the environment uses a Codex-style `text_editor` / virtual-fs workflow, write this structure directly into `index.html` rather than apologizing about format limitations.

**Required `index.html` structure:**

<!doctype html>
<html>
<head><meta charset="UTF-8"><title>Animation</title></head>
<body>
<script id="open-codesign-animation-code" type="text/plain">
// @fps 30
// @duration 150
// @width 1920
// @height 1080

import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const MyComposition = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();

  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const scale = spring({ frame, fps, config: { damping: 14, stiffness: 180 } });

  return (
    <AbsoluteFill style={{ background: '#08111f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity, transform: `scale(${scale})`, color: '#f6f7fb', fontSize: 96, fontWeight: 700, fontFamily: 'Inter, sans-serif' }}>
        Hello World
      </div>
    </AbsoluteFill>
  );
};
</script>
</body>
</html>

**Common Remotion APIs to use:**
- `useCurrentFrame()` for frame-based animation timing
- `useVideoConfig()` for `fps`, `durationInFrames`, `width`, and `height`
- `interpolate()` for mapping frames to values
- `spring()` for eased motion
- `AbsoluteFill` for the root composition wrapper
- `Sequence` and `Series` for scene timing
- `Easing` for custom easing curves

**Metadata comments at the top are required:**
```
// @fps 30
// @duration 150
// @width 1920
// @height 1080
```

**Design guidance:**
- Break longer animations into multiple scenes with `Sequence`
- Use spring entrances and interpolated exits
- Favor layered typography, panels, and visual hierarchy over empty motion
- Keep compositions self-contained and deterministic

---
### Reduced Motion (Required)

Always include this:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

### Performance Rules

- Never animate `width`, `height`, `top`, `left`, `margin`, `padding` â€” triggers layout reflow
- Only animate: `transform`, `opacity`, `filter`, `clip-path` â€” GPU-composited
- For scroll parallax: use `transform: translateY()` on a `will-change: transform` element
- Debounce scroll handlers at 16ms (one frame) or use IntersectionObserver instead
- `will-change: transform` only on elements actually animating â€” overuse wastes GPU memory

