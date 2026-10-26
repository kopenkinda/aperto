import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleAlertIcon,
  CircleXIcon,
  FolderOpenIcon,
  ImageIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  SquareIcon,
  SquareTerminalIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Artwork } from "@/components/Artwork";
import { TagEditor } from "@/components/TagEditor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import {
  compareVersions,
  gameKind,
  playCount,
  tagCounts,
  type Game,
  type Launch,
  type PluginList,
  type Snapshot,
} from "./model";
import { request, useTask } from "./desktop";

const launchIcons: Record<Launch["outcome"], typeof PlayIcon> = {
  running: PlayIcon,
  ended: PlayIcon,
  stopped: SquareIcon,
  interrupted: CircleAlertIcon,
  failed: CircleXIcon,
};

/** "45s", "12m", or "1h 5m". */
function duration(from: string, to: string) {
  const seconds = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** One line per launch, in the past tense once it is over. */
function launchTitle(launch: Launch) {
  const length = launch.endedAt ? duration(launch.startedAt, launch.endedAt) : null;
  switch (launch.outcome) {
    case "running":
      return "Playing";
    case "ended":
      return length ? `Played for ${length}` : "Played";
    case "stopped":
      return length ? `Stopped after ${length}` : "Stopped";
    case "failed":
      return length ? `Failed after ${length}` : "Failed to start";
    case "interrupted":
      return "Tracking interrupted";
  }
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
export function lastPlayed(game: Game) {
  if (!game.lastPlayed) return "Never";
  const days = Math.round((Date.parse(game.lastPlayed) - Date.now()) / 86_400_000);
  return relative.format(days, "day").replace(/^./, (letter) => letter.toUpperCase());
}

/** The bottle a Windows game runs in, or null when none is chosen. */
export function bottleOf(game: Game, snapshot: Snapshot) {
  return game.bottle ?? snapshot.defaultBottle ?? null;
}

/** Whether Play can start the game, so the list and the page agree. */
export function playable(game: Game, snapshot: Snapshot) {
  if (snapshot.missing.includes(game.id)) return false;
  const kind = gameKind(game);
  if (kind === "mac") return true;
  return kind === "windows"
    ? snapshot.bottles !== null && bottleOf(game, snapshot) !== null
    : game.runtime !== null;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** One settings row: the label on the left, the control and its hint on the right. */
function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={htmlFor} className="sm:h-8">
        {label}
      </Label>
      <div className="flex min-w-0 flex-col gap-1.5">
        {children}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export function GamePage({
  game,
  snapshot,
  onSettings,
  onTag,
}: {
  game: Game;
  snapshot: Snapshot;
  onSettings: () => void;
  /** Shows the library's games with this tag. */
  onTag: (tag: string) => void;
}) {
  const kind = gameKind(game);
  const windows = kind === "windows";
  const nwjs = kind === "nwjs";
  const [name, setName] = useState(game.name);
  // Tags save on every change. Saves run one after another, since the library rejects a second
  // change to a game while one is in progress, and the field shows the latest list meanwhile.
  const [tags, setTags] = useState(game.tags);
  const tagSaves = useRef<Promise<unknown>>(Promise.resolve());
  const changeTags = (next: string[]) => {
    setTags(next);
    tagSaves.current = tagSaves.current.then(() =>
      run(() => request({ action: "setTags", id: game.id, tags: next })),
    );
  };
  const [flags, setFlags] = useState(game.flags.join("\n"));
  const [runtime, setRuntime] = useState(game.runtime);
  const [bottle, setBottle] = useState(game.bottle ?? null);
  const [highResolution, setHighResolution] = useState(!!game.highResolution);
  // Undefined while loading; null when the game is not an RPG Maker export and has no plugin list.
  const [plugins, setPlugins] = useState<PluginList | null | undefined>(undefined);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [pluginSearch, setPluginSearch] = useState("");
  const [confirm, setConfirm] = useState<"remove" | "trash" | "restore" | null>(null);
  // The folder a Shift-click removal moves to the Trash, shown in the dialog before it happens.
  const [trashFolder, setTrashFolder] = useState<string | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [artworkSlot, setArtworkSlot] = useState<"icon" | "banner" | null>(null);
  const [artworkUrl, setArtworkUrl] = useState("");
  const { run, busy, error, setError } = useTask();
  const running = snapshot.running.includes(game.id);
  // Keeps each plugin's position in the game's list, which toggling refers to.
  const pluginQuery = pluginSearch.trim().toLowerCase();
  const shownPlugins = (plugins?.plugins ?? [])
    .map((plugin, index) => ({ plugin, index }))
    .filter(
      ({ plugin }) =>
        !pluginQuery ||
        plugin.name.toLowerCase().includes(pluginQuery) ||
        plugin.description.toLowerCase().includes(pluginQuery),
    );
  const missing = snapshot.missing.includes(game.id);
  const launches = snapshot.launches.filter((launch) => launch.gameId === game.id);
  const runtimes = [...snapshot.runtimes].sort((a, b) => compareVersions(b.version, a.version));
  const fallback = runtimes.find(
    (item) => game.runtime && compareVersions(item.version, game.runtime) < 0,
  );
  const activeBottle = bottleOf(game, snapshot);
  const terminal =
    snapshot.terminals.find((item) => item.id === snapshot.terminal) ?? snapshot.terminals[0];
  const knownTags = tagCounts(snapshot.games).map(([tag]) => tag);
  const dirty =
    name !== game.name ||
    flags !== game.flags.join("\n") ||
    runtime !== game.runtime ||
    bottle !== (game.bottle ?? null) ||
    highResolution !== !!game.highResolution;
  const downgrading = game.runtime && runtime && compareVersions(runtime, game.runtime) < 0;
  const revert = () => {
    setName(game.name);
    setFlags(game.flags.join("\n"));
    setRuntime(game.runtime);
    setBottle(game.bottle ?? null);
    setHighResolution(!!game.highResolution);
  };

  useEffect(() => {
    setPluginSearch("");
    if (!nwjs) return;
    let active = true;
    request({ action: "plugins", id: game.id }).then(
      (list) => active && setPlugins(list),
      (cause: unknown) =>
        active && setPluginError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      active = false;
    };
  }, [game.id, nwjs]);

  return (
    <div className="flex flex-col">
      <header className="group/hero relative h-64 shrink-0 overflow-hidden">
        {game.banner ? (
          <img src={game.banner} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          game.artwork && (
            <img
              src={game.artwork}
              alt=""
              className="absolute inset-0 size-full scale-125 object-cover opacity-40 blur-3xl"
            />
          )
        )}
        <div
          className={`absolute inset-0 bg-gradient-to-b to-background ${
            game.banner ? "from-background/10 via-background/40" : "from-transparent"
          }`}
        />
        {/* Artwork controls stay out of the way until the header is hovered or focused. */}
        <div className="absolute top-14 right-8 z-20 flex gap-2 opacity-0 transition-opacity group-hover/hero:opacity-100 focus-within:opacity-100">
          {(["icon", "banner"] as const).map((slot) => (
            <Button
              key={slot}
              variant="outline"
              size="sm"
              className="bg-background/50 backdrop-blur"
              disabled={busy}
              onClick={() => {
                setArtworkUrl("");
                setError(null);
                setArtworkSlot(slot);
              }}
            >
              <ImageIcon />
              {slot === "icon" ? "Change icon" : "Change banner"}
            </Button>
          ))}
          {game.banner && (
            <Button
              variant="outline"
              size="icon-sm"
              className="bg-background/50 backdrop-blur"
              aria-label="Remove banner"
              title="Remove banner"
              disabled={busy}
              onClick={() => void run(() => request({ action: "clearBanner", id: game.id }))}
            >
              <XIcon />
            </Button>
          )}
        </div>
        <div className="relative flex h-full items-end gap-5 px-8 pb-6">
          <Artwork game={game} className="size-28 shrink-0 rounded-2xl ring-1 ring-foreground/10" />
          <div className="min-w-0 pb-1">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight text-balance">{game.name}</h1>
              <button
                type="button"
                aria-pressed={!!game.favorite}
                aria-label="Favorite"
                title={game.favorite ? "Remove from favorites" : "Add to favorites"}
                className={`grid size-8 shrink-0 place-items-center rounded-md outline-none hover:bg-background/50 focus-visible:ring-2 focus-visible:ring-ring/50 ${
                  game.favorite ? "text-amber-400" : "text-foreground/50 hover:text-foreground"
                }`}
                onClick={() =>
                  void run(() =>
                    request({ action: "setFavorite", id: game.id, favorite: !game.favorite }),
                  )
                }
              >
                <StarIcon className={`size-5 ${game.favorite ? "fill-current" : ""}`} />
              </button>
            </div>
            {tags.length > 0 && (
              <ul aria-label="Tags" className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <li key={tag}>
                    <button
                      type="button"
                      title={`Show games tagged ${tag}`}
                      className="h-6 rounded-md bg-background/50 px-2 text-xs text-foreground/80 ring-1 ring-foreground/10 backdrop-blur outline-none hover:bg-background/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      onClick={() => onTag(tag)}
                    >
                      {tag}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 truncate text-xs text-muted-foreground" title={game.root}>
              {game.root}
            </p>
          </div>
        </div>
      </header>

      <div className="flex items-center gap-8 border-y bg-card/40 px-8 py-4">
        <Button
          size="lg"
          className="h-11 min-w-36 text-base"
          disabled={busy || (!running && !playable(game, snapshot))}
          onClick={() =>
            void run(() => request({ action: running ? "stop" : "launch", id: game.id }))
          }
        >
          {running ? (
            <SquareIcon className="fill-current" />
          ) : (
            <PlayIcon className="fill-current" />
          )}
          {running ? "Stop" : "Play"}
        </Button>
        <dl className="flex gap-8 text-sm">
          <Fact label="Last played">{running ? "Now" : lastPlayed(game)}</Fact>
          <Fact label="Times played">{playCount(game, snapshot.launches)}</Fact>
          <Fact label="Runs with">
            {kind === "mac"
              ? "macOS"
              : windows
                ? `CrossOver${activeBottle ? ` · ${activeBottle}` : ""}`
                : game.runtime
                  ? `NW.js ${game.runtime}`
                  : "No runtime"}
          </Fact>
        </dl>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="icon-lg"
            aria-label="Show in Finder"
            title="Show in Finder"
            onClick={() => void run(() => request({ action: "reveal", id: game.id }))}
          >
            <FolderOpenIcon />
          </Button>
          {terminal && (
            <Button
              variant="outline"
              size="icon-lg"
              aria-label={`Open in ${terminal.name}`}
              title={`Open in ${terminal.name}`}
              onClick={() => void run(() => request({ action: "openTerminal", id: game.id }))}
            >
              <SquareTerminalIcon />
            </Button>
          )}
          <Button
            variant="destructive"
            size="icon-lg"
            aria-label="Remove from library"
            title={"Remove from library\nShift-click to also move its folder to the Trash"}
            disabled={busy || running}
            onClick={(event) => {
              if (!event.shiftKey) return setConfirm("remove");
              void run(async () => {
                setTrashFolder(await request({ action: "folderToTrash", id: game.id }));
                setConfirm("trash");
              });
            }}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      <div className="grid gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-2 empty:hidden">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {missing && (
              <Alert variant="destructive">
                <AlertTitle>The game folder is missing</AlertTitle>
                <AlertDescription>
                  <button
                    className="underline underline-offset-3"
                    onClick={() => void run(() => request({ action: "relink", id: game.id }))}
                  >
                    Locate it
                  </button>
                </AlertDescription>
              </Alert>
            )}
            {nwjs && !game.runtime && (
              <Alert>
                <AlertTitle>No NW.js runtime installed</AlertTitle>
                <AlertDescription>
                  <button className="underline underline-offset-3" onClick={onSettings}>
                    Install one in Settings
                  </button>
                </AlertDescription>
              </Alert>
            )}
            {windows && (snapshot.bottles === null || !activeBottle) && (
              <Alert>
                <AlertTitle>
                  {snapshot.bottles === null
                    ? "CrossOver is not installed"
                    : "Choose a CrossOver bottle"}
                </AlertTitle>
                <AlertDescription>
                  {snapshot.bottles === null ? (
                    "Windows games run through CrossOver in /Applications."
                  ) : (
                    <button className="underline underline-offset-3" onClick={onSettings}>
                      Pick a default bottle in Settings
                    </button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {launches[0]?.outcome === "failed" && !running && (
              <Alert>
                <AlertTitle>The last launch failed</AlertTitle>
                <AlertDescription>
                  {launches[0].detail} Check Activity for the log.
                  {!nwjs ? null : fallback ? (
                    <button
                      className="underline underline-offset-3"
                      onClick={() => setRuntime(fallback.version)}
                    >
                      Try NW.js {fallback.version}
                    </button>
                  ) : (
                    <button className="underline underline-offset-3" onClick={onSettings}>
                      Install an older runtime
                    </button>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="font-medium">Settings</h2>
            <form
              className="divide-y rounded-lg border bg-card/40"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await request({
                    action: "update",
                    id: game.id,
                    name,
                    runtime,
                    bottle,
                    highResolution,
                    flags,
                  });
                  setName(name.trim());
                });
              }}
            >
              <Field label="Name" htmlFor="game-name">
                <Input
                  id="game-name"
                  required
                  maxLength={160}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field label="Tags" htmlFor="game-tags" hint="Saved as you edit them.">
                <TagEditor id="game-tags" tags={tags} known={knownTags} onChange={changeTags} />
              </Field>

              {windows ? (
                <>
                  <Field
                    label="CrossOver bottle"
                    hint="Runs like CrossOver's Run Command. Nothing is installed in the bottle."
                  >
                    <Select
                      value={bottle}
                      disabled={running || snapshot.bottles === null}
                      onValueChange={(value) => setBottle(value as string | null)}
                      items={[
                        {
                          value: null,
                          label: snapshot.defaultBottle
                            ? `Default (${snapshot.defaultBottle})`
                            : "Default",
                        },
                        ...(snapshot.bottles ?? []).map((item) => ({ value: item, label: item })),
                      ]}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={null}>
                          {snapshot.defaultBottle
                            ? `Default (${snapshot.defaultBottle})`
                            : "Default"}
                        </SelectItem>
                        {(snapshot.bottles ?? []).map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    label="High resolution"
                    htmlFor="game-high-resolution"
                    hint="Sharp on Retina displays, but slower in demanding games. CrossOver applies it to the whole bottle, so Aperto switches the bottle when this game starts."
                  >
                    <div className="flex min-h-8 items-center">
                      <Switch
                        id="game-high-resolution"
                        checked={highResolution}
                        onCheckedChange={setHighResolution}
                      />
                    </div>
                  </Field>
                </>
              ) : nwjs ? (
                <Field
                  label="NW.js runtime"
                  hint={
                    downgrading &&
                    "Saving backs up this game's browser data first. Saves may not load in an older runtime."
                  }
                >
                  <Select
                    value={runtime}
                    disabled={running}
                    onValueChange={(value) => setRuntime(value as string | null)}
                    items={[
                      { value: null, label: "None" },
                      ...runtimes.map((item) => ({
                        value: item.version,
                        label: `NW.js ${item.version}`,
                      })),
                    ]}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {runtimes.map((item) => (
                        <SelectItem key={item.version} value={item.version}>
                          NW.js {item.version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Field label="Opens with">
                  <p className="flex min-h-8 items-center text-muted-foreground">
                    macOS, like double-clicking the app in Finder.
                  </p>
                </Field>
              )}

              <Field
                label={nwjs ? "Launch flags" : "Launch arguments"}
                htmlFor="game-flags"
                hint="Optional. One per line."
              >
                <Textarea
                  id="game-flags"
                  spellCheck={false}
                  rows={3}
                  placeholder={nwjs ? "--disable-gpu" : "-screen-fullscreen 0"}
                  className="min-h-20 font-mono text-xs"
                  value={flags}
                  onChange={(event) => setFlags(event.target.value)}
                />
              </Field>

              <div className="flex items-center justify-end gap-2 px-4 py-3">
                {running && (
                  <p className="mr-auto text-xs text-muted-foreground">
                    Close the game to save changes.
                  </p>
                )}
                {dirty && (
                  <Button type="button" variant="ghost" onClick={revert}>
                    Revert
                  </Button>
                )}
                <Button type="submit" disabled={busy || running || !dirty}>
                  Save changes
                </Button>
              </div>
            </form>
          </section>

          {nwjs && plugins !== null && (
            <section className="flex flex-col gap-3">
              <h2 className="flex items-baseline justify-between font-medium">
                Plugins
                {plugins && plugins.plugins.length > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {plugins.plugins.filter((plugin) => plugin.enabled).length} of{" "}
                    {plugins.plugins.length} on
                  </span>
                )}
              </h2>
              <p className="text-xs text-muted-foreground">
                Changes edit the game's own plugin list and apply on the next launch, also outside
                Aperto.
              </p>
              {running && (
                <p className="text-xs text-muted-foreground">Close the game to edit plugins.</p>
              )}
              {plugins?.conflict && (
                <Alert variant="destructive">
                  <AlertDescription>
                    The plugin list was changed outside Aperto. Editing is paused so those changes
                    are not overwritten.
                  </AlertDescription>
                </Alert>
              )}
              {pluginError && <p className="text-muted-foreground">{pluginError}</p>}
              {plugins === undefined && !pluginError && (
                <p className="text-muted-foreground">Reading plugins…</p>
              )}
              {plugins && !plugins.plugins.length && (
                <p className="text-muted-foreground">This game has no plugins.</p>
              )}
              {plugins && plugins.plugins.length > 0 && (
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search plugins"
                    placeholder="Search plugins"
                    className="pl-8"
                    value={pluginSearch}
                    onChange={(event) => setPluginSearch(event.target.value)}
                  />
                </div>
              )}
              {plugins && plugins.plugins.length > 0 && !shownPlugins.length && (
                <p className="text-muted-foreground">No plugins match “{pluginSearch.trim()}”.</p>
              )}
              {shownPlugins.length > 0 && plugins && (
                <ul className="divide-y rounded-lg border">
                  {shownPlugins.map(({ plugin, index }) => (
                    <li
                      key={`${index}-${plugin.name}`}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{plugin.name || "Unnamed entry"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {plugin.missing ? "Plugin file is missing" : plugin.description}
                        </p>
                      </div>
                      <Switch
                        aria-label={`Enable ${plugin.name || "unnamed plugin"}`}
                        checked={plugin.enabled}
                        disabled={
                          busy ||
                          running ||
                          plugins.conflict ||
                          !plugin.name ||
                          (plugin.missing && !plugin.enabled)
                        }
                        onCheckedChange={(enabled) =>
                          void run(async () =>
                            setPlugins(
                              await request({
                                action: "togglePlugin",
                                id: game.id,
                                hash: plugins.hash,
                                index,
                                enabled,
                              }),
                            ),
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
              {plugins?.canRestore && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={busy || running}
                    onClick={() => setConfirm("restore")}
                  >
                    <RotateCcwIcon />
                    Restore original
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void run(() => request({ action: "revealPluginBackup", id: game.id }))
                    }
                  >
                    Show backup
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-3">
          <h2 className="flex items-baseline justify-between font-medium">
            Activity
            {launches.length > 10 && (
              <span className="text-xs font-normal text-muted-foreground">Latest 10</span>
            )}
          </h2>
          {!launches.length && <p className="text-muted-foreground">Not launched yet.</p>}
          <Trace>
            {launches.slice(0, 10).map((launch) => {
              const Icon = launchIcons[launch.outcome];
              return (
                <TraceCollapsible key={launch.id}>
                  <TraceCollapsibleTrigger>
                    <TraceLine
                      status={
                        launch.outcome === "running"
                          ? "running"
                          : launch.outcome === "failed"
                            ? "error"
                            : undefined
                      }
                    >
                      <TraceIcon>
                        <Icon />
                      </TraceIcon>
                      <TraceTitle>{launchTitle(launch)}</TraceTitle>
                      <TraceDescription>
                        <time dateTime={launch.startedAt}>
                          {new Date(launch.startedAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                      </TraceDescription>
                    </TraceLine>
                  </TraceCollapsibleTrigger>
                  <TraceCollapsibleContent className="flex flex-col gap-2 text-xs">
                    <p>
                      {windows
                        ? `CrossOver bottle ${launch.runtime}`
                        : nwjs
                          ? `NW.js ${launch.runtime}`
                          : "macOS"}
                      . {launch.detail}
                    </p>
                    <pre className="max-h-60 overflow-auto rounded-md bg-muted p-2 text-[11px] break-all whitespace-pre-wrap text-foreground">
                      {[...launch.flags, "", launch.log || "No output captured."].join("\n")}
                    </pre>
                  </TraceCollapsibleContent>
                </TraceCollapsible>
              );
            })}
          </Trace>
        </aside>
      </div>

      <Dialog
        open={artworkSlot !== null}
        onOpenChange={(open) => !open && !busy && setArtworkSlot(null)}
      >
        <DialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              if (!artworkSlot || !artworkUrl.trim()) return;
              void run(async () => {
                await request({
                  action: "artwork",
                  id: game.id,
                  slot: artworkSlot,
                  url: artworkUrl.trim(),
                });
                setArtworkSlot(null);
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {artworkSlot === "banner" ? "Change banner" : "Change icon"}
              </DialogTitle>
              <DialogDescription>
                Paste an image address or choose a file. Aperto keeps a copy in the game&rsquo;s
                .aperto folder.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="artwork-url">Image address</Label>
              <Input
                id="artwork-url"
                type="url"
                placeholder="https://example.com/image.png"
                value={artworkUrl}
                onChange={(event) => setArtworkUrl(event.target.value)}
                disabled={busy}
                autoFocus
              />
            </div>
            {(artworkSlot === "banner" ? !!game.banner : !!game.customIcon) && (
              <p className="text-sm text-muted-foreground">
                {artworkSlot === "banner"
                  ? "This game has a banner. "
                  : "This game uses an icon you chose. "}
                <button
                  type="button"
                  className="text-foreground underline underline-offset-3 disabled:opacity-50"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await request({
                        action: artworkSlot === "banner" ? "clearBanner" : "resetIcon",
                        id: game.id,
                      });
                      setArtworkSlot(null);
                    })
                  }
                >
                  {artworkSlot === "banner" ? "Remove it" : "Use the original icon"}
                </button>
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="sm:mr-auto"
                disabled={busy}
                onClick={() =>
                  artworkSlot &&
                  void run(async () => {
                    await request({ action: "artwork", id: game.id, slot: artworkSlot });
                    setArtworkSlot(null);
                  })
                }
              >
                <FolderOpenIcon />
                Choose file…
              </Button>
              <Button type="submit" disabled={busy || !artworkUrl.trim()}>
                {busy && <Spinner />}
                Download
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "remove"
                ? `Remove ${game.name}?`
                : confirm === "trash"
                  ? `Delete ${game.name}?`
                  : "Restore original plugins?"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "remove"
                ? "The game folder stays where it is, and later scans will not add it back. Add the folder by hand to bring it back."
                : confirm === "trash"
                  ? "Aperto removes the game and moves its folder to the Trash, with any saves kept inside it. You can put it back from the Trash until it is emptied."
                  : "This puts back the plugin list from before Aperto first changed it."}
            </DialogDescription>
          </DialogHeader>
          {confirm === "trash" && trashFolder && (
            <p className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all">
              {trashFolder}
            </p>
          )}
          {confirm !== "restore" && nwjs && (
            <Label className="items-start font-normal">
              <Checkbox
                checked={deleteData}
                onCheckedChange={(checked) => setDeleteData(checked)}
              />
              Also delete Aperto's browser data for this game. This can include saves.
            </Label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (confirm === "remove" || confirm === "trash") {
                    await request({
                      action: "remove",
                      id: game.id,
                      deleteData,
                      trashFolder: confirm === "trash",
                    });
                  } else if (plugins) {
                    setPlugins(
                      await request({ action: "restorePlugins", id: game.id, hash: plugins.hash }),
                    );
                  }
                  setConfirm(null);
                })
              }
            >
              {confirm === "remove" ? "Remove" : confirm === "trash" ? "Move to Trash" : "Restore"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
