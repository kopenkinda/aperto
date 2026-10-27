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

The app icon is an open door with a play button in the doorway, drawn in the same style as Menu Dot,
Press, Blah, and Curtain. `Artwork/Aperto.icon` is the Icon Composer source; the local build
compiles it with `actool` so macOS shows the layered Liquid Glass icon. `apps/desktop/resources/icon.svg`
is a flat copy used for the fallback PNG/ICNS and the dev favicon. After editing it, run `pnpm icon`.
Building the local app requires Xcode (for `actool`), Python 3, Node.js, and pnpm.

If the terminal inherits `ELECTRON_RUN_AS_NODE`, use `env -u ELECTRON_RUN_AS_NODE pnpm dev`.
`APERTO_DATA_DIR=/path/to/test-data` selects an isolated library for testing.
The browser preview shows the renderer, but local filesystem operations require the Electron app.

## Using the library

The window works like the Steam library: games are listed on the left, and the selected game's page
on the right has Play, its settings and plugins, and its 10 latest launches. Double-click a game in the list,
or press Return, to play it (or stop it while it runs).

Choose a games folder in Settings. Aperto scans it when it opens, when you come back to the window
(at most every 30 seconds), and when you press the scan button. It walks up to five folders deep and
stops at each game, so a game's own `www` or `app.nw` is not reported as a second game. Aperto
recognizes root applications, `www`, directory-form `package.nw`, and unpacked macOS
`Contents/Resources/app.nw` layouts. Folders that are not NW.js games, such as Unity builds or
installers, are skipped.

A folder already in the library is skipped. A copy of a known game is reported and ignored: same
detected name, same version in the folder names, and identical `package.json` and RPG Maker
`System.json`. Different versions, such as `v1.0.2` and `v1.0.4`, are added as separate games, and
the version is appended to a name that lacks it. A removed game is not added back by later scans.
The + button adds games from any other folder, and it also restores games you removed from there.

Display names prefer game metadata, including MV/MZ `data/System.json` and `package.json`,
then a descriptive containing folder. Generic names such as `Game`, `www`, and `app.nw`
are skipped. Names and comma-separated tags can be edited. Each game has an icon, used in the list and
the page header, and an optional wide banner shown across the header (cropped to fill). Without a
banner, the header shows a blurred copy of the icon. Hover the header to change either image. Search covers names and tags.

## Mac games

App bundles in the games folder are added as Mac games, named from their `Info.plist` and shown
with the app's own icon. Bundles that contain an NW.js app (`Contents/Resources/app.nw`) stay NW.js
games, and helper bundles such as uninstallers are skipped. Play runs `open -W -n`, so macOS applies
its usual first-launch checks and Aperto tracks the session until the app quits. Launch arguments
are passed with `--args`. Stop ends the processes running from the bundle.

## Windows games through CrossOver

Folders without an NW.js game are checked for a Windows game: a Unity build (`Game.exe` beside
`Game_Data`) or a folder with one plausible game executable. Installers, uninstallers, crash
handlers, and redistributables are ignored, as are `.exe` files inside Mac `.app` bundles. When a
folder has both, the NW.js game wins because it runs natively. Names come from a readable folder
name, then the Unity product name, then the executable.

Windows games run through CrossOver in `/Applications`. Choose a default bottle in Settings; a game
can override it. Aperto runs `wine --bottle <bottle> --no-update --dll winemenubuilder.exe=d --workdir
<folder> <game.exe>`, which behaves like dropping the `.exe` on CrossOver's Run Command: nothing is
installed or registered in the bottle. `--no-update` matters on macOS: a bottle update resyncs
CrossOver's launchers in `~/Applications/CrossOver`, and macOS blocks that as Aperto modifying other
apps. CrossOver upgrades its bottles itself when you open it after an update. Launch arguments are passed one per line. Stop ends the game with `taskkill` inside the
bottle, so other programs in that bottle keep running.

The runtimes section in Settings downloads official stable macOS ARM64 normal builds. The installer verifies
the detached release signature using the pinned NW.js signing key, verifies the archive SHA-256,
checks extraction paths and symlinks, and checks the executable architecture and minimum macOS
version. A failed download does not replace an existing installation. Runtimes assigned to games
cannot be removed. Installing another version does not change existing assignments.

