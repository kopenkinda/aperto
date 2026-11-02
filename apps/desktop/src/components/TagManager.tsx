import { useState } from "react";
import { SearchInput } from "./SearchInput";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  MoreHorizontalIcon,
  SparklesIcon,
  UnavailableIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { request } from "../desktop";
import {
  linkedSites,
  normalizeTags,
  tagColorNames,
  tagCounts,
  type Snapshot,
  type TagColor,
} from "../model";
import { Field } from "./settings";
import { TagEditor } from "./TagEditor";
import { TagDot } from "./tag-colors";

/**
 * Settings for the library's tags: finding tags online for every game, renaming, recoloring,
 * blocking, or deleting each tag, and the blocked list, whose tags never go on a game.
 */
export function TagManager({
  snapshot,
  busy,
  run,
}: {
  snapshot: Snapshot;
  busy: boolean;
  run: (work: () => Promise<unknown>) => void;
}) {
  const tags = tagCounts(snapshot.games);
  const colors = snapshot.tagColors ?? {};
  const blocked = snapshot.blockedTags ?? [];
  // Unlinked games are looked up by title; linked ones without tags get their page's.
  const unlinked = snapshot.games.filter(
    (game) => !linkedSites(game).length || !game.tags.length,
  ).length;
  // Linked games without a banner get the one from the page they are linked to.
  const bannerless = snapshot.games.filter(
    (game) => linkedSites(game).length && !game.banner,
  ).length;
  const single = tags.filter(([, count]) => count === 1).map(([tag]) => tag);
  const [query, setQuery] = useState("");
  const [tagging, setTagging] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const names = tags.map(([tag]) => tag);
  const shown = tags.filter(([tag]) => tag.includes(query.trim().toLocaleLowerCase()));
  const block = (more: readonly string[]) =>
    run(() => request({ action: "setBlockedTags", tags: [...blocked, ...more] }));

  const linked = snapshot.games.filter((game) => linkedSites(game).length).length;
  const refill = () => {
    setTagging(true);
    setReport(null);
    request({ action: "refillTags" })
      .then(
        ({ refilled, failed }) =>
          setReport(
            [
              refilled.length
                ? `Added ${refilled.reduce((sum, item) => sum + item.added, 0)} tags back to ${refilled.length} ${refilled.length === 1 ? "game" : "games"}.`
                : "Every linked game already has its pages' tags.",
              failed.length ? `Could not read the pages of ${failed.join(", ")}.` : "",
            ].join(" "),
          ),
        (cause: unknown) => setReport(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setTagging(false));
  };

  const autoTag = () => {
    setTagging(true);
    setReport(null);
    request({ action: "autoTag" })
      .then(
        ({ tagged, unmatched, banners }) =>
          setReport(
            [
              tagged.length
                ? `Tagged ${tagged.length} ${tagged.length === 1 ? "game" : "games"}.`
                : "No new games were tagged.",
              banners.length
                ? `Added ${banners.length} ${banners.length === 1 ? "banner" : "banners"}.`
                : "",
              unmatched.length
                ? `No clear match for ${unmatched.join(", ")}. Link them on their pages.`
                : "",
            ].join(" "),
          ),
        (cause: unknown) => setReport(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setTagging(false));
  };

  return (
    <>
      <Field
        label="Find online"
        hint={
          tagging
            ? "Looking up games on F95zone, Steam, GOG, and itch.io…"
            : (report ??
              "Looks up games not yet linked on F95zone, Steam, GOG, and itch.io and adds their tags where the title matches exactly, and gives games without a banner the store's. Games without a clear match can be linked on their pages.")
        }
      >
        <Button
          variant="outline"
          className="self-start"
          disabled={tagging || (!unlinked && !bannerless)}
          onClick={autoTag}
        >
          {tagging ? <Spinner /> : <HugeiconsIcon icon={SparklesIcon} />}
          {unlinked
            ? `Find tags for ${unlinked} ${unlinked === 1 ? "game" : "games"}`
            : bannerless
              ? `Find banners for ${bannerless} ${bannerless === 1 ? "game" : "games"}`
              : "Every game is linked"}
        </Button>
        {linked > 0 && (
          <button
            type="button"
            className="self-start text-xs font-medium text-foreground/80 underline-offset-3 hover:text-foreground hover:underline disabled:opacity-50"
            disabled={tagging}
            title="Tags you removed by hand come back too, unless they are blocked."
            onClick={refill}
          >
            Re-add missing tags from the pages of {linked} linked {linked === 1 ? "game" : "games"}
          </button>
        )}
      </Field>

      <Field
        label="Blocked"
        hint="Removed from every game and never added again, by hand or from F95zone, Steam, GOG, and itch.io."
      >
        <TagEditor
          tags={blocked}
          known={tags.map(([tag]) => tag)}
          colors={colors}
          placeholder="Block a tag"
          onChange={(next) => run(() => request({ action: "setBlockedTags", tags: next }))}
        />
        {single.length > 0 && (
          <button
            type="button"
            className="self-start text-xs font-medium text-foreground/80 underline-offset-3 hover:text-foreground hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={() => block(single)}
          >
            Block the {single.length} tags only one game has
          </button>
        )}
      </Field>

      <div className="flex flex-col gap-2 px-4 py-3">
        <SearchInput
          aria-label="Search tags"
          placeholder={`Search ${tags.length} tags`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="-mx-2 max-h-72 overflow-y-auto">
          {shown.map(([tag, count]) => (
            <TagRow
              key={tag}
              tag={tag}
              count={count}
              color={colors[tag]}
              existing={names}
              onRename={(to) => run(() => request({ action: "renameTag", from: tag, to }))}
              onColor={(color) => run(() => request({ action: "setTagColor", tag, color }))}
              onBlock={() => block([tag])}
              onDelete={() => run(() => request({ action: "deleteTag", tag }))}
            />
          ))}
          {!shown.length && (
            <li className="px-2 py-1 text-muted-foreground">
              {tags.length ? "No tags match." : "No tags yet."}
            </li>
          )}
        </ul>
      </div>
    </>
  );
}

function TagRow({
  tag,
  count,
  color,
  existing,
  onRename,
  onColor,
  onBlock,
  onDelete,
}: {
  tag: string;
  count: number;
  color: TagColor | undefined;
  existing: string[];
  onRename: (to: string) => void;
  onColor: (color: TagColor | null) => void;
  onBlock: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState(tag);
  const [confirming, setConfirming] = useState(false);
  const target = normalizeTags(name)[0] ?? "";
  const merges = target !== tag && existing.includes(target);
  return (
    <li className="group/tag flex items-center gap-2.5 rounded-md px-2 py-1 hover:bg-accent/50">
      <TagDot color={color} className="size-2.5" />
      <span className="min-w-0 flex-1 truncate">{tag}</span>
      <span className="text-xs text-muted-foreground">
        {count} {count === 1 ? "game" : "games"}
      </span>
      <Popover
        open={menu}
        onOpenChange={(next) => {
          setMenu(next);
          setName(tag);
          setConfirming(false);
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Edit ${tag}`}
              title={`Rename, recolor, block, or delete ${tag}`}
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 gap-3">
          <form
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (target && target !== tag) onRename(target);
              setMenu(false);
            }}
          >
            <Input
              aria-label="Tag name"
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {merges
                ? `Press Return to merge into “${target}”.`
                : "Press Return to rename it on every game."}
            </p>
          </form>
          <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-1.5">
            {[null, ...tagColorNames].map((option) => (
              <button
                key={option ?? "none"}
                type="button"
                role="radio"
                aria-checked={(color ?? null) === option}
                aria-label={option ?? "No color"}
                title={option ?? "No color"}
                className="grid size-6 place-items-center rounded-full ring-offset-2 ring-offset-popover outline-none hover:ring-2 hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring aria-checked:ring-2 aria-checked:ring-foreground/60"
                onClick={() => onColor(option)}
              >
                <TagDot color={option ?? undefined} className="size-4" />
              </button>
            ))}
          </div>
          {confirming ? (
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setMenu(false);
                  onDelete();
                }}
              >
                Delete from {count} {count === 1 ? "game" : "games"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              <Button
                variant="ghost"
                size="sm"
                title="Remove it from every game and never add it again"
                onClick={() => {
                  setMenu(false);
                  onBlock();
                }}
              >
                <HugeiconsIcon icon={UnavailableIcon} />
                Block
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => setConfirming(true)}
              >
                <HugeiconsIcon icon={Delete02Icon} />
                Delete
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </li>
  );
}
