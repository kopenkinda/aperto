import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpIcon, DownloadIcon, FolderOpenIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  compareVersions,
  updateAvailable,
  type Component,
  type Release,
  type Snapshot,
} from "./model";
import { request, useTask } from "./desktop";
import { TagManager } from "@/components/TagManager";

/** One setting: its label on the left, the control and an optional hint on the right. */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
      <span className="font-medium sm:leading-8">{label}</span>
      <div className="flex min-w-0 flex-col gap-1.5">
        {children}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="divide-y rounded-lg border bg-card/40">{children}</div>
    </section>
  );
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
/** "5 minutes ago", "yesterday". */
const ago = (time: string) => {
  const minutes = Math.round((Date.parse(time) - Date.now()) / 60_000);
  if (minutes > -60) return relative.format(minutes, "minute");
  if (minutes > -24 * 60) return relative.format(Math.round(minutes / 60), "hour");
  return relative.format(Math.round(minutes / (24 * 60)), "day");
};

const megabytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

/**
 * Downloads Aperto keeps for one kind of game, each removable. They are fetched again the next
 * time a game needs them.
 */
function Downloads({
  items,
  busy,
  onRemove,
  hint,
}: {
  /** Undefined while reading. */
  items: Component[] | undefined;
  busy: boolean;
  onRemove: (id: string) => void;
  hint?: string;
}) {
  return (
    <>
      {items?.map((item) => (
        <div key={item.id} className="flex items-center gap-3 py-1.5 pr-2 pl-4">
          <span className="flex-1">
            {item.name}
            <span className="ml-2 text-muted-foreground">{megabytes(item.size)}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            title="Downloaded again the next time a game needs it"
            onClick={() => onRemove(item.id)}
          >
            Remove
          </Button>
        </div>
      ))}
      {hint && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          {items === undefined ? "Reading downloads…" : !items.length && "Nothing downloaded yet. "}
          {items !== undefined && hint}
        </p>
      )}
    </>
  );
}

