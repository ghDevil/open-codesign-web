# Distribution channels

Canonical sources for Open CoDesign's package manager manifests. The `packaging/` tree is the source of truth; after each release we run `update-shas.sh` to fill in checksums, commit here, then mirror the per-channel files to the downstream repos listed below.

All artifacts are **unsigned** for the v0.1 line. Each channel's README / caveats explains the Gatekeeper or SmartScreen workaround.

## Layout

```
packaging/
├── homebrew/
│   └── Casks/open-codesign.rb
├── winget/
│   └── manifests/o/OpenCoworkAI/open-codesign/<version>/
│       ├── OpenCoworkAI.open-codesign.yaml
│       ├── OpenCoworkAI.open-codesign.installer.yaml
│       └── OpenCoworkAI.open-codesign.locale.en-US.yaml
├── scoop/
│   └── bucket/open-codesign.json
└── update-shas.sh
```

## Release flow

1. Push a `vX.Y.Z` tag — `release.yml` builds and publishes the DMG / EXE / AppImage on GitHub Releases.
2. Once the release is live, run from the repo root:

   ```sh
   ./packaging/update-shas.sh
   ```

   It downloads every artifact, computes SHA256, and rewrites the placeholders (`REPLACE_WITH_*_SHA256`) in all three channels' manifests. If you're on slow internet or offline, pass a local directory of pre-downloaded artifacts as the second arg.

3. `git diff packaging/`, sanity-check, commit.
4. Mirror to the downstream repos (see below). The tap and bucket repos watch this tree, so the usual workflow is a copy-push per channel.

## Channel-specific mirroring

### Homebrew Cask — `OpenCoworkAI/homebrew-tap`

The tap is a separate public repo. Clone it, copy `packaging/homebrew/Casks/open-codesign.rb` into its `Casks/`, commit, push.

```sh
# Create the tap repo once:
gh repo create OpenCoworkAI/homebrew-tap --public \
  --description "Homebrew tap for Open CoDesign and friends"
git clone git@github.com:OpenCoworkAI/homebrew-tap.git /tmp/homebrew-tap
mkdir -p /tmp/homebrew-tap/Casks
cp packaging/homebrew/Casks/open-codesign.rb /tmp/homebrew-tap/Casks/
cd /tmp/homebrew-tap && git add -A && \
  git commit -m "open-codesign 0.1.0" && git push
```

Users install with:

```sh
brew tap OpenCoworkAI/tap
brew install --cask open-codesign
```

### winget — `microsoft/winget-pkgs`

Microsoft's monorepo. Fork it, copy `packaging/winget/manifests/o/OpenCoworkAI/open-codesign/<version>/` into the same path in the fork, open a PR. `wingetcreate validate` is worth running first:

```sh
wingetcreate validate packaging/winget/manifests/o/OpenCoworkAI/open-codesign/0.1.0
```

Users install with:

```pwsh
winget install OpenCoworkAI.open-codesign
```

### Scoop — `OpenCoworkAI/scoop-bucket`

Separate public bucket repo. Copy `packaging/scoop/bucket/open-codesign.json` to its `bucket/` directory.

```sh
gh repo create OpenCoworkAI/scoop-bucket --public \
  --description "Scoop bucket for Open CoDesign"
git clone git@github.com:OpenCoworkAI/scoop-bucket.git /tmp/scoop-bucket
mkdir -p /tmp/scoop-bucket/bucket
cp packaging/scoop/bucket/open-codesign.json /tmp/scoop-bucket/bucket/
cd /tmp/scoop-bucket && git add -A && \
  git commit -m "open-codesign 0.1.0" && git push
```

Users install with:

```pwsh
scoop bucket add opencowork https://github.com/OpenCoworkAI/scoop-bucket
scoop install opencowork/open-codesign
```

## Signing status

- macOS: **unsigned / not notarized**. On first launch Gatekeeper shows "damaged, move to Trash". Users run `xattr -d com.apple.quarantine /Applications/open-codesign.app`, or right-click the app and choose Open. Caveat text in the cask surfaces this.
- Windows: **unsigned**. SmartScreen will warn; users click "More info" → "Run anyway". No workaround needed beyond that.
- Linux AppImage: runs as-is.

Code signing + notarization is tracked for Stage 2 (Apple Developer ID + Windows EV cert). Once wired up, drop the Gatekeeper caveat from the cask and the SmartScreen note from the Windows READMEs.
