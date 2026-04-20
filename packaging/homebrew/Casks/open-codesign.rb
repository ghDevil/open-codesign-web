cask "open-codesign" do
  version "0.1.0"

  on_arm do
    url "https://github.com/OpenCoworkAI/open-codesign/releases/download/v#{version}/open-codesign-#{version}-arm64.dmg"
    sha256 "REPLACE_WITH_ARM64_SHA256"
  end
  on_intel do
    url "https://github.com/OpenCoworkAI/open-codesign/releases/download/v#{version}/open-codesign-#{version}.dmg"
    sha256 "REPLACE_WITH_X64_SHA256"
  end

  name "Open CoDesign"
  desc "Open-source desktop AI design tool — prompt to prototype, BYOK, local-first"
  homepage "https://github.com/OpenCoworkAI/open-codesign"

  auto_updates false
  depends_on macos: ">= :big_sur"

  app "open-codesign.app"

  # Unsigned build — macOS will refuse the first launch with a generic
  # "damaged, move to Trash" dialog. Code-signing + notarization is on the
  # Stage-2 roadmap; until then users need the xattr workaround below.
  caveats <<~EOS
    #{token} is not yet notarized. On first launch macOS may refuse to open
    it. To bypass, either right-click the app and choose Open, or run:

      xattr -d com.apple.quarantine /Applications/open-codesign.app

    You only need to do this once per install/update.
  EOS

  zap trash: [
    "~/Library/Application Support/open-codesign",
    "~/Library/Preferences/ai.opencowork.codesign.plist",
    "~/Library/Logs/open-codesign",
    "~/Library/Saved Application State/ai.opencowork.codesign.savedState",
  ]
end
