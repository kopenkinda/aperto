import { useState } from "react";
import { FolderOpenIcon, ImageIcon, PlayIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
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
import { compareVersions, type Game, type Launch, type PluginList, type Snapshot } from "./model";
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

export function GamePage({
  game,
  snapshot,
  onSettings,
}: {
  game: Game;
  snapshot: Snapshot;
  onSettings: () => void;
}) {
  const [name, setName] = useState(game.name);
  const [tags, setTags] = useState(game.tags.join(", "));
  const [flags, setFlags] = useState(game.flags.join("\n"));
  const [runtime, setRuntime] = useState(game.runtime);
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
  const dirty =
    name !== game.name ||
    tags !== game.tags.join(", ") ||
    flags !== game.flags.join("\n") ||
    runtime !== game.runtime;
  const downgrading = game.runtime && runtime && compareVersions(runtime, game.runtime) < 0;

  const loadPlugins = () =>
    void run(async () => setPlugins(await request({ action: "plugins", id: game.id })));

  return (
    <div className="flex flex-col">
      <header className="relative h-64 shrink-0 overflow-hidden">
        {game.artwork && (
          <img
            src={game.artwork}
            alt=""
            className="absolute inset-0 size-full scale-125 object-cover opacity-40 blur-3xl"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
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

      <div className="flex items-center gap-6 border-y bg-card/40 px-8 py-4">
        <Button
          size="lg"
          className="h-11 min-w-36 text-base"
          disabled={busy || missing || (!running && !game.runtime)}
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
          <div>
            <dt className="text-xs text-muted-foreground">Last played</dt>
            <dd>{running ? "Now" : lastPlayed(game)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Runtime</dt>
            <dd>{game.runtime ? `NW.js ${game.runtime}` : "None"}</dd>
          </div>
        </dl>
        <Button
          variant="outline"
          size="icon-lg"
          className="ml-auto"
          aria-label="Show in Finder"
          title="Show in Finder"
          onClick={() => void run(() => request({ action: "reveal", id: game.id }))}
        >
          <FolderOpenIcon />
        </Button>
      </div>

      <div className="flex w-full max-w-2xl flex-col gap-4 px-8 py-6">
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
          {!game.runtime && (
            <Alert>
              <AlertTitle>No NW.js runtime installed</AlertTitle>
              <AlertDescription>
                <button className="underline underline-offset-3" onClick={onSettings}>
                  Install one in Settings
                </button>
              </AlertDescription>
            </Alert>
          )}
          {launches[0]?.outcome === "failed" && !running && (
            <Alert>
              <AlertTitle>The last launch failed</AlertTitle>
              <AlertDescription>
                {launches[0].detail} Check Activity for the log.
                {fallback ? (
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
          className="gap-3"
          onValueChange={(value) => value === "plugins" && !plugins && loadPlugins()}
        >
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="plugins">Plugins</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <form
              className="flex flex-col gap-4 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await request({ action: "update", id: game.id, name, tags, runtime, flags });
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
              <div className="flex flex-col gap-2">
                <Label>Runtime</Label>
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
                    Saving backs up this game's browser data first. Saves may not load in an older
                    runtime.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="game-flags">Launch flags</Label>
                <Textarea
                  id="game-flags"
                  rows={2}
                  spellCheck={false}
                  placeholder="--disable-gpu"
                  className="font-mono text-xs"
                  value={flags}
                  onChange={(event) => setFlags(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">Optional. One switch per line.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || running || !dirty}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => request({ action: "artwork", id: game.id }))}
                >
                  <ImageIcon />
                  Change artwork
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="ml-auto"
                  disabled={busy || running}
                  onClick={() => setConfirm("remove")}
                >
                  Remove
                </Button>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="plugins" className="flex flex-col gap-3 pt-2">
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
                  The plugin list was changed outside Aperto. Editing is paused so those changes are
                  not overwritten.
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
                  <li key={`${index}-${plugin.name}`} className="flex items-center gap-3 px-3 py-2">
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

          <TabsContent value="activity" className="flex flex-col gap-2 pt-2">
            {!launches.length && <p className="text-muted-foreground">Not launched yet.</p>}
            {launches.map((launch) => (
              <details key={launch.id} className="rounded-lg border px-3 py-2">
                <summary className="flex cursor-pointer items-center justify-between gap-2">
                  <span className={launch.outcome === "failed" ? "text-destructive" : undefined}>
                    {outcomes[launch.outcome]}
                  </span>
                  <time className="text-xs text-muted-foreground">
                    {new Date(launch.startedAt).toLocaleString()}
                  </time>
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  NW.js {launch.runtime}. {launch.detail}
                </p>
                <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted p-2 text-[11px] break-all whitespace-pre-wrap">
                  {[...launch.flags, "", launch.log || "No output captured."].join("\n")}
                </pre>
              </details>
            ))}
          </TabsContent>
        </Tabs>

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
            {confirm === "remove" && (
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
                        await request({
                          action: "restorePlugins",
                          id: game.id,
                          hash: plugins.hash,
                        }),
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
    </div>
  );
}
