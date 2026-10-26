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
python3 scripts/sign.py apps/desktop/release/mac-arm64/Aperto.app
printf 'Built and signed %s\n' "$PWD/apps/desktop/release/mac-arm64/Aperto.app"
