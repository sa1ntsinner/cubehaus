# The Linux build environment for the desktop app (scripts/release-linux.sh).
#
# Ubuntu 22.04 on purpose: glibc 2.35 and WebKitGTK 4.1, so the AppImage runs on
# distributions from 2022 onward and the .deb installs on Ubuntu 22.04+ and Debian 12+.
# The base image is pinned by the digest of its multi-arch index; Node, pnpm, rustup and
# the Rust toolchain by version and checksum. Ubuntu's own packages come from jammy and
# jammy-updates as they are on the day of the build (apt has no lockfile here).

FROM ubuntu:22.04@sha256:f64b2ffc2f10ab8f8505aa56b2664bd846cbb9df87c7e2532e30f7667021c0e6

ARG TARGETARCH
ARG NODE_VERSION=26.13.0
ARG PNPM_VERSION=12.18.0
ARG RUSTUP_VERSION=1.29.0
ARG RUST_VERSION=1.100.0

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    PATH=/opt/cargo/bin:/opt/node/bin:$PATH \
    # linuxdeploy and appimagetool are AppImages themselves; a container has no FUSE.
    APPIMAGE_EXTRACT_AND_RUN=1 \
    CI=true

# Tauri 2's Linux prerequisites (https://v2.tauri.app/start/prerequisites/#linux), plus
# what the AppImage step calls (file, patchelf) and the system TLS for the updater.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl file git pkg-config patchelf xz-utils \
      libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
 && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    case "$TARGETARCH" in \
      arm64) node=linux-arm64; node_sum=406fe3fbde1c054adff8b297c16fdb5af6659db327c1ac8acd46b56ef1af9a92; \
             triple=aarch64-unknown-linux-gnu; rustup_sum=9732d6c5e2a098d3521fca8145d826ae0aaa067ef2385ead08e6feac88fa5792 ;; \
      amd64) node=linux-x64; node_sum=d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997; \
             triple=x86_64-unknown-linux-gnu; rustup_sum=4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${node}.tar.xz"; \
    echo "${node_sum}  /tmp/node.tar.xz" | sha256sum -c -; \
    mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1; \
    rm /tmp/node.tar.xz; \
    npm install -g "pnpm@${PNPM_VERSION}"; \
    curl -fsSL -o /tmp/rustup-init "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/${triple}/rustup-init"; \
    echo "${rustup_sum}  /tmp/rustup-init" | sha256sum -c -; \
    chmod +x /tmp/rustup-init; \
    /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}"; \
    rm /tmp/rustup-init; \
    chmod -R a+rwX /opt/cargo /opt/rustup; \
    node --version; pnpm --version; rustc --version; cargo --version

WORKDIR /src
