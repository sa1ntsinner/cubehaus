# Building cubehaus from source

Three apps come from this repository: the web app, the desktop app (macOS, Windows, Linux) and the iPhone and iPad app. The desktop and iPhone apps are the web app in a native window, so each of them builds the web app first.

## What you need

For everything:

- Node 26 (the release builds use 26.13.0)
- pnpm 12.18.0 (`corepack enable` picks it up from `package.json`)

For the desktop app, also:

- Rust 1.100.0 (`rustup toolchain install 1.100.0`); 1.90 is the oldest that works
- macOS: the Xcode command line tools (`xcode-select --install`)
- Windows: the Microsoft C++ Build Tools ("Desktop development with C++") and WebView2, which Windows 10 and 11 already have
- Linux (Debian and Ubuntu names):

  ```sh
  sudo apt-get install build-essential pkg-config file patchelf curl \
    libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

For the iPhone app, also a Mac with Xcode (the project is built with Xcode 27.2) and an iOS simulator runtime. The app runs on iOS 17 and later.

## Get the source

```sh
git clone https://github.com/sa1ntsinner/cubehaus.git
cd cubehaus
pnpm install --frozen-lockfile
```

## Web

```sh
pnpm --filter @cubehaus/web dev        # dev server, prints its address
pnpm build                             # production build in apps/web/dist
pnpm --filter @cubehaus/web preview    # serves that build at http://127.0.0.1:4173
```

## Desktop

The same command on macOS, Windows and Linux. It builds the web app, then the native app for the machine you are on:

```sh
pnpm --filter @cubehaus/desktop build:app
```

The result is in `apps/desktop/src-tauri/target/release/`: the program itself (`cubehaus`, or `cubehaus.exe`), and under `bundle/` the packages for your system:

| System | Under `bundle/` |
| --- | --- |
| macOS | `macos/cubehaus.app`, `dmg/cubehaus_<version>_<arch>.dmg` |
| Windows | `nsis/cubehaus_<version>_x64-setup.exe`, `msi/` |
| Linux | `deb/cubehaus_<version>_<arch>.deb`, `appimage/cubehaus_<version>_<arch>.AppImage`, `rpm/` |

To build only some packages, run the two steps yourself:

```sh
pnpm --filter @cubehaus/web build
cd apps/desktop
pnpm exec tauri build --bundles app          # macOS: only the .app
pnpm exec tauri build --bundles nsis         # Windows: only the installer
pnpm exec tauri build --bundles deb,appimage # Linux
```

The Rust tests need the web build to exist:

```sh
pnpm --filter @cubehaus/web build
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
```

### The release builds

- macOS, both architectures in one app: `pnpm exec tauri build --target universal-apple-darwin --bundles app,dmg` in `apps/desktop`, after `rustup target add aarch64-apple-darwin x86_64-apple-darwin`. `scripts/release-macos.sh` does this and then signs and notarizes, which needs keys (below).
- Linux: `scripts/release-linux.sh` builds the `.deb` and the AppImage in a container (Ubuntu 22.04, pinned in `scripts/release-linux.Dockerfile`) from the last commit, then starts each in a clean container. It needs Docker and nothing else.
- Windows: the installer is built by `.github/workflows/release.yml` with the Windows commands above.

## iPhone and iPad, in the simulator

On a Mac with Xcode:

```sh
pnpm --filter @cubehaus/mobile build:sim
```

This builds the web app, copies it into the Xcode project and builds without signing. Then start a simulator and put the app on it:

```sh
xcrun simctl list devices available          # pick a device name
xcrun simctl boot "<device name>"
open -a Simulator
xcrun simctl install booted apps/mobile/ios/build/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted app.cubehaus.mobile
```

Or open `apps/mobile/ios/App/App.xcodeproj` in Xcode after `pnpm --filter @cubehaus/mobile sync` and run it there. A real phone needs your own Apple developer team, chosen in Xcode under Signing & Capabilities.

## Checks

```sh
pnpm typecheck && pnpm lint && pnpm test
pnpm check:licenses        # licences of the npm packages
pnpm check:crates          # licences of the Rust crates
```

## What you cannot reproduce

A build from source runs the same code as a released one. Three things in a release need keys that only the maintainer holds:

- **Signing and notarization on macOS.** Your build is not signed with the project's Developer ID. It runs on the Mac that built it; on another Mac, Gatekeeper will refuse it until you allow it by hand.
- **The update signature.** The app installs only updates signed with the project's updater key, whose public half is in `apps/desktop/src-tauri/tauri.conf.json`. Your own build will still find and install official updates, replacing itself. To stop that, empty `plugins.updater.endpoints` in that file before building.
- **The App Store build.** `apps/mobile/scripts/archive.sh` archives for App Store Connect with a team ID from the environment; the project's team is not in this repository.

The Windows installer is not code-signed by anyone yet, so an official one and yours are equal there.

The scripts read every identity and key from environment variables. Their names and meaning are at the top of `scripts/release-macos.sh`, `scripts/release-linux.sh` and `apps/mobile/scripts/archive.sh`. With your own keys, the same scripts and `.github/workflows/release.yml` make a full release of a fork.
