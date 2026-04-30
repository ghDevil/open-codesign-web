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

### Remotion Integration (Animation Mode)

This app renders Remotion animations natively — **do NOT load Remotion from CDN**. When a design is of kind `animation`, output a standard HTML file that embeds a JSON animation spec in a `<script>` tag. The app's Remotion player reads that spec and renders the animation.

**Required output format for animation designs:**

The HTML artifact must contain this script tag somewhere in `<body>` or `<head>`:
```html
<script id="open-codesign-animation" type="application/json">
{
  "version": 1,
  "title": "Your Animation Title",
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
    {
      "id": "scene-1",
      "layout": "hero",
      "durationInFrames": 90,
      "title": "Main Headline",
      "body": "Supporting text that explains the concept.",
      "align": "left"
    },
    {
      "id": "scene-2",
      "layout": "cards",
      "durationInFrames": 90,
      "title": "Key Points",
      "cards": [
        { "title": "Point One", "body": "Description of the first point." },
        { "title": "Point Two", "body": "Description of the second point." },
        { "title": "Point Three", "body": "Description of the third point." }
      ]
    }
  ]
}
</script>
```

The rest of the HTML file can be a simple placeholder page (dark background, centered "Animation Loading…" text) — the app overlays the Remotion player on top.

**JSON spec field reference:**

Top-level:
- `version`: always `1`
- `title`: animation title (shown in the preview panel header)
- `aspectRatio`: `"16:9"` | `"9:16"` | `"1:1"` | `"4:5"` | `"21:9"`
- `fps`: `24` | `30` | `60`
- `durationInFrames`: total frames (fps × seconds). Must equal sum of scene durations.
- `motionStyle`: `"cinematic"` | `"snappy"` | `"calm"` | `"playful"`
- `narration`: optional string, pacing or voiceover notes
- `palette`: color tokens — `background`, `surface`, `text`, `muted`, `accent`, `accent2`
- `scenes`: array of 1–8 scene objects

Scene object fields:
- `id`: unique string identifier
- `layout`: `"hero"` | `"split"` | `"cards"` | `"quote"` | `"metrics"` | `"cta"`
- `durationInFrames`: frames for this scene (min 15)
- `title`: main heading (required)
- `kicker`: small eyebrow label above title (optional)
- `body`: paragraph below title (optional)
- `align`: `"left"` | `"center"` (default `"left"`)
- `accent`: hex override for scene accent color (optional)
- `background`: CSS background string override (optional)
- `bullets`: array of strings — shown as bullet list below title (optional)
- `cards`: array of `{eyebrow?, title, body, icon?}` — for `cards`/`split` layouts
- `stats`: array of `{label, value}` — for `metrics` layout
- `quote`: `{text, attribution?}` — for `quote` layout
- `ctaLabel`: button label string — for `cta` layout
- `imagePrompt`: visual placeholder description (optional, displayed as text cue)

**Layout guide:**
- `hero`: large headline + optional body + optional cards row beneath
- `split`: headline left + panel right (cards, quote, or image cue)
- `cards`: headline + 1–3 cards in a grid row
- `quote`: large pull-quote centered or left-aligned
- `metrics`: headline + stat grid (use for data/numbers)
- `cta`: headline + body + call-to-action button

**Scene count and pacing:**
- 3–6 scenes is the sweet spot for a 6–15 second animation
- Distribute `durationInFrames` so the total equals the top-level `durationInFrames`
- Hero/intro: ~2s (60 frames at 30fps). Content scenes: 2–3s each. CTA: ~2s.

**Frame rate guidance:**
- 30fps: standard (default for most animations)
- 60fps: smooth motion graphics or product demos
- 24fps: cinematic/film feel

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
