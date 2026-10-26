import { useEffect, useState } from "react";
import {
  FolderOpenIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { ApertoMark } from "@/components/ApertoMark";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { GamePage } from "./GamePage";
import { Settings } from "./Settings";
import { request, useTask } from "./desktop";
import type { Command, Game, ScanReport, Snapshot } from "./model";

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dismissedScan, setDismissedScan] = useState<string | null>(null);
  const { run, busy, error, setError } = useTask();

  useEffect(() => {
    let active = true;
    let sequence = 0;
    const refresh = () => {
      const current = ++sequence;
      void request({ action: "snapshot" })
        .then((state) => {
          if (active && current === sequence) {
            setSnapshot(state);
            setLoadError(null);
          }
        })
        .catch((cause: unknown) => {
          if (active) setLoadError(cause instanceof Error ? cause.message : String(cause));
        });
    };
    refresh();
    const unsubscribe = window.desktop?.onChange(refresh);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const games = [...(snapshot?.games ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const query = search.trim().toLowerCase();
  const visible = games.filter((game) =>
    `${game.name} ${game.tags.join(" ")}`.toLowerCase().includes(query),
  );
  // Like Steam, something is always open: the chosen game, else the first in the list.
  const game = games.find((item) => item.id === selected) ?? visible[0] ?? games[0];
  const scan = snapshot?.lastScan;
  const act = (command: Command) =>
    void run(async () => setSnapshot((await request(command)) as Snapshot));
  const toggle = (item: Game) =>
    act({ action: snapshot?.running.includes(item.id) ? "stop" : "launch", id: item.id });

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar">
        <div className="app-drag h-12 shrink-0" />
        <div className="px-3 pb-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search games"
              placeholder="Search"
              className="pl-8"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        <nav aria-label="Games" className="flex-1 overflow-y-auto px-2 pb-2">
          {visible.map((item) => {
            const running = snapshot?.running.includes(item.id);
            const missing = snapshot?.missing.includes(item.id);
            return (
              <button
                key={item.id}
                aria-current={item.id === game?.id ? "true" : undefined}
                title={`${item.name}\nDouble-click to ${running ? "stop" : "play"}`}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none select-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 aria-current:bg-sidebar-accent aria-current:text-sidebar-accent-foreground",
                  missing && "text-muted-foreground",
                )}
                onClick={() => setSelected(item.id)}
                onDoubleClick={() => !missing && item.runtime && toggle(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !missing && item.runtime) {
                    event.preventDefault();
                    toggle(item);
                  }
                }}
              >
                <span className="relative size-6 shrink-0 overflow-hidden rounded bg-muted">
                  {item.artwork ? (
                    <img src={item.artwork} alt="" className="size-full object-cover" />
                  ) : (
                    <span className="grid size-full place-items-center text-[10px] font-semibold text-muted-foreground">
                      {item.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {running && (
                  <span
                    className="size-2 shrink-0 rounded-full bg-emerald-500"
                    aria-label="Running"
                  />
                )}
              </button>
            );
          })}
          {games.length > 0 && !visible.length && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches</p>
          )}
        </nav>
        <footer className="flex items-center gap-1 border-t px-2 py-2">
          <span className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <ApertoMark className="size-4" />
            {games.length} {games.length === 1 ? "game" : "games"}
          </span>
          <div className="ml-auto flex">
            {snapshot?.gamesFolder && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Scan games folder"
                title="Scan games folder"
                disabled={snapshot.scanning}
                onClick={() => act({ action: "scan" })}
              >
                {snapshot.scanning ? <Spinner /> : <RefreshCwIcon />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Add games from a folder"
              title="Add games from a folder"
              disabled={busy}
              onClick={() => act({ action: "addGames" })}
            >
              <PlusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Settings"
              title="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
            </Button>
          </div>
        </footer>
      </aside>

      <main className="relative flex-1 overflow-y-auto">
        <div className="app-drag absolute inset-x-0 top-0 z-10 h-12" />
        {!snapshot && !loadError && (
          <div className="grid h-full place-items-center">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        )}

        {snapshot && !games.length && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <ApertoMark className="size-14 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <h1 className="text-lg font-medium">
                {snapshot.gamesFolder ? "No games found yet" : "Choose your games folder"}
              </h1>
              <p className="max-w-sm text-sm text-muted-foreground">
                {snapshot.gamesFolder
                  ? `Aperto looks for unpacked NW.js games in ${snapshot.gamesFolder}.`
                  : "Aperto finds the NW.js games inside it and keeps the list up to date. Your files stay where they are."}
              </p>
            </div>
            <Button
              size="lg"
              disabled={busy || snapshot.scanning}
              onClick={() => act({ action: snapshot.gamesFolder ? "scan" : "chooseGamesFolder" })}
            >
              {snapshot.scanning ? <Spinner /> : <FolderOpenIcon />}
              {snapshot.gamesFolder ? "Scan again" : "Choose folder"}
            </Button>
          </div>
        )}

        {snapshot && game && (
          <GamePage
            key={game.id}
            game={game}
            snapshot={snapshot}
            onSettings={() => setSettingsOpen(true)}
          />
        )}
      </main>

      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-88 flex-col gap-2 *:pointer-events-auto *:bg-popover *:shadow-lg *:animate-in *:fade-in *:slide-in-from-bottom-2"
      >
        {loadError && (
          <Alert variant="destructive">
            <AlertTitle>The library is unavailable</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
            <AlertAction>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Dismiss"
                onClick={() => setError(null)}
              >
                <XIcon />
              </Button>
            </AlertAction>
          </Alert>
        )}
        {scan && dismissedScan !== scan.finishedAt && (
          <ScanSummary
            key={scan.finishedAt}
            scan={scan}
            onDismiss={() => setDismissedScan(scan.finishedAt)}
          />
        )}
      </div>

      {snapshot && (
        <Settings open={settingsOpen} onOpenChange={setSettingsOpen} snapshot={snapshot} />
      )}
    </div>
  );
}

function ScanSummary({ scan, onDismiss }: { scan: ScanReport; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Automatic scans repeat the same skipped copies, so only new games or a requested scan are shown.
  const visible = scan.added.length > 0 || scan.requested;
  useEffect(() => {
    if (!visible || expanded || hovered) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [visible, expanded, hovered, onDismiss]);
  if (!visible) return null;
  const parts = [
    scan.added.length && `Added ${scan.added.length} ${scan.added.length === 1 ? "game" : "games"}`,
    scan.duplicates.length &&
      `ignored ${scan.duplicates.length} ${scan.duplicates.length === 1 ? "duplicate" : "duplicates"}`,
    scan.problems.length && `${scan.problems.length} unreadable`,
  ].filter(Boolean);
  return (
    <Alert onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <AlertTitle>
        {parts.length
          ? parts.join(", ").replace(/^./, (letter) => letter.toUpperCase())
          : "No new games found"}
      </AlertTitle>
      {parts.length > 0 && (
        <AlertDescription>
          <button className="underline underline-offset-3" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Hide details" : "Show details"}
          </button>
          {expanded && (
            <ul className="mt-2 flex max-h-60 flex-col gap-1 overflow-y-auto text-xs">
              {scan.added.map((name, index) => (
                <li key={`added-${index}`}>Added {name}</li>
              ))}
              {scan.duplicates.map((item) => (
                <li key={item.folder} className="break-all">
                  Skipped {item.folder}, a copy of {item.of}
                </li>
              ))}
              {scan.problems.map((problem) => (
                <li key={problem} className="break-all">
                  {problem}
                </li>
              ))}
            </ul>
          )}
        </AlertDescription>
      )}
      <AlertAction>
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  );
}
