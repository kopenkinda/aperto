# Aperto

A desktop-only Electron application built with TypeScript, Effect v4, React, and Vite.

## Requirements

- Node.js 22.12 or newer
- pnpm 11.24.0 through Corepack

## Commands

```sh
pnpm install
pnpm dev
pnpm check
pnpm --filter @aperto/desktop package:dir
```

Dependencies use the default catalog in `pnpm-workspace.yaml`. Effect v4 packages share the same
release-candidate version so their peer requirements stay aligned.