Each game selects an installed runtime and accepts one additional launch switch per line.
Normal GPU behavior is the default. Aperto never silently cycles through versions. After an
abnormal exit or a reported problem, the UI offers an older installed runtime or the runtime
catalog. Assigning an older version first backs up the game's browser data. A running process
is not proof that the game loaded correctly; Activity records process outcomes and bounded logs.

## MV/MZ plugin toggles

The Plugins tab reads the standard generated `js/plugins.js` data declaration without executing
it. Enable/disable changes preserve plugin names, order, parameters, and unrelated fields.
They update the game's original configuration and therefore affect launches outside Aperto too.
Custom executable plugin-list formats are not edited. Windows exports keep the RPG Maker files in
`www`, next to `package.json`; Aperto looks there too.

Two switches above the list add plugins Aperto manages and hides from it:

- **Cheat menu** adds emerladCoder's RPG Maker Cheat Menu (press 1 in game). Its repository has no
  license, so Aperto downloads `Cheat_Menu.js` and `.css` from a pinned commit and checks their
  SHA-256 instead of shipping them. Turning it off removes the entry and the files, unless the
  game shipped them itself.
- **getPixel fix**, on by default, adds `Aperto_PixelFix.js` first in the list. Newer Chromium throws
  when a game reads a pixel at a non-finite position; the fix returns black instead. It is added
  when the game launches and removed when switched off.

The original configuration is backed up before the first change. Restore original uses the
exact saved bytes. External edits block changes and restoration rather than overwriting a game
update. The UI links to the retained backup for manual reconciliation. Editing is disabled while
Aperto tracks the game as running. Independently launched copies are not detected.

## Protection

NW.js, Ren'Py, and RPG Maker XP–VX Ace games run inside a macOS sandbox profile (`sandbox-exec`)
unless Protection is turned off for the game. The game gets no internet besides this Mac, may only
start its own runtime's programs, cannot send Apple Events, cannot read files in the home folder
outside its own folders and fonts, and writes only to its folder, its Aperto data, and temporary
folders. It also cannot create files Finder would run when opened, such as `.app` or `.command`,
since asking macOS to open one would run it outside the sandbox. Games that need to go online or
save elsewhere need Protection off. Mac apps and CrossOver games are not sandboxed.

## Ren'Py games

A folder with `renpy`, `game`, and a launcher script named like the game's `.exe` or `.sh` is a
Ren'Py game, checked before Windows games. A build with its own Apple Silicon libraries runs with
them. Otherwise Aperto runs the game folder with the Ren'Py release it was made with, read from
Ren'Py 8's `vc_version`, or else the newest release of its Python generation (7.8.7 for Python 2,
8.6.0 for Python 3). Only the engine and Apple Silicon Python are read out of renpy.org's SDK
archive with HTTP range requests, about 30 MB, into `renpy/<version>`. Saves go to
`~/Library/RenPy`, as with native Mac builds.

## RPG Maker XP, VX, and VX Ace

A folder with `Game.ini` beside `Game.exe` and RGSS scripts or an `.rgssad`/`.rgss2a`/`.rgss3a`
archive runs natively with mkxp-z instead of CrossOver. WOLF RPG games, which also have
`Game.ini`, stay Windows games. The first launch downloads m5kro's universal mkxp-z build and a
MIDI soundfont, checked against the SHA-256 GitHub records for them; Kawariki's GPL-3.0 preload
scripts, which stand in for Windows-only calls, from a pinned commit with pinned hashes; and the
RTP named in `Game.ini`, read out of m5kro's RTP archive without its DLLs. mkxp-z reads settings
only from inside its app bundle, so Aperto writes `mkxp.json` there before each launch.

## Local data and ownership

Aperto stores a versioned `library.json` in `~/Library/Application Support/Aperto`, with atomic
writes and a `.previous` recovery copy. A corrupt library produces an error instead of resetting
it. The main process serializes updates and validates IPC and stored records with Effect Schema.

Game files remain in their original location. The only game-content writes Aperto performs are
plugin toggles and restoration, the cheat menu and getPixel fix, and copies of custom artwork in
the game's `.aperto` folder. It does not change ownership, broadly change permissions,
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
