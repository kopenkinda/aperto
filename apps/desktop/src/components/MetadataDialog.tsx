import { useEffect, useState } from "react";
import { SearchInput } from "./SearchInput";
import { CheckIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { request, useTask } from "../desktop";
import { metadataSites, searchName, titleMatches, type Game, type MetadataMatch } from "../model";

/**
 * Finds a game on F95zone and Steam and adds the tags of the match the user picks. The likeliest
 * match is chosen to begin with, and its tags start ticked unless the game already has them.
 */
export function MetadataDialog({
  game,
  blocked,
  open,
  onOpenChange,
}: {
  game: Game;
  /** Tags that never go on a game, left out of the list. */
  blocked: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState(() => searchName(game.name));
  // Undefined while searching.
  const [matches, setMatches] = useState<MetadataMatch[] | undefined>();
  const [match, setMatch] = useState<MetadataMatch | null>(null);
  const [tags, setTags] = useState<string[] | undefined>();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<string | null>(null);
  // Starts ticked only for games without a banner, so a chosen banner is not replaced by accident.
  const [useBanner, setUseBanner] = useState(false);
  const { run, busy, error, setError } = useTask();
  const added = [...chosen].filter((tag) => !game.tags.includes(tag));

  const choose = (next: MetadataMatch) => {
    setMatch(next);
    setTags(undefined);
    setBanner(null);
    setError(null);
    void request({ action: "metadataDetails", site: next.site, matchId: next.id }).then(
      (details) => {
        const found = details.tags.filter((tag) => !blocked.includes(tag));
        setBanner(details.banner ?? next.banner);
        setUseBanner(!game.banner);
        setTags(found);
        setChosen(new Set(found.filter((tag) => !game.tags.includes(tag))));
      },
      (cause: unknown) => {
        setTags([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  };
  const search = (text?: string) => {
    setMatches(undefined);
    setMatch(null);
    setTags(undefined);
    void run(async () => {
      const found = await request({
        action: "findMetadata",
        id: game.id,
        ...(text === undefined ? {} : { query: text }),
      });
      setMatches(found);
      const likely =
        found.find((item) => game.source?.site === item.site && game.source.id === item.id) ??
        found.find((item) => titleMatches(game.name, item.title));
      if (likely) choose(likely);
    });
  };

  useEffect(() => {
    if (!open) return;
    setQuery(searchName(game.name));
    search();
    // Searches once each time the dialog opens.
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] grid-cols-[minmax(0,1fr)] gap-4 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Find {game.name} online</DialogTitle>
          <DialogDescription>
            Pick the game on F95zone or Steam, then choose which of its tags to add and whether to
            use its banner.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            search(query);
          }}
        >
          <SearchInput
            aria-label="Search F95zone and Steam"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>

        <div role="radiogroup" aria-label="Matches" className="flex flex-col gap-1">
          {matches === undefined && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner /> Searching…
            </p>
          )}
          {matches?.length === 0 && (
            <p className="text-muted-foreground">
              Nothing found. Try a shorter name, or the title the game uses on F95zone or Steam.
            </p>
          )}
          {matches?.map((item) => {
            const selected = match?.site === item.site && match.id === item.id;
            return (
              <button
                key={`${item.site}-${item.id}`}
                type="button"
                role="radio"
                aria-checked={selected}
                className="flex items-center gap-3 rounded-lg border p-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 aria-checked:border-primary aria-checked:bg-primary/5"
                onClick={() => choose(item)}
              >
                <span className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted">
                  {item.cover && <img src={item.cover} alt="" className="size-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {metadataSites[item.site]}
                    {item.site === "f95" && item.detail && ` · ${item.detail}`}
                  </span>
                </span>
                {selected && <CheckIcon className="mr-1 size-4 text-primary" />}
              </button>
            );
          })}
        </div>

        {match && (
          <section className="flex flex-col gap-2">
            <h3 className="flex items-baseline justify-between text-xs font-medium text-muted-foreground">
              Tags on {metadataSites[match.site]}
              {tags && tags.length > 0 && (
                <button
                  type="button"
                  className="font-normal underline-offset-3 hover:underline"
                  onClick={() =>
                    setChosen(
                      added.length
                        ? new Set()
                        : new Set(tags.filter((tag) => !game.tags.includes(tag))),
                    )
                  }
                >
                  {added.length ? "Select none" : "Select all"}
                </button>
              )}
            </h3>
            {tags === undefined ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Spinner /> Reading tags…
              </p>
            ) : tags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const has = game.tags.includes(tag);
                  const on = has || chosen.has(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={on}
                      disabled={has}
                      title={has ? "Already on this game" : undefined}
                      className={cn(
                        "h-6 rounded-md px-2 text-xs ring-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        on
                          ? "bg-primary/15 text-foreground ring-primary/40"
                          : "text-muted-foreground ring-foreground/10 hover:text-foreground",
                        has && "opacity-60",
                      )}
                      onClick={() =>
                        setChosen((current) => {
                          const next = new Set(current);
                          if (!next.delete(tag)) next.add(tag);
                          return next;
                        })
                      }
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground">This game has no tags there.</p>
            )}
          </section>
        )}

        {match && banner && (
          <section className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Checkbox checked={useBanner} onCheckedChange={(on) => setUseBanner(!!on)} />
              {game.banner ? "Replace the banner with this one" : "Use as banner"}
            </label>
            <img
              src={banner}
              alt=""
              className={cn(
                "aspect-[3/1] w-full rounded-lg object-cover ring-1 ring-foreground/10",
                !useBanner && "opacity-40",
              )}
            />
          </section>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !match || tags === undefined}
            onClick={() =>
              match &&
              void run(async () => {
                await request({
                  action: "applyMetadata",
                  id: game.id,
                  site: match.site,
                  matchId: match.id,
                  title: match.title,
                  tags: added,
                  ...(banner && useBanner ? { banner } : {}),
                });
                onOpenChange(false);
              })
            }
          >
            {added.length
              ? `Add ${added.length} ${added.length === 1 ? "tag" : "tags"}`
              : banner && useBanner
                ? "Use banner"
                : "Link without tags"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
