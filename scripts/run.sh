#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/build.sh

app=/Applications/Aperto.app
identifier=com.aperto.desktop
if [[ -L "$app" ]]; then
    echo 'The install path is a symlink. Refusing to replace it.' >&2
    exit 1
fi
if [[ -e "$app" ]]; then
    installed_id="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Contents/Info.plist")"
    [[ "$installed_id" == "$identifier" ]] || { echo 'A different app occupies the install path.' >&2; exit 1; }
fi
staging="$(mktemp -d /Applications/.Aperto.XXXXXX)"
cleanup() {
    # Recover the previous installation if replacement was interrupted.
    if [[ ! -e "$app" && -d "$staging/previous.app" ]]; then
        mv "$staging/previous.app" "$app" || return
    fi
    rm -rf "$staging"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ditto apps/desktop/release/mac-arm64/Aperto.app "$staging/Aperto.app"
codesign --verify --deep --strict "$staging/Aperto.app"

# Let Aperto finish writes and present its running-game/download quit dialog.
# Do not force-quit an app that declined termination.
swift -e '
import AppKit
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.aperto.desktop")
for app in apps { app.terminate() }
let deadline = Date().addingTimeInterval(30)
while apps.contains(where: { !$0.isTerminated }) && Date() < deadline {
    RunLoop.current.run(until: Date().addingTimeInterval(0.05))
}
if apps.contains(where: { !$0.isTerminated }) {
    fputs("Quit Aperto before installing the update. The installed app is unchanged.\n", stderr)
    exit(1)
}
'
if [[ -d "$app" ]]; then mv "$app" "$staging/previous.app"; fi
mv "$staging/Aperto.app" "$app"
env -u ELECTRON_RUN_AS_NODE -u VITE_DEV_SERVER_URL -u APERTO_DATA_DIR open "$app"
printf 'Installed and opened %s\n' "$app"
