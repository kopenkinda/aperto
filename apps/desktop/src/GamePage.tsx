import { useState, type ReactNode } from "react";
import {
  FolderOpenIcon,
  ImageIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Artwork } from "@/components/Artwork";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  compareVersions,
  gameKind,
  type Game,
  type Launch,
  type PluginList,
  type Snapshot,
} from "./model";
import { request, useTask } from "./desktop";

const outcomes: Record<Launch["outcome"], string> = {
  running: "Running",
  ended: "Closed",
  stopped: "Stopped",
  interrupted: "Tracking interrupted",
  failed: "Failed",
};

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

export function GamePage({
  game,
  snapshot,
  onSettings,
}: {
  game: Game;
  snapshot: Snapshot;
  onSettings: () => void;
}) {
  const kind = gameKind(game);
  const windows = kind === "windows";
  const nwjs = kind === "nwjs";
  const [name, setName] = useState(game.name);
  const [tags, setTags] = useState(game.tags.join(", "));
  const [flags, setFlags] = useState(game.flags.join("\n"));
  const [runtime, setRuntime] = useState(game.runtime);
  const [bottle, setBottle] = useState(game.bottle ?? null);
  const [plugins, setPlugins] = useState<PluginList | null>(null);
  const [confirm, setConfirm] = useState<"remove" | "restore" | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const { run, busy, error } = useTask();
  const running = snapshot.running.includes(game.id);
  const missing = snapshot.missing.includes(game.id);
  const launches = snapshot.launches.filter((launch) => launch.gameId === game.id);
  const runtimes = [...snapshot.runtimes].sort((a, b) => compareVersions(b.version, a.version));
  const fallback = runtimes.find(
    (item) => game.runtime && compareVersions(item.version, game.runtime) < 0,
  );
  const activeBottle = bottleOf(game, snapshot);
  const dirty =
    name !== game.name ||
    tags !== game.tags.join(", ") ||
    flags !== game.flags.join("\n") ||
    runtime !== game.runtime ||
    bottle !== (game.bottle ?? null);
  const downgrading = game.runtime && runtime && compareVersions(runtime, game.runtime) < 0;
  const revert = () => {
    setName(game.name);
    setTags(game.tags.join(", "));
    setFlags(game.flags.join("\n"));
    setRuntime(game.runtime);
    setBottle(game.bottle ?? null);
  };
  const loadPlugins = () =>
    void run(async () => setPlugins(await request({ action: "plugins", id: game.id })));

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
              onClick={() => void run(() => request({ action: "artwork", id: game.id, slot }))}
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
            <h1 className="text-3xl font-semibold tracking-tight text-balance">{game.name}</h1>
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
          <Fact label="Sessions">{launches.length}</Fact>
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
          <Button
            variant="destructive"
            size="icon-lg"
            aria-label="Remove from library"
            title="Remove from library"
            disabled={busy || running}
            onClick={() => setConfirm("remove")}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      <div className="grid gap-8 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
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

          <Tabs
            defaultValue="general"
            className="gap-4"
            onValueChange={(value) => value === "plugins" && !plugins && loadPlugins()}
          >
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              {nwjs && <TabsTrigger value="plugins">Plugins</TabsTrigger>}
            </TabsList>

            <TabsContent value="general">
              <form
                className="grid gap-x-6 gap-y-5 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await request({
                      action: "update",
                      id: game.id,
                      name,
                      tags,
                      runtime,
                      bottle,
                      flags,
                    });
                    setName(name.trim());
                  });
                }}
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="game-name">Name</Label>
                  <Input
                    id="game-name"
                    required
                    maxLength={160}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="game-tags">Tags</Label>
                  <Input
                    id="game-tags"
                    placeholder="Separated by commas"
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                  />
                </div>

                {windows ? (
                  <div className="flex flex-col gap-2">
                    <Label>CrossOver bottle</Label>
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
                    <p className="text-xs text-muted-foreground">
                      Runs like CrossOver's Run Command. Nothing is installed in the bottle.
                    </p>
                  </div>
                ) : nwjs ? (
                  <div className="flex flex-col gap-2">
                    <Label>NW.js runtime</Label>
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
                    {downgrading && (
                      <p className="text-xs text-muted-foreground">
                        Saving backs up this game's browser data first. Saves may not load in an
                        older runtime.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Label>Opens with</Label>
                    <p className="text-muted-foreground">
                      macOS, like double-clicking the app in Finder.
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-2 sm:row-span-2">
                  <Label htmlFor="game-flags">{nwjs ? "Launch flags" : "Launch arguments"}</Label>
                  <Textarea
                    id="game-flags"
                    spellCheck={false}
                    placeholder={nwjs ? "--disable-gpu" : "-screen-fullscreen 0"}
                    className="min-h-24 flex-1 font-mono text-xs"
                    value={flags}
                    onChange={(event) => setFlags(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Optional. One per line.</p>
                </div>

                <div className="flex items-end gap-2 sm:col-start-1">
                  <Button type="submit" disabled={busy || running || !dirty}>
                    Save changes
                  </Button>
                  {dirty && (
                    <Button type="button" variant="ghost" onClick={revert}>
                      Revert
                    </Button>
                  )}
                </div>
              </form>
            </TabsContent>

            {nwjs && (
              <TabsContent value="plugins" className="flex flex-col gap-3">
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
                {!plugins && busy && <p className="text-muted-foreground">Reading plugins…</p>}
                {plugins && !plugins.plugins.length && (
                  <p className="text-muted-foreground">This game has no plugins.</p>
                )}
                {plugins && plugins.plugins.length > 0 && (
                  <ul className="divide-y rounded-lg border">
                    {plugins.plugins.map((plugin, index) => (
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
              </TabsContent>
            )}
          </Tabs>
        </div>

        <aside className="flex flex-col gap-3">
          <h2 className="flex items-baseline justify-between font-medium">
            Activity
            {launches.length > 10 && (
              <span className="text-xs font-normal text-muted-foreground">Latest 10</span>
            )}
          </h2>
          {!launches.length && <p className="text-muted-foreground">Not launched yet.</p>}
          <ol className="flex flex-col gap-1.5">
            {launches.slice(0, 10).map((launch) => (
              <li key={launch.id}>
                <details className="group rounded-lg border bg-card/40 px-3 py-2">
                  <summary className="flex cursor-pointer list-none items-center gap-2">
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${
                        launch.outcome === "failed"
                          ? "bg-destructive"
                          : launch.outcome === "running"
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/50"
                      }`}
                    />
                    <span className={launch.outcome === "failed" ? "text-destructive" : undefined}>
                      {outcomes[launch.outcome]}
                    </span>
                    <time className="ml-auto text-xs text-muted-foreground">
                      {new Date(launch.startedAt).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </time>
                  </summary>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {windows
                      ? `CrossOver bottle ${launch.runtime}`
                      : nwjs
                        ? `NW.js ${launch.runtime}`
                        : "macOS"}
                    . {launch.detail}
                  </p>
                  <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted p-2 text-[11px] break-all whitespace-pre-wrap">
                    {[...launch.flags, "", launch.log || "No output captured."].join("\n")}
                  </pre>
                </details>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "remove" ? `Remove ${game.name}?` : "Restore original plugins?"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "remove"
                ? "The game folder stays where it is, and later scans will not add it back. Add the folder by hand to bring it back."
                : "This puts back the plugin list from before Aperto first changed it."}
            </DialogDescription>
          </DialogHeader>
          {confirm === "remove" && nwjs && (
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
                  if (confirm === "remove") {
                    await request({ action: "remove", id: game.id, deleteData });
                  } else if (plugins) {
                    setPlugins(
                      await request({ action: "restorePlugins", id: game.id, hash: plugins.hash }),
                    );
                  }
                  setConfirm(null);
                })
              }
            >
              {confirm === "remove" ? "Remove" : "Restore"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
