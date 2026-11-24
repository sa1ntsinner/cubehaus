#!/usr/bin/env bash
# Archives the iPhone app for App Store Connect and exports it.
#
#   APPLE_TEAM_ID=<team> apps/mobile/scripts/archive.sh [--no-upload | --upload] [--unsigned] [out]
#
# --no-upload (the default) exports a signed .ipa into the output folder and sends nothing.
# --upload    exports and uploads to App Store Connect; it also needs an App Store Connect
#             API key, passed by path: APPLE_API_KEY (key id), APPLE_API_ISSUER (issuer id)
#             and APPLE_API_KEY_PATH (the .p8 file). The key's contents are never read here.
# --unsigned  archives without signing and stops before the export: proves the build up to
#             signing on a Mac with no identity. Nothing it makes can be installed.
# out         the output folder, default /tmp/cubehaus-ios-release (never the repository).
#
# Nothing that names the owner lives here or in ios/ExportOptions.template.plist: the team
# comes from the environment, and the filled export options are written to the output
# folder. The version and build number are the project's (scripts/set-version.mjs).
set -euo pipefail

upload=0
unsigned=0
out=/tmp/cubehaus-ios-release
for arg in "$@"; do
  case $arg in
    --upload) upload=1 ;;
    --no-upload) upload=0 ;;
    --unsigned) unsigned=1 ;;
    -*) echo "archive.sh: unknown option $arg" >&2; exit 2 ;;
    *) out=$arg ;;
  esac
done

if [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "archive.sh: APPLE_TEAM_ID is not set (see the top of this script)" >&2
  exit 2
fi
if [ "$upload" = 1 ] && [ "$unsigned" = 1 ]; then
  echo "archive.sh: an unsigned archive cannot be uploaded" >&2
  exit 2
fi
if [ "$upload" = 1 ]; then
  for name in APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH; do
    if [ -z "${!name:-}" ]; then
      echo "archive.sh: --upload needs $name" >&2
      exit 2
    fi
  done
fi

here=$(cd "$(dirname "$0")/.." && pwd)
case "$(cd "$(dirname "$out")" 2>/dev/null && pwd)/" in
  "$(cd "$here/../.." && pwd)"/*) echo "archive.sh: the output folder must be outside the repository" >&2; exit 2 ;;
esac
mkdir -p "$out"
archive="$out/cubehaus.xcarchive"

cd "$here"
pnpm run sync

signing=(DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates)
if [ "$unsigned" = 1 ]; then
  signing=(CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO)
fi
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath ios/build \
  -archivePath "$archive" "${signing[@]}" archive

if [ "$unsigned" = 1 ]; then
  echo "archive.sh: unsigned archive at $archive; stopping before signing and export"
  exit 0
fi

destination=export
[ "$upload" = 1 ] && destination=upload
sed -e "s/__APPLE_TEAM_ID__/$APPLE_TEAM_ID/" -e "s/__DESTINATION__/$destination/" \
  ios/ExportOptions.template.plist > "$out/ExportOptions.plist"

auth=()
if [ "$upload" = 1 ]; then
  auth=(-authenticationKeyID "$APPLE_API_KEY" -authenticationKeyIssuerID "$APPLE_API_ISSUER"
    -authenticationKeyPath "$APPLE_API_KEY_PATH")
fi
xcodebuild -exportArchive -archivePath "$archive" -exportPath "$out/export" \
  -exportOptionsPlist "$out/ExportOptions.plist" -allowProvisioningUpdates ${auth[@]+"${auth[@]}"}
echo "archive.sh: $([ "$upload" = 1 ] && echo uploaded || echo exported to $out/export)"
