# Aperto

Aperto manages local games and the compatibility paths used to run them on macOS.

## Language

**NW.js game**:
A game distributed as an NW.js application, regardless of the framework or authoring tool used to create it.
_Avoid_: RPG Maker game, NW.js engine

**Launch profile**:
The effective command-line flags and runtime settings Aperto uses to start one game. It begins with macOS-safe defaults and may contain per-game overrides.
_Avoid_: Launch options, engine flags

**Game reference**:
A library entry that points to a game in its existing filesystem location. Aperto does not own or uninstall the referenced game files.
_Avoid_: Installed game, managed game copy

**Display name**:
The user-editable name shown for a game, independent of generic filenames such as `Game.exe`.
_Avoid_: Executable name, game title

**Tag**:
A normalized label stored as one value on a game reference. The editor may accept comma-separated text but does not store tags as one string.
_Avoid_: Category, tag string

**Artwork**:
The single image assigned to a game for use in every library layout. Aperto may discover it during import or the user may replace it.
_Avoid_: Icon, banner

**Library**:
The local collection of game references and their Aperto-owned metadata. It starts empty and does not import Xenolauncher data in V1.
_Avoid_: Account, synced library

**Runtime inventory**:
The macOS NW.js versions downloaded and retained by Aperto. A runtime may be shared by several games.
_Avoid_: Bundled engine, system NW.js

**Runtime assignment**:
The NW.js version selected from the runtime inventory to launch one game.
_Avoid_: Game engine version

**Default runtime**:
The latest NW.js version supported by Aperto. Aperto downloads it first and assigns it to newly imported games before trying compatibility fallbacks.
_Avoid_: Detected runtime, original runtime

**Guided fallback**:
A recovery flow that suggests an older NW.js runtime after a failed launch and asks before downloading or assigning it. Aperto never cycles through runtime versions without user approval.
_Avoid_: Automatic downgrade, runtime retry loop
