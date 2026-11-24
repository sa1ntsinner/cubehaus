#!/usr/bin/env bash
# Builds the Linux desktop packages (an AppImage and a .deb, unsigned) in a container, from
# the committed state of the repository (HEAD), then checks them in clean containers.
#
#   scripts/release-linux.sh [build|check|all] [output folder]
#
#   ARCHES="arm64 amd64"   architectures to build (default: the machine's own). Another
#                          architecture runs under emulation and takes much longer.
#   KEEP_TARGET=1          keep Cargo's build folder in a volume between runs (faster
#                          rebuilds; leave it off for a release).
#   JOBS=6                 parallel compile jobs inside the container.
#   TAURI_SIGNING_PRIVATE_KEY_PATH, TAURI_SIGNING_PRIVATE_KEY_PASSWORD
#                          optional: sign the AppImage and the .deb for the updater (on this machine,
#                          after the build; the key never enters the container).
#
# The environment is scripts/release-linux.Dockerfile (Ubuntu 22.04 pinned by digest,
# Node, pnpm and Rust pinned by version and checksum). Needs docker (OrbStack, Docker
# Desktop or a Linux host). Output: <folder>/<arch>/cubehaus_<version>_<arch>.deb and
# cubehaus_<version>_<arch>.AppImage, with SHA256SUMS. Default folder:
# /tmp/cubehaus-release/linux.

set -euo pipefail

stage="${1:-all}"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${2:-/tmp/cubehaus-release/linux}"
jobs="${JOBS:-6}"
case "$(uname -m)" in
  arm64 | aarch64) native=arm64 ;;
  *) native=amd64 ;;
esac
arches="${ARCHES:-$native}"
version="$(node -p 'require(process.argv[1]).version' "$root/apps/desktop/src-tauri/tauri.conf.json")"
# The same pinned image the build starts from, for the clean checks.
base="$(sed -n 's/^FROM //p' "$root/scripts/release-linux.Dockerfile")"

if ! docker info >/dev/null 2>&1; then
  echo "release-linux: docker is not running" >&2
  exit 2
fi

build() {
  local arch="$1"
  local image="cubehaus-linux-build:$arch"
  local dest="$out/$arch"
  local work
  work="$(mktemp -d)"
  if [ -n "$(git -C "$root" status --porcelain)" ]; then
    echo "release-linux: the working tree has changes; building HEAD without them" >&2
  fi
  git -C "$root" archive --format=tar -o "$work/source.tar" HEAD
  local epoch
  epoch="$(git -C "$root" log -1 --format=%ct HEAD)"

  echo "== $arch: environment"
  docker build --platform "linux/$arch" -t "$image" -f "$root/scripts/release-linux.Dockerfile" "$root/scripts" >&2

  local target=()
  if [ "${KEEP_TARGET:-}" = 1 ]; then
    target=(-v "cubehaus-linux-target-$arch:/target" -e CARGO_TARGET_DIR=/target)
  fi
  mkdir -p "$dest"
  rm -f "$dest"/*.deb "$dest"/*.AppImage "$dest"/*.sig "$dest"/SHA256SUMS

  echo "== $arch: build"
  local started=$SECONDS
  docker run --rm --platform "linux/$arch" \
    -v "$work:/in:ro" -v "$dest:/out" \
    -v "cubehaus-linux-cargo-$arch:/opt/cargo/registry" \
    -v "cubehaus-linux-pnpm-$arch:/pnpm-store" \
    ${target[@]+"${target[@]}"} \
    -e SOURCE_DATE_EPOCH="$epoch" -e CARGO_BUILD_JOBS="$jobs" -e npm_config_store_dir=/pnpm-store \
    "$image" bash -euo pipefail -c '
      mkdir -p /build && tar -xf /in/source.tar -C /build && cd /build
      pnpm install --frozen-lockfile
      pnpm --filter @cubehaus/web build
      cd apps/desktop
      pnpm exec tauri build --bundles deb,appimage
      bundle="${CARGO_TARGET_DIR:-src-tauri/target}/release/bundle"
      cp "$bundle"/deb/*.deb "$bundle"/appimage/*.AppImage /out/
      chown "$(stat -c %u:%g /out)" /out/*
    '
  rm -rf "$work"
  echo "== $arch: built in $((SECONDS - started)) s"

  if [ -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]; then
    for file in "$dest"/*.AppImage "$dest"/*.deb; do
      # --app-version binds the signature to the version (requireSignedVersion).
      (cd "$root/apps/desktop" && pnpm exec tauri signer sign --app-version "$version" "$file")
    done
  fi
  (cd "$dest" && shasum -a 256 ./*.deb ./*.AppImage > SHA256SUMS && cat SHA256SUMS)
}

check() {
  local arch="$1"
  local dest="$out/$arch"
  echo "== $arch: checks in clean containers ($base)"
  mkdir -p "$dest/check"
  for kind in deb appimage; do
    docker run --rm --platform "linux/$arch" \
      -v "$dest:/pkg:ro" -v "$dest/check:/report" \
      -v "$root/scripts/release-linux-check.sh:/check.sh:ro" \
      "$base" bash /check.sh "$kind" "$version"
  done
}

for arch in $arches; do
  case "$stage" in
    build) build "$arch" ;;
    check) check "$arch" ;;
    all) build "$arch" && check "$arch" ;;
    *)
      echo "usage: $0 [build|check|all] [output folder]" >&2
      exit 2
      ;;
  esac
done
