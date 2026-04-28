---
schemaVersion: 1
name: design-workflow
description: >
  Enforces production-grade design workflow: brand asset protocol, anti-AI-slop
  rules, junior designer methodology (assumptions first, then implement), and
  content quality standards. Use for any UI design task to avoid generic outputs.
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Design Workflow — Production Standards

### Junior Designer Methodology (Default for All Design Tasks)

**Never start coding immediately.** Always do 3 passes:

**Pass 1: Clarify & State Assumptions** (before any code)
- Identify missing context: brand colors? fonts? target screen size? tech stack?
- State your assumptions explicitly in a brief comment block at the top of the HTML
- For brand work: ask for logo, color values, product images BEFORE proceeding
- For style direction: propose 1 school from design-philosophy skill, get agreement

**Pass 2: Structure + Placeholder** (skeleton first)
- Build the layout structure with placeholder content
- Establish the design system (colors as CSS vars, type scale, spacing scale)
- Get implicit approval by NOT over-polishing the first pass

**Pass 3: Full Implementation + Polish**
- Replace placeholders with real content
- Apply typography system, animation, interactions
- Final quality pass: contrast, spacing, consistency

**Delivery summary:** Only caveats and next steps. Never explain what you just built — the user can see it.

---

### Brand Asset Protocol (Mandatory for Named Brands)

When a task involves a specific brand (Apple, Stripe, Linear, Figma, etc.):

**Step 1: Request design context**
- Logo (SVG preferred) — mandatory for any brand
- Primary/secondary color values
- Font names
- Any existing design guidelines

**Step 2: If assets not provided, search official sources first**
- Logo: `brand.com/brand` or `brand.com/press`
- Colors: extract from official CSS if available
- Never guess brand hex values from memory — they are almost always wrong

**Step 3: If official assets unavailable**
- Use honest geometric placeholder (colored rectangle with brand initials)
- Never fabricate a logo
- Never use a close-but-wrong color and claim it's the brand

**Critical:** Using the wrong brand color is worse than using no brand color. A clearly generic design with a note "brand colors not confirmed" is more professional than confidently-wrong brand execution.

---

### Anti-AI-Slop Rules (Hard Prohibitions)

These patterns are **immediately recognizable** as AI-generated. Never use them:

**Forbidden Typography:**
- Inter, Roboto, Arial, system-ui, Space Grotesk as the display font
- All text at similar weights with no contrast
- Generic paragraph text that sounds like marketing copy

**Forbidden Color Patterns:**
- Purple/violet gradients on white backgrounds (#7c3aed → #a78bfa on white)
- Teal + dark navy as the ONLY dark-mode palette
- Gradients as the primary visual treatment (use them as accents only)
- Pure `#000000` black or pure `#ffffff` white for backgrounds

**Forbidden Layout Patterns:**
- Symmetric 3-column card grids as the dominant layout element
- Hero → Features (3 columns) → Testimonials → CTA as the default structure
- Centered everything (centering is a design decision, not a default)
- Bootstrap-style drop shadows (`box-shadow: 0 4px 6px rgba(0,0,0,0.1)`)
- Bento grid layouts with rounded cards unless explicitly requested

**Forbidden Content Patterns:**
- Placeholder stats: "98% satisfaction", "10,000+ users", "500% ROI"
- Generic testimonials: "This product changed my life" — John D., CEO
- SVG illustrations of abstract blobs or floating geometric shapes as "decoration"
- Emoji as section dividers or bullet points
- "Streamline your workflow" / "Supercharge your productivity" / "Unlock your potential"

**Forbidden Technical Patterns:**
- Hardcoded `width: 1200px` containers instead of responsive layout
- `position: absolute` for everything instead of modern CSS layout
- Inline styles everywhere instead of CSS custom properties

---

### CSS Quality Standards

**Always use CSS custom properties for design tokens:**
```css
:root {
  --color-bg: oklch(98% 0.01 250);
  --color-text: oklch(15% 0.02 250);
  --color-accent: oklch(55% 0.22 260);
  --font-display: 'Playfair Display', serif;
  --font-body: 'DM Sans', sans-serif;
  --space-unit: 8px;
}
```

**Modern CSS over legacy:**
- `oklch()` for colors (perceptually uniform, vivid gamut-P3)
- CSS Grid and Flexbox over floats or absolute positioning
- `text-wrap: balance` on headings
- `clamp()` for fluid typography
- `@media (prefers-reduced-motion: reduce)` on all animations

**Backgrounds:** Never solid white or grey. Use one of:
- CSS gradient (radial or linear, subtle)
- Grain/noise overlay (SVG data URI, opacity 0.03-0.06)
- Geometric SVG pattern
- Colored background from the chosen design school palette

---

### Interaction Design Quality

**Every interactive element needs:**
- Visible focus state (`outline` or custom ring) — never `outline: none` without replacement
- Hover state that communicates affordance
- `:active` state for click/tap feedback
- 44×44px minimum touch target on mobile

**Motion principles:**
- Ease-out for entrances (things arrive naturally, decelerate into place)
- Ease-in for exits (things accelerate away)
- Never `linear` easing for UI transitions
- `transition: all` is forbidden — specify the properties
- Gate all animations with `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }`
