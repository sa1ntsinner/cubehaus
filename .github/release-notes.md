What changed: [CHANGELOG.md](https://github.com/{{REPOSITORY}}/blob/{{TAG}}/CHANGELOG.md).

## Install

| System | File | Notes |
| --- | --- | --- |
| macOS, Apple silicon and Intel | `cubehaus_{{VERSION}}_universal.dmg` | Signed and notarized. |
| Windows, 64-bit | `cubehaus_{{VERSION}}_x64-setup.exe` | **Not code-signed yet.** Windows SmartScreen will warn on first start: choose "More info", then "Run anyway". Check the file against `SHA256SUMS` first. |
| Linux x86_64 | `cubehaus_{{VERSION}}_amd64.AppImage` | Make it executable, then run it. |
| Debian 12 or later, Ubuntu 22.04 or later, x86_64 | `cubehaus_{{VERSION}}_amd64.deb` | `sudo apt install ./cubehaus_{{VERSION}}_amd64.deb` |

`SHA256SUMS` lists the SHA-256 of every file here. `latest.json`, `cubehaus.app.tar.gz` and the `.sig` files are for the updater.

To build the same from source, see [BUILDING.md](https://github.com/{{REPOSITORY}}/blob/{{TAG}}/BUILDING.md).
