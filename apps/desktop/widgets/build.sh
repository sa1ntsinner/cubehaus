#!/usr/bin/env bash
# Builds the Mac widgets for the desktop app: the WidgetKit extension
# (CubehausWidgets.appex, the iPhone app's SwiftUI sources in apps/mobile/ios/App/Widgets)
# and the small library the app loads to find the shared folder and redraw the widgets
# (libCubehausWidgetBridge.dylib). Both universal (arm64 and x86_64).
#
#   apps/desktop/widgets/build.sh <output folder>
#
# From the environment, all optional:
#   CUBEHAUS_APP_ID         the app's bundle ID (default: tauri.conf.json's identifier)
#   APPLE_TEAM_ID           the team; the App Group is `<team>.<app ID>` (Developer ID apps
#                           use a team-prefixed group). Without it there is no group: the
#                           widgets build and install but show their empty state.
#   APPLE_SIGNING_IDENTITY  signs both (`-` for an ad-hoc signature); without it nothing
#                           is signed here.
#
# Writes into the output folder the two products, signed (the extension with its own
# entitlements: sandbox and the group), and `tauri.json`, to pass to `tauri build
# --config`: it copies both into the app (Contents/PlugIns, Contents/Frameworks) and, with
# a group, gives the app an entitlements file claiming it. Tauri then signs the app
# around them, which keeps their signatures (inside out: extension, then app).

set -euo pipefail

out="${1:?usage: build.sh <output folder>}"
here="$(cd "$(dirname "$0")" && pwd)"
conf="$here/../src-tauri/tauri.conf.json"
app_id="${CUBEHAUS_APP_ID:-$(node -p 'require(process.argv[1]).identifier' "$conf")}"
version="$(node -p 'require(process.argv[1]).version' "$conf")"
group=""
if [ -n "${APPLE_TEAM_ID:-}" ]; then
  group="$APPLE_TEAM_ID.$app_id"
fi

mkdir -p "$out"
out="$(cd "$out" && pwd)"
work="$out/xcode"
rm -rf "$work" "$out/CubehausWidgets.appex" "$out/libCubehausWidgetBridge.dylib"

xcodebuild -quiet -project "$here/Widgets.xcodeproj" -alltargets -configuration Release \
  SYMROOT="$work/build" OBJROOT="$work/obj" \
  APP_BUNDLE_ID="$app_id" CUBEHAUS_APP_GROUP="$group" \
  MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$version" \
  build
ditto "$work/build/Release/CubehausWidgets.appex" "$out/CubehausWidgets.appex"
ditto "$work/build/Release/libCubehausWidgetBridge.dylib" "$out/libCubehausWidgetBridge.dylib"
rm -rf "$work"

groups() {
  if [ -n "$group" ]; then
    printf '\t<key>com.apple.security.application-groups</key>\n\t<array>\n\t\t<string>%s</string>\n\t</array>\n' "$group"
  fi
}
plist() {
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n%s</dict>\n</plist>\n' "$1"
}
# A widget extension must be sandboxed; the app is not, and claims only the group.
plist "$(printf '\t<key>com.apple.security.app-sandbox</key>\n\t<true/>\n'; groups)" \
  > "$out/widgets.entitlements"
entitlements=""
if [ -n "$group" ]; then
  plist "$(groups)" > "$out/app.entitlements"
  entitlements=",\"entitlements\":\"$out/app.entitlements\""
fi

if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  if [ "$APPLE_SIGNING_IDENTITY" = "-" ]; then stamp=--timestamp=none; else stamp=--timestamp; fi
  codesign --force "$stamp" --options runtime --sign "$APPLE_SIGNING_IDENTITY" \
    "$out/libCubehausWidgetBridge.dylib"
  codesign --force "$stamp" --options runtime --entitlements "$out/widgets.entitlements" \
    --sign "$APPLE_SIGNING_IDENTITY" "$out/CubehausWidgets.appex"
fi

printf '{"bundle":{"macOS":{"files":{"PlugIns/CubehausWidgets.appex":"%s","Frameworks/libCubehausWidgetBridge.dylib":"%s"}%s}}}\n' \
  "$out/CubehausWidgets.appex" "$out/libCubehausWidgetBridge.dylib" "$entitlements" \
  > "$out/tauri.json"
lipo -archs "$out/CubehausWidgets.appex/Contents/MacOS/CubehausWidgets"
