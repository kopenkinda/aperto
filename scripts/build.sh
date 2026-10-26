#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
    echo 'The local app build requires an Apple Silicon Mac.' >&2
    exit 1
fi

unset ELECTRON_RUN_AS_NODE VITE_DEV_SERVER_URL
swift scripts/icon.swift
pnpm install --frozen-lockfile
# Package first, then sign all Electron helpers and frameworks with our local key.
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @aperto/desktop package:dir --mac --arm64 -c.mac.identity=null
app=apps/desktop/release/mac-arm64/Aperto.app
# Compile the Icon Composer artwork so macOS renders the layered Liquid Glass icon.
# The flat icon.icns from electron-builder stays as the fallback.
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
xcrun actool Artwork/Aperto.icon \
    --compile "$app/Contents/Resources" \
    --output-format human-readable-text --notices --warnings --errors \
    --output-partial-info-plist "$staging/icon-info.plist" \
    --app-icon Aperto --include-all-app-icons \
    --enable-on-demand-resources NO --development-region en \
    --target-device mac --minimum-deployment-target 14.0 --platform macosx
plutil -replace CFBundleIconFile -string Aperto "$app/Contents/Info.plist"
plutil -replace CFBundleIconName -string Aperto "$app/Contents/Info.plist"
python3 scripts/sign.py "$app"
printf 'Built and signed %s\n' "$PWD/apps/desktop/release/mac-arm64/Aperto.app"
