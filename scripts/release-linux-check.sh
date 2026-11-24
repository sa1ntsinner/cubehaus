#!/usr/bin/env bash
# Runs inside a clean Ubuntu 22.04 container (scripts/release-linux.sh check): installs the
# .deb (deb) or extracts the AppImage without installing anything it needs (appimage),
# starts the app as an ordinary user on a virtual display, and checks that the main
# window appears and the database file is created in the XDG data directory.
#
#   check.sh deb|appimage <version>
# The packages are in /pkg; a screenshot goes to /report.

set -euo pipefail
kind="$1"
version="$2"
export DEBIAN_FRONTEND=noninteractive
case "$(dpkg --print-architecture)" in
  arm64) deb_arch=arm64 image_arch=aarch64 ;;
  amd64) deb_arch=amd64 image_arch=amd64 ;;
esac

say() { echo "check[$kind]: $*"; }

apt-get update -qq
# Only what the check itself uses: a virtual display, window lookup, a screenshot tool and
# the sqlite3 shell. None of it is a dependency of the app.
apt-get install -y -qq --no-install-recommends xvfb xdotool x11-apps imagemagick sqlite3 >/dev/null
say "check tools installed"

case "$kind" in
  deb)
    package="/pkg/cubehaus_${version}_${deb_arch}.deb"
    say "$(dpkg-deb -f "$package" Package Version Architecture Depends | tr '\n' ' ')"
    # apt resolves the dependencies from the archive; a missing one fails here.
    apt-get install -y --no-install-recommends "$package" 2>&1 | grep -E "^(Setting up cubehaus|E:|The following NEW packages)" || true
    dpkg -s cubehaus | grep -E "^(Status|Version):"
    run=(/usr/bin/cubehaus)
    ;;
  appimage)
    # The AppImage carries GTK and WebKitGTK but, by the AppImage rules (the excludelist),
    # not the graphics (Mesa: GL, EGL, GLES, GBM), X11/Wayland and font libraries every
    # desktop has. A bare container has none of them, so exactly those are installed, and
    # nothing of GTK or WebKit.
    apt-get install -y -qq --no-install-recommends \
      libx11-6 libx11-xcb1 libxcb1 libgl1 libegl1 libgles2 libgbm1 libdrm2 libexpat1 \
      libfontconfig1 libfreetype6 libfribidi0 libharfbuzz0b libwayland-client0 >/dev/null
    if dpkg -s libwebkit2gtk-4.1-0 >/dev/null 2>&1 || dpkg -s libgtk-3-0 >/dev/null 2>&1; then
      say "FAIL: GTK or WebKitGTK is installed; the AppImage must bring its own"
      exit 1
    fi
    say "desktop base libraries installed; no GTK, no WebKitGTK on the system"
    package="/pkg/cubehaus_${version}_${image_arch}.AppImage"
    [ -f "$package" ] || package="$(find /pkg -maxdepth 1 -name '*.AppImage' | head -n 1)"
    ;;
  *)
    echo "usage: check.sh deb|appimage <version>" >&2
    exit 2
    ;;
esac

useradd -m tester
home=/home/tester
if [ "$kind" = appimage ]; then
  cp "$package" "$home/cubehaus.AppImage"
  chown tester: "$home/cubehaus.AppImage"
  chmod +x "$home/cubehaus.AppImage"
  su tester -c "cd $home && ./cubehaus.AppImage --appimage-extract >/dev/null"
  say "extracted: $(find "$home/squashfs-root" -mindepth 1 -maxdepth 1 -printf '%f ')"
  run=("$home/squashfs-root/AppRun")
fi

su tester -c "Xvfb :99 -screen 0 1280x800x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &"
sleep 2
su tester -c "cd $home && DISPLAY=:99 ${run[*]} >/tmp/app.log 2>&1 &"

window=""
for _ in $(seq 1 60); do
  window="$(su tester -c "DISPLAY=:99 xdotool search --onlyvisible --name '^cubehaus\$'" 2>/dev/null | head -n 1 || true)"
  [ -n "$window" ] && break
  sleep 1
done
if [ -z "$window" ]; then
  say "FAIL: no window named cubehaus within 60 s"
  cat /tmp/app.log
  exit 1
fi
say "window $window: $(su tester -c "DISPLAY=:99 xdotool getwindowname $window") $(su tester -c "DISPLAY=:99 xdotool getwindowgeometry $window" | tr '\n' ' ')"

file="$home/.local/share/app.cubehaus.desktop/cubehaus.sqlite3"
for _ in $(seq 1 60); do
  [ -f "$file" ] && [ "$(sqlite3 "file:$file?mode=ro" 'PRAGMA user_version' 2>/dev/null || echo 0)" -gt 0 ] && break
  sleep 1
done
if [ ! -f "$file" ]; then
  say "FAIL: no database at $file within 60 s"
  cat /tmp/app.log
  exit 1
fi
sleep 3
say "database: $(stat -c '%n %s bytes' "$file")"
say "schema version $(sqlite3 "file:$file?mode=ro" 'PRAGMA user_version'), tables: $(sqlite3 "file:$file?mode=ro" "SELECT count(*) FROM sqlite_schema WHERE type = 'table'")"
su tester -c "DISPLAY=:99 xwd -root -silent" | convert xwd:- "/report/$kind-${deb_arch}.png"
say "screenshot /report/$kind-${deb_arch}.png"
say "app log:"
sed 's/^/  | /' /tmp/app.log | head -n 20
pkill -f squashfs-root/ || pkill -x cubehaus || true
say "OK"
