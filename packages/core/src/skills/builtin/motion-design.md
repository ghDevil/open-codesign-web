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

**For UI entrances:** `cubic-bezier(0.16, 1, 0.3, 1)` — expo-out. Fast start, smooth deceleration. Elements arrive with confidence.

**For UI exits:** `cubic-bezier(0.5, 0, 1, 0.5)` — ease-in. Slow start, accelerates away. Elements leave quickly without jarring.

**For hover/state changes:** `cubic-bezier(0.4, 0, 0.2, 1)` — standard material ease. Balanced, feels responsive.

**For elastic/spring:** `cubic-bezier(0.34, 1.56, 0.64, 1)` — slight overshoot. Use sparingly for playful interfaces.

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
1. **Context** (0–15%): Establish the world. Background, ambient elements.
2. **Reveal** (15–45%): Main content arrives. Logo, headline, hero image.
3. **Elaboration** (45–75%): Supporting content builds. Features, stats, subtext.
4. **Resolution** (75–100%): CTA, call to action, final state.

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

**Text reveal rule:** Text that users need to read should stay visible for ≥3 seconds before any exit animation. Never auto-advance narrative text faster than reading speed.

---

### Remotion Integration (Programmatic Video)

Remotion allows React-based video generation from code. Use it when:
- User wants to export an animation as MP4/GIF
- Animation is data-driven (charts, statistics that animate)
- Presentation slides need video export
- Screencasts or product demo videos

**In-browser preview with @remotion/player (use this for HTML artifacts):**
```html
<!-- Load from CDN - no build step needed -->
<script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.development.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://cdn.jsdelivr.net/npm/remotion@4/dist/remotion.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@remotion/player@4/dist/player.umd.js"></script>
```

```jsx
const { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, registerRoot, Composition } = window.Remotion;
const { Player } = window.RemotionPlayer;

const MyScene = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });
  const y = spring({ frame, fps, from: 30, to: 0, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ opacity, transform: `translateY(${y}px)`, color: 'white', fontSize: 64, fontWeight: 700 }}>
        Hello World
      </div>
    </AbsoluteFill>
  );
};

// Render the player into the page
ReactDOM.render(
  React.createElement(Player, {
    component: MyScene,
    durationInFrames: 90,
    fps: 30,
    compositionWidth: 1920,
    compositionHeight: 1080,
    style: { width: '100%', borderRadius: 8 },
    controls: true,
    loop: true,
  }),
  document.getElementById('player-root')
);
```

**For export to MP4 (project-based workflow):**
```bash
npx create-video@latest
# or add to existing project:
npm install @remotion/cli remotion react react-dom
# Render:
npx remotion render MyScene output.mp4 --codec=h264 --fps=30
npx remotion render MyScene output.gif  # GIF export
```

**Key Remotion API:**
- `useCurrentFrame()` → frame number (0-based)
- `interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' })` → map frame to value
- `spring({ frame, fps, from, to, config: { damping, stiffness } })` → physics spring
- `<Sequence from={30} durationInFrames={60}>` → time-slice a sub-scene
- `<Audio src="./bgm.mp3" />` → synchronized audio track

**Frame rate guidance:**
- 30fps: standard web video (use this by default)
- 60fps: smooth motion graphics, product demos
- 25fps: film-style content

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

- Never animate `width`, `height`, `top`, `left`, `margin`, `padding` — triggers layout reflow
- Only animate: `transform`, `opacity`, `filter`, `clip-path` — GPU-composited
- For scroll parallax: use `transform: translateY()` on a `will-change: transform` element
- Debounce scroll handlers at 16ms (one frame) or use IntersectionObserver instead
- `will-change: transform` only on elements actually animating — overuse wastes GPU memory