export function Settings({
  open,
  onOpenChange,
  snapshot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Snapshot;
}) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  // Null until read; read again each time Settings opens, since games download on launch.
  const [components, setComponents] = useState<Component[] | null>(null);
  const { run, busy, error } = useTask();
  const automaticTerminal = snapshot.terminals[0]
    ? `Automatic (${snapshot.terminals[0].name})`
    : "Automatic";
  const installed = [...snapshot.runtimes].sort((a, b) => compareVersions(b.version, a.version));
  const [checking, setChecking] = useState(false);
  const linked = snapshot.games.filter((game) => game.update).length;
  const outdated = snapshot.games.filter(updateAvailable);

  const removeComponent = (id: string) =>
    void run(async () => setComponents(await request({ action: "removeComponent", id })));

  useEffect(() => {
    if (!open) return;
    let active = true;
    request({ action: "components" }).then(
      (list) => active && setComponents(list),
      () => active && setComponents([]),
    );
    return () => {
      active = false;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-6 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Games folder, apps Aperto opens, and what each kind of game runs with
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Section title="Library">
          <Row
            label="Games folder"
            hint="Aperto adds the NW.js, Ren'Py, RPG Maker XP–VX Ace, Windows, and Mac games in this folder when it opens and when you come back to it. Copies of a game you already have are skipped; other versions are added separately."
          >
            <div className="flex items-center gap-2">
              {snapshot.gamesFolder ? (
                <div className="flex min-w-0 flex-1 items-center gap-1 rounded-lg border bg-input/30 py-0.5 pr-0.5 pl-3">
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-xs"
                    title={snapshot.gamesFolder}
                  >
                    {snapshot.gamesFolder}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Scan now"
                    title="Scan now"
                    disabled={snapshot.scanning}
                    onClick={() => void run(() => request({ action: "scan" }))}
                  >
                    {snapshot.scanning ? <Spinner /> : <RefreshCwIcon />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Stop using this folder"
                    title="Stop using this folder"
                    onClick={() => void run(() => request({ action: "clearGamesFolder" }))}
                  >
                    <XIcon />
                  </Button>
                </div>
              ) : (
                <span className="flex-1 text-muted-foreground">None</span>
              )}
              <Button
                variant="outline"
                disabled={busy || snapshot.scanning}
                onClick={() => void run(() => request({ action: "chooseGamesFolder" }))}
              >
                <FolderOpenIcon />
                {snapshot.gamesFolder ? "Change" : "Choose"}
              </Button>
            </div>
          </Row>
        </Section>

        <Section title="Apps">
          <Row
            label="CrossOver bottle"
            hint="Windows games run in this bottle unless a game picks another. Aperto runs the game's .exe directly, like Run Command, without installing anything in the bottle."
          >
            {snapshot.bottles === null ? (
              <p className="leading-8 text-muted-foreground">
                CrossOver was not found in /Applications.
              </p>
            ) : (
              <Select
                value={snapshot.defaultBottle ?? null}
                onValueChange={(value) =>
                  void run(() =>
                    request({ action: "setDefaultBottle", bottle: value as string | null }),
                  )
                }
                items={[
                  { value: null, label: "No default bottle" },
                  ...snapshot.bottles.map((item) => ({ value: item, label: item })),
                ]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>No default bottle</SelectItem>
                  {snapshot.bottles.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Row>
          <Row
            label="Terminal"
            hint="Opens a game's folder from its page. Automatic prefers Ghostty, iTerm, or Warp over Terminal."
          >
            <Select
              value={
                snapshot.terminals.some((item) => item.id === snapshot.terminal)
                  ? snapshot.terminal!
                  : null
              }
              onValueChange={(value) =>
                void run(() => request({ action: "setTerminal", terminal: value as string | null }))
              }
              items={[
                { value: null, label: automaticTerminal },
                ...snapshot.terminals.map((item) => ({ value: item.id, label: item.name })),
              ]}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>{automaticTerminal}</SelectItem>
                {snapshot.terminals.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        </Section>

        <Section title="Updates">
          <Row
            label="F95zone"
            hint={`Aperto compares the version in each game's folder name with its F95zone thread twice a day, while it runs. Games tagged from Steam are found on F95zone by their exact title. ${
              snapshot.updatesCheckedAt
                ? `Last checked ${ago(snapshot.updatesCheckedAt)}.`
                : "Not checked yet."
            }`}
          >
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={checking}
                onClick={() => {
                  setChecking(true);
                  void run(() => request({ action: "checkUpdates" })).finally(() =>
                    setChecking(false),
                  );
                }}
              >
                {checking ? <Spinner /> : <RefreshCwIcon />}
                Check now
              </Button>
              <span className="text-muted-foreground">
                {!linked
                  ? "No game has been found on F95zone yet."
                  : outdated.length
                    ? `${outdated.length} ${outdated.length === 1 ? "update" : "updates"} available`
                    : "Everything is up to date."}
              </span>
            </div>
          </Row>
        </Section>

        <Section title="Tags">
          <TagManager snapshot={snapshot} busy={busy} run={(work) => void run(work)} />
        </Section>

        <Section title="NW.js">
          {installed.map((runtime) => {
            const users = snapshot.games.filter((game) => game.runtime === runtime.version).length;
            const newest = installed[0]!.version;
            const outdated = users > 0 && compareVersions(newest, runtime.version) > 0;
            return (
              <div key={runtime.version} className="flex items-center gap-3 py-1.5 pr-2 pl-4">
                <span className="flex-1">
                  NW.js {runtime.version}
                  <span className="ml-2 text-muted-foreground">
                    {users ? `${users} ${users === 1 ? "game" : "games"}` : "unused"}
                  </span>
                </span>
                {outdated && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    title={`Switch ${users === 1 ? "its game" : `its ${users} games`} to NW.js ${newest}. This version stays installed, so a game can go back to it.`}
                    onClick={() =>
                      void run(() =>
                        request({ action: "updateRuntime", from: runtime.version, to: newest }),
                      )
                    }
                  >
                    <ArrowUpIcon />
                    Update {users === 1 ? "game" : "games"} to {newest}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || users > 0}
                  title={users ? "Assign another runtime to its games first" : undefined}
                  onClick={() =>
                    void run(() => request({ action: "removeRuntime", version: runtime.version }))
                  }
                >
                  Remove
                </Button>
              </div>
            );
          })}
          {snapshot.downloads.map((download) => (
            <div key={download.version} className="flex items-center gap-2 py-1.5 pr-2 pl-4">
              <Spinner />
              <span className="min-w-0 flex-1 truncate" role="status">
                NW.js {download.version} · {download.detail}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void request({ action: "cancelDownload", version: download.version }).catch(
                    () => {},
                  )
                }
              >
                Cancel
              </Button>
            </div>
          ))}
          <div className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-center gap-2">
              {releases.length ? (
                <>
                  <Select
                    value={version}
                    onValueChange={(value) => setVersion(value as string | null)}
                    items={releases.map((release, index) => ({
                      value: release.version,
                      label: index === 0 ? `${release.version} (latest)` : release.version,
                    }))}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {releases.map((release, index) => (
                        <SelectItem key={release.version} value={release.version}>
                          {index === 0 ? `${release.version} (latest)` : release.version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={
                      busy || !version || installed.some((item) => item.version === version)
                    }
                    onClick={() =>
                      version && void run(() => request({ action: "installRuntime", version }))
                    }
                  >
                    <DownloadIcon />
                    Install
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const entries = await request({ action: "releases" });
                      setReleases(entries);
                      setVersion(entries[0]?.version ?? null);
                    })
                  }
                >
                  {busy ? <Spinner /> : <DownloadIcon />}
                  {installed.length ? "Install another version" : "Install NW.js"}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Official macOS ARM64 builds, verified before installing. New games use the newest one.
            </p>
          </div>
          {components?.some((item) => item.kind === "nwjs") && (
            <Downloads
              items={components.filter((item) => item.kind === "nwjs")}
              busy={busy}
              onRemove={removeComponent}
            />
          )}
        </Section>

        <Section title="Ren'Py">
          <Downloads
            items={components?.filter((item) => item.kind === "renpy")}
            busy={busy}
            onRemove={removeComponent}
            hint="Games without their own Mac build run with the Ren'Py release they were made with. Each release is downloaded from renpy.org the first time a game needs it."
          />
        </Section>

        <Section title="RPG Maker XP–VX Ace">
          <Downloads
            items={components?.filter((item) => item.kind === "rgss")}
            busy={busy}
            onRemove={removeComponent}
            hint="These games run with mkxp-z and Kawariki's compatibility scripts, plus the RTP a game names. All are downloaded the first time a game needs them."
          />
        </Section>
      </DialogContent>
    </Dialog>
  );
}
