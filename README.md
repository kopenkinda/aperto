# Aperto

A local game library and NW.js launcher for Apple Silicon Macs running macOS 14 or newer.
Built with Electron, TypeScript, React, and Effect v4.

## Development

Requires Node.js 22.12 or newer and pnpm 11.24.0 through Corepack.

```sh
pnpm install
pnpm dev
pnpm check
pnpm start
```

`pnpm start` or `./scripts/run.sh` builds the Apple Silicon app, signs it, installs it at
`/Applications/Aperto.app`, and opens it. This follows the local install convention used by
Menu Dot, Press, Blah, and Curtain. The installer verifies the staged bundle before replacing
the app and requests a normal quit. If Aperto is still running after 30 seconds, installation
stops without replacing it. `pnpm build:app` builds and signs without installing.

The first build creates an Aperto-specific self-signed certificate in a private keychain at
`~/Library/Application Support/Aperto/Signing`. Later builds reuse that identity and pin the
app's signing requirement to the certificate, so macOS can recognize rebuilt copies. Keep the
Signing directory private and backed up. An incomplete identity causes an error; the script
never silently replaces it or falls back to ad-hoc signing. It restores the keychain search
list and does not change system certificate trust or the default keychain. Apple Developer
membership is not needed for this local install.

The app and its Electron helpers are signed with hardened runtime and the JIT/library-loading
exceptions needed by a local Electron build. Signing does not grant privacy permissions.
NW.js games run as separate processes and may have their own permission identity; they are
not re-signed with Aperto's key.

The app icon is an open arch with a play symbol in the library's green palette. Edit
`apps/desktop/resources/icon.svg`, then run `pnpm icon` to regenerate the PNG and macOS ICNS.
The local build regenerates them automatically. Icon rendering uses AppKit and `iconutil`,
so building the local app requires the Xcode command-line tools, Python 3, Node.js, and pnpm.

If the terminal inherits `ELECTRON_RUN_AS_NODE`, use `env -u ELECTRON_RUN_AS_NODE pnpm dev`.
`APERTO_DATA_DIR=/path/to/test-data` selects an isolated library for testing.
The browser preview shows the renderer, but local filesystem operations require the Electron app.

## Using the library

Choose an unpacked game folder and review the detected application before adding it. Aperto
recognizes root applications, `www`, directory-form `package.nw`, and unpacked macOS
`Contents/Resources/app.nw` layouts. Multiple matches require a choice. A compatible manifest
without corroborating NW.js files is shown as an unconfirmed candidate.

Display names prefer game metadata, including MV/MZ `data/System.json` and `package.json`,
then a descriptive containing folder. Generic names such as `Game`, `www`, and `app.nw`
are skipped. Names, comma-separated tags, artwork, and artwork fit can be edited. Search,
tag filtering, sorting, grid/list views, and locating a moved folder are available.

The Runtimes screen downloads official stable macOS ARM64 normal builds. The installer verifies
the detached release signature using the pinned NW.js signing key, verifies the archive SHA-256,
checks extraction paths and symlinks, and checks the executable architecture and minimum macOS
version. A failed download does not replace an existing installation. Runtimes assigned to games
cannot be removed. Installing another version does not change existing assignments.

Game settings select an installed runtime and accept one additional launch switch per line.
Normal GPU behavior is the default. Aperto never silently cycles through versions. After an
abnormal exit or a reported problem, the UI offers an older installed runtime or the runtime
catalog. Assigning an older version first backs up the game's browser data. A running process
is not proof that the game loaded correctly; Activity records process outcomes and bounded logs.

## MV/MZ plugin toggles

The Plugins tab reads the standard generated `js/plugins.js` data declaration without executing
it. Enable/disable changes preserve plugin names, order, parameters, and unrelated fields.
They update the game's original configuration and therefore affect launches outside Aperto too.
No plugins are added or installed. Custom executable plugin-list formats are not edited.

The original configuration is backed up before the first change. Restore original uses the
exact saved bytes. External edits block changes and restoration rather than overwriting a game
update. The UI links to the retained backup for manual reconciliation. Editing is disabled while
Aperto tracks the game as running. Independently launched copies are not detected.

## Local data and ownership

Aperto stores a versioned `library.json` in `~/Library/Application Support/Aperto`, with atomic
writes and a `.previous` recovery copy. A corrupt library produces an error instead of resetting
it. The main process serializes updates and validates IPC and stored records with Effect Schema.

Game files remain in their original location. The only game-content writes Aperto performs are
explicit plugin toggles/restoration. It does not change ownership, broadly change permissions,
strip quarantine attributes, install game dependencies, or remove original game-folder saves.

Each game has its own `browser-data/<game-id>` directory. Library removal retains it unless
explicit deletion is selected. Deletion also removes that game's browser-data backups, which
can contain saves. Plugin backups are separate and retained. Re-adding the same canonical game
folder reconnects its identity and retained data. Runtime downgrade snapshots are in
`browser-data-backups/<game-id>`; automatic snapshot restoration is not implemented.

## Validation limits

Tests cover import/name detection, duplicate references, persistence, plugin backup/restore and
conflicts, data ownership, archive extraction, checksum selection, and process outcomes using
synthetic fixtures. Real-game compatibility and the full live signed NW.js download/install/launch
flow still need verification. The download host returned HTTP 403 during development; the app
reports server errors and keeps installed runtimes intact. Proprietary codec replacements,
Intel/Rosetta, archives/installers, Developer ID distribution signing, notarization, and publishing
are outside this build.
