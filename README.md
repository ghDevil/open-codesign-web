# Open CoDesign

**简体中文**: [README.zh-CN.md](./README.zh-CN.md)

> Your prompts. Your model. Your laptop. The open-source alternative to Anthropic Claude Design.

[Website](https://opencoworkai.github.io/open-codesign/) · [Quickstart](#quickstart) · [Docs](https://opencoworkai.github.io/open-codesign/quickstart) · [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md)

<p align="center">
  <img src="https://placehold.co/1200x600/E8E5DE/0E0E10?text=open-codesign+demo" alt="Open CoDesign — prompt to prototype (demo coming soon)" width="900" />
  <!-- Hero placeholder via placehold.co — real screenshot coming before launch -->
</p>

<p align="center">
  <a href="https://github.com/OpenCoworkAI/open-codesign/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/OpenCoworkAI/open-codesign?label=release&color=c96442" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue" /></a>
  <a href="https://github.com/OpenCoworkAI/open-codesign/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/OpenCoworkAI/open-codesign/ci.yml?label=CI" /></a>
</p>

---

## What is Open CoDesign?

Open CoDesign turns a natural-language prompt into a polished HTML prototype, slide deck, or marketing asset — entirely on your laptop, with whichever AI model you already pay for. Think of it as Claude Design, minus the subscription lock-in, minus the cloud account, minus the single-model ceiling.

---

## Quick demo (60 s)

_Demo video coming soon._

![Prompt to prototype in seconds](https://placehold.co/800x450/f5f0eb/c96442?text=Demo+GIF+coming+soon)
<!-- Replace with real demo GIF before launch -->

---

## Why Open CoDesign?

| | **Open CoDesign** | Claude Design | v0 by Vercel | Lovable |
|---|:---:|:---:|:---:|:---:|
| Open source | ✅ Apache-2.0 | ❌ Closed | ❌ Closed | ❌ Closed |
| Desktop native | ✅ Electron | ❌ Web only | ❌ Web only | ❌ Web only |
| Bring your own key | ✅ Any provider | ❌ Anthropic only | ❌ Vercel only | ⚠️ Limited |
| Local / offline | ✅ Fully local | ❌ Cloud | ❌ Cloud | ❌ Cloud |
| Models | ✅ 20+ (Claude, GPT, Gemini, Ollama…) | Claude only | GPT-4o | Multi-LLM |
| Version history | ✅ Local SQLite snapshots | ❌ | ❌ | ❌ |
| Data privacy | ✅ 100% on-device | ❌ Cloud-processed | ❌ Cloud | ❌ Cloud |
| Price | ✅ Free, token cost only | 💳 Subscription | 💳 Subscription | 💳 Subscription |

---

## Quickstart

### 1. Install

**Package managers** (recommended):

```sh
# macOS — Homebrew
brew tap OpenCoworkAI/tap
brew install --cask open-codesign

# Windows — winget
winget install OpenCoworkAI.open-codesign

# Windows — Scoop
scoop bucket add opencowork https://github.com/OpenCoworkAI/scoop-bucket
scoop install opencowork/open-codesign
```

**Direct download** from [GitHub Releases](https://github.com/OpenCoworkAI/open-codesign/releases):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `open-codesign-*-arm64.dmg` |
| macOS (Intel) | `open-codesign-*.dmg` |
| Windows (x64 / arm64) | `open-codesign-*-setup.exe` |
| Linux | `open-codesign-*.AppImage` |

> **v0.1 note:** installers are unsigned. macOS: right-click → Open, or run `xattr -d com.apple.quarantine /Applications/open-codesign.app` after install. Windows: SmartScreen → More info → Run anyway.
> Want a verified build? Compile from source — see [CONTRIBUTING.md](./CONTRIBUTING.md).

### 2. Add your API key

First launch opens the Settings page. Paste any provider key:

- Anthropic (`sk-ant-…`)
- OpenAI (`sk-…`)
- Google Gemini
- Any OpenAI-compatible relay (OpenRouter, SiliconFlow, local Ollama)

Credentials stay in `~/.config/open-codesign/config.toml`, encrypted via Electron `safeStorage`. Nothing leaves your machine.

### 3. Type your first prompt

Pick one of the eight built-in demos or describe your own. A sandboxed prototype appears in seconds.

---

## Built-in Anthropic-style design intelligence

Generic AI tools produce generic output. Open CoDesign ships with a built-in **anti-AI-slop design Skill** — a curated instruction set that steers the model toward considered typography, purposeful whitespace, and meaningful color, not `#3B82F6` blue buttons on every artifact.

The first version of this Skill is already in every generation. Before the model writes a line of CSS, it reasons through layout intent, design system coherence, and contrast — the same editorial discipline behind Claude Design's best outputs, available on any model you bring.

Add a `SKILL.md` to any project to teach the model your own taste.

---

## What's working today

- Unified provider model — Anthropic, OpenAI, Gemini, DeepSeek, or any OpenAI-compatible relay; keyless (IP-allowlisted) proxies supported
- One-click import from Claude Code and Codex configs — bring your existing providers, models, and keys in a single click
- Dynamic model picker — every provider exposes its real model catalogue, not a hardcoded shortlist
- Prompt → HTML **or JSX/React component** prototype, rendered in a sandboxed iframe (vendored React 18 + Babel on-device)
- Live agent panel — watch tool calls stream in real time as the model edits files
- AI-generated sliders: model emits the parameters worth tweaking (color, spacing, font); drag to refine with zero round-trip
- Comment mode: click any element in the preview to drop a pin, leave a note, model rewrites only that region
- Instant design switching — the last five designs keep their preview iframes alive, so Hub ↔ Workspace and sidebar navigation stay zero-delay
- Five export formats — HTML (inlined CSS), PDF (local Chrome), PPTX, ZIP, Markdown
- Bilingual UI — English and 简体中文
- Generation cancellation
- Settings with per-provider API key management
- GitHub Release pipeline (macOS DMG, Windows EXE, Linux AppImage)

---

## Roadmap

| Feature | Status |
|---|---|
| Multi-provider onboarding + Settings | ✅ Shipped |
| Claude Code / Codex one-click config import | ✅ Shipped |
| Dynamic model picker per provider | ✅ Shipped |
| Keyless (IP-allowlisted) proxy support | ✅ Shipped |
| Prompt → HTML prototype (sandboxed iframe) | ✅ Shipped |
| Prompt → JSX/React component (on-device React 18 + Babel) | ✅ Shipped |
| Live agent activity panel (streaming tool calls) | ✅ Shipped |
| AI-generated tunable sliders | ✅ Shipped |
| Comment mode (pin + AI region-rewrite) | ✅ Shipped |
| Instant design switching (preview pool) | ✅ Shipped |
| Bilingual UI (EN + 简体中文) | ✅ Shipped |
| HTML export (inlined CSS) | ✅ Shipped |
| PDF export (local Chrome) | ✅ Shipped |
| PPTX export | ✅ Shipped |
| ZIP / Markdown export | ✅ Shipped |
| Cost transparency (token estimate + weekly spend) | 🔜 Coming |
| Version snapshots + side-by-side diff | 🔜 Coming |
| Codebase → design system (token extraction) | 🔜 Coming |
| Three-style parallel exploration | 🔜 Coming |
| Code-signing (Apple ID + Authenticode) | 🔜 Stage 2 |
| Figma layer export | 🔜 Post-1.0 |

---

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=OpenCoworkAI/open-codesign&type=Date)](https://star-history.com/#OpenCoworkAI/open-codesign&Date)

---

## Cite this project

If you reference Open CoDesign in a paper, article, or product comparison, please use:

```
OpenCoworkAI (2026). open-codesign: Open-source desktop AI design tool.
GitHub. https://github.com/OpenCoworkAI/open-codesign
Apache-2.0 License.
```

Or the machine-readable `CITATION.cff` at the repo root.

---

## Built on

- Electron + React 19 + Vite 6 + Tailwind v4
- `@mariozechner/pi-ai` (multi-provider model abstraction)
- `better-sqlite3`, `electron-builder`

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md). Open an issue before writing code, sign commits with DCO, run `pnpm lint && pnpm typecheck && pnpm test` before a PR.

## License

Apache-2.0 — fork it, ship it, sell it. Keep the [NOTICE](./NOTICE).
