---
schemaVersion: 1
name: design-philosophy
description: >
  Provides a 20-school design philosophy library for generating distinctive UI styles.
  Use when the user asks for design directions, style exploration, or wants a specific
  aesthetic (minimalism, brutalism, cinematic, data poetry, luxury editorial, etc.).
  Enables switching from generic AI output to craft-level visual identity.
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Design Philosophy Library — 20 Schools

When generating UI, always choose ONE school and commit fully. Half-committed aesthetics look worse than any single extreme.

### How to Select a School
- Ask the user: "Do you want a specific aesthetic or should I choose?" If no preference, pick the most fitting school based on the brief.
- Announce your choice: "Going with **[School Name]** aesthetic — [1-sentence reason]."
- Execute that school's DNA completely. Do not mix schools.

---

### School 1: Swiss Grid (Müller-Brockmann)
**Philosophy:** Mathematical purity. Grid as moral statement. No decoration without function.
**Color:** Black + white + ONE signal red or blue. Zero gradients.
**Typography:** Helvetica Neue or Aktiv Grotesk. Extreme size contrast (8px body, 96px headline). Strict baseline grid (8pt).
**Layout:** Left-aligned. Mathematical column proportions. Content never centered unless it IS the content.
**Use for:** B2B SaaS, developer tools, technical documentation sites.

### School 2: Luxury Editorial (Build)
**Philosophy:** Restraint as power. Every element earns its place or is removed.
**Color:** Cream, warm white, charcoal. One accent (gold, forest green, deep burgundy). Never more than 3 colors.
**Typography:** Serif display (Playfair Display, Canela, Editorial New) + neutral body. Tight tracking on headlines.
**Layout:** 70%+ whitespace. Content floats. Nothing crowds anything else.
**Use for:** High-end product pages, portfolio, luxury brand sites, premium SaaS.

### School 3: Cinematic Cyberpunk (Ash Thorp / Territory Studio)
**Philosophy:** Film-grade compositing applied to UI. Warm cyberpunk (orange/amber/teal) NOT cold blue neon.
**Color:** Near-black (#0d0d0d) base. Warm amber (#f5a623), electric teal (#00d4b1), deep orange. Industrial texture overlays.
**Typography:** Futuristic geometric sans (Eurostile, Orbitron, Industry). Tight tracking. All-caps sections.
**Layout:** Asymmetric. Diagonal dividers. Overlapping layers. HUD-style data panels.
**Use for:** Tech product demos, game UIs, fintech dark mode, security dashboards.

### School 4: Motion Poetry (Locomotive / Active Theory)
**Philosophy:** The scroll is a narrative arc. Every pixel movement has meaning.
**Color:** Deep dark backgrounds + glowing accent colors (cyan, magenta, lime). High contrast.
**Typography:** Display weight sans with character. Large, dominant. Text as design element.
**Layout:** Full-bleed sections. Parallax depth. Scroll-triggered reveals. Staggered entry animations.
**Use for:** Agency portfolios, product launches, interactive experiences, storytelling sites.

### School 5: Algorithmic / Generative (Zach Lieberman / Field.io)
**Philosophy:** Code as creative medium. Mathematical structures produce unexpected beauty.
**Color:** Pure black + white + ONE color. Or monochromatic with mathematical tonal steps.
**Typography:** System mono or geometric sans. Type secondary to visual data.
**Layout:** Grid systems derived from algorithmic rules. Repeating but varying. Visible process.
**Use for:** Data art, generative portfolios, tech company branding, NFT projects.

### School 6: Eastern Minimalism (Kenya Hara)
**Philosophy:** Emptiness as content. The space between elements is as designed as the elements.
**Color:** Pure white (#ffffff) dominant. Ink black for type. Zero color accents OR single muted natural tone.
**Typography:** Ultra-light weight for large text. Generous tracking. Never more than 2 weights.
**Layout:** Radical whitespace. Single elements per screen region. No crowding, ever.
**Use for:** Japanese/Asian brand work, wellness apps, meditation products, premium minimalism.

### School 7: Data Poetry (Stamen / Fathom)
**Philosophy:** Information has inherent aesthetic. Data visualization IS the design.
**Color:** Warm cartographic palette (terracotta #c0654a, sage #8fa882, ocean blue #2d5a7b). Muted, earthy.
**Typography:** Editorial-weight serif for annotation. Small, precise, deferential to the data.
**Layout:** Data structures determine layout. Charts, maps, and flows ARE the hierarchy.
**Use for:** Analytics dashboards, research tools, geographic products, data journalism.

### School 8: Organic Warmth (Sagmeister & Walsh adjacent)
**Philosophy:** Joy through unexpected color and texture. Handmade meets digital.
**Color:** Bold warm colors (marigold, coral, forest green, terracotta). High saturation. White space as contrast.
**Typography:** Mixed: editorial serif + bold grotesque. Occasional script or display experimental face.
**Layout:** Intentionally imperfect. Overlaps. Organic shapes. Collage logic.
**Use for:** Consumer apps, creative agencies, food/lifestyle brands, education products.

### School 9: Brutalist / Anti-Design
**Philosophy:** Honesty over beauty. Raw HTML logic as aesthetic. No decoration, no hiding structure.
**Color:** System colors or high-contrast primary (red, black, white, yellow). No gradients. Borders visible.
**Typography:** System fonts or grotesque. Maximum contrast between weights. No typographic polish.
**Layout:** Explicit grid lines. Tables. Exposed structure. Anti-centered.
**Use for:** Developers, hackers, indie projects, counter-cultural products, art projects.

### School 10: Sci-Fi Narrative (Territory Studio)
**Philosophy:** Future speculation as design language. Every UI element implies a story about a world.
**Color:** Holographic overlay aesthetics. Dark navy/black base. Cool blues, holographic purples, green-cyan.
**Typography:** Technical sans, monospace accents. Data readouts. Grid overlays.
**Layout:** HUD panels. Status bars. Grid overlays. Information-dense but hierarchically clear.
**Use for:** Sci-fi product demos, futuristic prototypes, game UIs, concept explorations.

---

## Execution Rules

1. **Never mix schools** — pick one, commit fully.
2. **State your choice** before generating: "Using School 2: Luxury Editorial because..."
3. **Colors in oklch()** wherever possible for perceptually uniform steps.
4. **Typography**: source fonts from Google Fonts CDN unless the school specifies otherwise.
5. **No purple gradients on white** — this is the single most recognizable AI default across ALL schools.
6. **Grain overlays elevate quality**: `background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.65'/><feColorMatrix type='saturate' values='0'/></filter><rect width='200' height='200' filter='url(%23n)' opacity='0.04'/></svg>")` on any school.
