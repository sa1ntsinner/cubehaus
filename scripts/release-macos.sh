#!/usr/bin/env bash
# Builds the macOS desktop app as a universal binary (Apple silicon and Intel), with its
# widget extension inside (apps/desktop/widgets), signed with
# a Developer ID Application identity under the hardened runtime, notarized with an App
# Store Connect API key and stapled; then the disk image, signed, notarized and stapled in
# its turn. Optionally the updater archive and its signature.
#
# Nothing that names the owner lives here: every identity and key comes from the
# environment. Example (placeholders; the key file is passed by path, never by contents):
#
#   export APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
#   export APPLE_TEAM_ID="<TEAMID>"
#   export APPLE_API_KEY="<key id>"
#   export APPLE_API_ISSUER="<issuer uuid>"
#   export APPLE_API_KEY_PATH="$HOME/.appstoreconnect/AuthKey_<key id>.p8"
#   # optional, for the updater archive:
#   export TAURI_SIGNING_PRIVATE_KEY_PATH="$HOME/.tauri/cubehaus.key"
#   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD   # set from a password manager, never a file
#   scripts/release-macos.sh [output folder, default /tmp/cubehaus-release]
#
# The identity must be in the login keychain. Tauri reads APPLE_SIGNING_IDENTITY to sign
# and APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_PATH to notarize the app.

set -euo pipefail

need() {
  if [ -z "${!1:-}" ]; then
    echo "release-macos: $1 is not set (see the example at the top of this script)" >&2
    exit 2
  fi
}
for name in APPLE_SIGNING_IDENTITY APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH; do
  need "$name"
done
if [ ! -f "$APPLE_API_KEY_PATH" ]; then
  echo "release-macos: no file at APPLE_API_KEY_PATH" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-/tmp/cubehaus-release}"
target=universal-apple-darwin
bundle="$root/apps/desktop/src-tauri/target/$target/release/bundle"

rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null

# A regular build of the page.
pnpm --filter @cubehaus/web build

# The Mac widgets (apps/desktop/widgets/build.sh): the extension and its bridge library,
# built and signed first (the extension with its own entitlements: sandbox and the App
# Group `$APPLE_TEAM_ID.<app ID>`), so the app is signed around them below.
widgets="$(mktemp -d)"
trap 'rm -rf "$widgets"' EXIT
"$root/apps/desktop/widgets/build.sh" "$widgets"

# Copies the widgets in, gives the app its entitlements (the group), signs the app around
# the already signed extension, notarizes and staples it, then builds the disk image.
(cd "$root/apps/desktop" &&
  pnpm exec tauri build --target "$target" --bundles app,dmg --config "$widgets/tauri.json")

app="$bundle/macos/cubehaus.app"
dmg="$(ls "$bundle"/dmg/*.dmg | head -n 1)"

# The image: signed, notarized, stapled.
codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$dmg"
xcrun notarytool submit "$dmg" \
  --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" \
  --wait
xcrun stapler staple "$dmg"

# The signature must be the expected team's, on both architectures.
team="$(codesign -dvv "$app" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
if [ "$team" != "$APPLE_TEAM_ID" ]; then
  echo "release-macos: signed by team '$team', expected APPLE_TEAM_ID" >&2
  exit 1
fi

# The extension is inside, signed by the same team, with its own entitlements; the app
# claims the same group.
widget="$app/Contents/PlugIns/CubehausWidgets.appex"
widget_team="$(codesign -dvv "$widget" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
if [ "$widget_team" != "$APPLE_TEAM_ID" ]; then
  echo "release-macos: the widget extension is signed by team '$widget_team', expected APPLE_TEAM_ID" >&2
  exit 1
fi
for code in "$app" "$widget"; do
  if ! codesign -d --entitlements - --xml "$code" 2>/dev/null | grep -q "$APPLE_TEAM_ID\.app\.cubehaus\.desktop"; then
    echo "release-macos: $(basename "$code") does not claim the App Group" >&2
    exit 1
  fi
done

mkdir -p "$out"
rm -rf "$out/cubehaus.app"
ditto "$app" "$out/cubehaus.app"
cp "$dmg" "$out/"

if [ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
  version="$(node -p 'require(process.argv[1]).version' "$root/apps/desktop/src-tauri/tauri.conf.json")"
  # No AppleDouble `._*` entries (macOS tar adds them for extended attributes): the
  # updater unpacks every entry and fails on `._cubehaus.app`, so no update installs.
  COPYFILE_DISABLE=1 tar --no-mac-metadata -czf "$out/cubehaus.app.tar.gz" -C "$out" cubehaus.app
  (cd "$root/apps/desktop" &&
    pnpm exec tauri signer sign --app-version "$version" "$out/cubehaus.app.tar.gz")
fi

echo
echo "== verification"
codesign --verify --deep --strict --verbose=2 "$out/cubehaus.app"
spctl -a -vv -t install "$out/$(basename "$dmg")"
xcrun stapler validate "$out/$(basename "$dmg")"
xcrun stapler validate "$out/cubehaus.app"
lipo -archs "$out/cubehaus.app/Contents/MacOS/cubehaus"
lipo -archs "$out/cubehaus.app/Contents/PlugIns/CubehausWidgets.appex/Contents/MacOS/CubehausWidgets"
(cd "$out" && shasum -a 256 "$(basename "$dmg")")
