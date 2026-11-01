import { Fragment, useEffect, useState, type ReactNode } from "react";
import { SearchInput } from "@/components/SearchInput";
import {
  ArrowUpCircleIcon,
  ArrowUpDownIcon,
  CheckIcon,
  FolderOpenIcon,
  ListFilterIcon,
  PlusIcon,
  RefreshCwIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { ApertoMark } from "@/components/ApertoMark";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { TagFilter } from "@/components/TagFilter";
import { TagDot } from "@/components/tag-colors";
import { GamePage, playable } from "./GamePage";
import { Settings } from "./Settings";
import { request, useTask } from "./desktop";
import {
  filterCount,
  kindFilters,
  matchesGame,
  noFilters,
  defaultSort,
  sortDirections,
  sortGames,
  sortOrders,
  statusFilters,
  formatSize,
  tagCounts,
  updateAvailable,
  type Command,
  type Filters,
  type Game,
  type GameKind,
  type GameStatus,
  type ScanReport,
  type Sort,
  type SortOrder,
  type Snapshot,
} from "./model";

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(noFilters);
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

  const [sort, setSort] = useState<Sort>(() => {
    const order = localStorage.getItem("sort");
    return order && order in sortOrders
      ? { order: order as SortOrder, reversed: localStorage.getItem("sortReversed") === "true" }
      : defaultSort;
  });
  const changeSort = (next: Sort) => {
    setSort(next);
    localStorage.setItem("sort", next.order);
    localStorage.setItem("sortReversed", String(next.reversed));
  };
  // Favorites lead the list, so the first game shown is also the first one opened.
  const games = sortGames(snapshot?.games ?? [], sort, snapshot?.launches ?? []);
  const libraryTags = tagCounts(games);
  const [librarySize, setLibrarySize] = useState<number | null>(null);
  // Measured again whenever a game's folder changes, which adding or removing one does too.
  const folders = games
    .map((game) => game.folder)
    .sort()
    .join("\n");
  useEffect(() => {
    if (!folders) return setLibrarySize(null);
    let active = true;
    request({ action: "librarySize" }).then(
      (bytes) => active && setLibrarySize(bytes),
      () => active && setLibrarySize(null),
    );
    return () => {
      active = false;
    };
  }, [folders]);
  // A chosen tag stays listed after its last game loses it, so it can still be turned off.
  for (const tag of [...filters.tags, ...filters.excludedTags])
    if (!libraryTags.some(([name]) => name === tag)) libraryTags.push([tag, 0]);
  const visible = snapshot
    ? games.filter((game) => matchesGame(game, filters, search, snapshot))
    : [];
  const filtering = activeFilters(filters).length > 0;
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
          <div className="flex gap-1.5">
            <SearchInput
              className="flex-1"
              aria-label="Search games"
              placeholder="Search"
              title={'Search names, or tags with tag:horror or tag:"rpg maker"'}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <TagFilter
              tags={libraryTags}
              colors={snapshot?.tagColors ?? {}}
              filters={filters}
              onChange={setFilters}
            />
            <LibraryFilters
              filters={filters}
              onChange={setFilters}
              sort={sort}
              onSort={changeSort}
            />
          </div>
          {filtering && (
            <ul aria-label="Active filters" className="mt-2 flex flex-wrap gap-1">
              {activeFilters(filters).map(({ key, label, tag, without }) => (
                <li key={key}>
                  <button
                    type="button"
                    aria-label={`Remove filter: ${label}`}
                    title={`Remove filter: ${label}`}
                    className="inline-flex h-6 items-center gap-1 rounded-md bg-secondary pr-1 pl-2 text-xs text-secondary-foreground outline-none hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => setFilters(without)}
                  >
                    {tag && <TagDot color={snapshot?.tagColors?.[tag]} />}
                    {label}
                    <XIcon className="size-3 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <nav aria-label="Games" className="flex-1 overflow-y-auto px-2 pb-2">
          {visible.map((item, index) => {
            const running = snapshot?.running.includes(item.id);
            const missing = snapshot?.missing.includes(item.id);
            // Headings appear only when favorites and other games are both listed.
            const heading =
              item.favorite && index === 0 && visible.some((other) => !other.favorite)
                ? "Favorites"
                : !item.favorite && visible[index - 1]?.favorite
                  ? "Games"
                  : null;
            return (
              <Fragment key={item.id}>
                {heading && (
                  <h2 className="flex justify-between px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground first:pt-0">
                    {heading}
                    <span className="font-normal tabular-nums">
                      {visible.filter((other) => !other.favorite === !item.favorite).length}
                    </span>
                  </h2>
                )}
                <button
                  aria-current={item.id === game?.id ? "true" : undefined}
                  title={`${item.name}\nDouble-click to ${running ? "stop" : "play"}`}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm outline-none select-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 aria-current:bg-sidebar-accent aria-current:text-sidebar-accent-foreground",
                    missing && "text-muted-foreground",
                  )}
                  onClick={() => setSelected(item.id)}
                  onDoubleClick={() => (running || playable(item, snapshot!)) && toggle(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (running || playable(item, snapshot!))) {
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
                  {updateAvailable(item) && (
                    <ArrowUpCircleIcon
                      className="size-3.5 shrink-0 text-blue-500"
                      aria-label={`Update available: ${item.update!.latest}`}
                    />
                  )}
                  {running && (
                    <span
                      className="size-2 shrink-0 rounded-full bg-emerald-500"
                      aria-label="Running"
                    />
                  )}
                </button>
              </Fragment>
            );
          })}
          {games.length > 0 && !visible.length && (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-sm text-muted-foreground">
              No matches
              {filtering && (
                <Button variant="outline" size="xs" onClick={() => setFilters(noFilters)}>
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </nav>
        <footer className="flex items-center gap-1 border-t px-2 py-2">
          <span className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <ApertoMark className="size-4" />
            <span className="flex flex-col">
              {games.length} {games.length === 1 ? "game" : "games"}
              {snapshot?.checkingUpdates ? (
                <span className="text-[10px] leading-tight text-muted-foreground/70 tabular-nums">
                  Checking updates {snapshot.checkingUpdates.checked + 1} of{" "}
                  {snapshot.checkingUpdates.total}
                </span>
              ) : (
                librarySize !== null && (
                  <span
                    className="text-[10px] leading-tight text-muted-foreground/70 tabular-nums"
                    title="Space the games' folders take on disk"
                  >
                    {formatSize(librarySize)}
                  </span>
                )
              )}
            </span>
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
                  ? `Aperto looks for NW.js, Mac, and Windows games in ${snapshot.gamesFolder}.`
                  : "Aperto finds the NW.js, Mac, and Windows games inside it and keeps the list up to date. Your files stay where they are."}
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
            onTag={(tag) => {
              setSearch("");
              setFilters({ ...noFilters, tags: [tag] });
            }}
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
  const visible = scan.added.length > 0 || scan.removed.length > 0 || scan.requested;
  useEffect(() => {
    if (!visible || expanded || hovered) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [visible, expanded, hovered, onDismiss]);
  if (!visible) return null;
  const parts = [
    scan.added.length && `Added ${scan.added.length} ${scan.added.length === 1 ? "game" : "games"}`,
    scan.removed.length &&
      `removed ${scan.removed.length} missing ${scan.removed.length === 1 ? "game" : "games"}`,
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
              {scan.removed.map((name, index) => (
                <li key={`removed-${index}`}>Removed {name}, whose folder is gone</li>
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

const without = <T,>(list: readonly T[], value: T) => list.filter((item) => item !== value);
const toggled = <T,>(list: readonly T[], value: T) =>
  list.includes(value) ? without(list, value) : [...list, value];

function activeFilters(filters: Filters) {
  return [
    ...filters.tags.map((tag) => ({
      key: `tag:${tag}`,
      label: tag,
      tag,
      without: { ...filters, tags: without(filters.tags, tag) },
    })),
    ...filters.excludedTags.map((tag) => ({
      key: `not:${tag}`,
      label: `not ${tag}`,
      tag,
      without: { ...filters, excludedTags: without(filters.excludedTags, tag) },
    })),
    ...filters.kinds.map((kind) => ({
      key: `kind:${kind}`,
      label: kindFilters[kind],
      tag: null,
      without: { ...filters, kinds: without(filters.kinds, kind) },
    })),
    ...filters.statuses.map((status) => ({
      key: `status:${status}`,
      label: statusFilters[status],
      tag: null,
      without: { ...filters, statuses: without(filters.statuses, status) },
    })),
  ];
}

function LibraryFilters({
  filters,
  onChange,
  sort,
  onSort,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
}) {
  const count = filterCount(filters);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={count ? "secondary" : "outline"}
            size="icon"
            className="relative shrink-0"
            aria-label={count ? `Sort and filter, ${count} filters on` : "Sort and filter"}
            title="Sort and filter"
          />
        }
      >
        <ListFilterIcon />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground">
            {count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-3">
        <FilterSection title="Sort by">
          <div role="radiogroup" aria-label="Sort by" className="-mx-1">
            {(Object.keys(sortOrders) as SortOrder[]).map((order) => (
              <button
                key={order}
                type="button"
                role="radio"
                aria-checked={sort.order === order}
                title={sort.order === order ? "Click again to reverse" : undefined}
                className="flex w-full cursor-default items-center gap-2 rounded-md px-1 py-1 text-left outline-none select-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                // Choosing the current order again reverses it; another order starts in its default direction.
                onClick={() => onSort({ order, reversed: sort.order === order && !sort.reversed })}
              >
                <CheckIcon
                  className={cn("size-4 text-primary", sort.order !== order && "invisible")}
                />
                <span className="flex-1">{sortOrders[order]}</span>
                {sort.order === order && (
                  <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                    {sortDirections[order][Number(sort.reversed)]}
                    <ArrowUpDownIcon className="size-3" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </FilterSection>
        <FilterSection title="Type">
          <div className="-mx-1">
            {(Object.keys(kindFilters) as GameKind[]).map((kind) => (
              <FilterOption
                key={kind}
                label={kindFilters[kind]}
                checked={filters.kinds.includes(kind)}
                onToggle={() => onChange({ ...filters, kinds: toggled(filters.kinds, kind) })}
              />
            ))}
          </div>
        </FilterSection>
        <FilterSection title="Status">
          <div className="-mx-1">
            {(Object.keys(statusFilters) as GameStatus[]).map((status) => (
              <FilterOption
                key={status}
                label={statusFilters[status]}
                checked={filters.statuses.includes(status)}
                onToggle={() =>
                  onChange({ ...filters, statuses: toggled(filters.statuses, status) })
                }
              />
            ))}
          </div>
        </FilterSection>
        {count > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange(noFilters)}>
            Clear filters
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function FilterOption({
  label,
  count,
  checked,
  onToggle,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-default items-center gap-2 rounded-md px-1 py-1 select-none hover:bg-accent">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-xs text-muted-foreground">{count}</span>}
    </label>
  );
}
