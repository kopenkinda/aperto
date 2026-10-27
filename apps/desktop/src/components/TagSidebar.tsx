import { useState } from "react";
import { ChevronRightIcon, EllipsisIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { normalizeTags, tagColorNames, type TagColor } from "../model";
import { tagDot } from "./tag-colors";

/**
 * The library's tags at the top of the game list. Clicking a tag filters the list by it, and each
 * tag's menu renames, recolors, or deletes it across the library. The section stays collapsed or
 * open between launches.
 */
export function TagSidebar({
  tags,
  colors,
  selected,
  onToggle,
  onRename,
  onColor,
  onDelete,
}: {
  /** Tags with how many games carry them, most used first. */
  tags: [tag: string, count: number][];
  colors: Readonly<Record<string, TagColor>>;
  selected: readonly string[];
  onToggle: (tag: string) => void;
  onRename: (from: string, to: string) => void;
  onColor: (tag: string, color: TagColor | null) => void;
  onDelete: (tag: string) => void;
}) {
  const [open, setOpen] = useState(() => localStorage.getItem("tagsOpen") !== "false");
  if (!tags.length) return null;
  const toggleOpen = () => {
    localStorage.setItem("tagsOpen", String(!open));
    setOpen(!open);
  };
  return (
    <section aria-label="Tags" className="mb-2">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={toggleOpen}
      >
        <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        Tags
        {!open && selected.length > 0 && (
          <span className="ml-auto font-normal">{selected.length} on</span>
        )}
      </button>
      {open && (
        <ul className="mt-0.5">
          {tags.map(([tag, count]) => (
            <TagRow
              key={tag}
              tag={tag}
              count={count}
              color={colors[tag]}
              selected={selected.includes(tag)}
              existing={tags.map(([name]) => name)}
              onToggle={() => onToggle(tag)}
              onRename={(to) => onRename(tag, to)}
              onColor={(color) => onColor(tag, color)}
              onDelete={() => onDelete(tag)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TagRow({
  tag,
  count,
  color,
  selected,
  existing,
  onToggle,
  onRename,
  onColor,
  onDelete,
}: {
  tag: string;
  count: number;
  color: TagColor | undefined;
  selected: boolean;
  existing: string[];
  onToggle: () => void;
  onRename: (to: string) => void;
  onColor: (color: TagColor | null) => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState(tag);
  const [confirming, setConfirming] = useState(false);
  const target = normalizeTags(name)[0] ?? "";
  const merges = target !== tag && existing.includes(target);
  const rename = () => {
    if (target && target !== tag) onRename(target);
    setMenu(false);
  };
  return (
    <li className="group/tag relative">
      <button
        type="button"
        aria-pressed={selected}
        title={selected ? `Stop filtering by ${tag}` : `Show games tagged ${tag}`}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1 pr-8 text-left text-sm outline-none select-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground"
        onClick={onToggle}
      >
        <span className="grid size-6 shrink-0 place-items-center">
          <span className={cn("size-2.5 rounded-full", tagDot(color))} />
        </span>
        <span className="min-w-0 flex-1 truncate">{tag}</span>
        <span className="text-xs text-muted-foreground group-hover/tag:invisible group-has-[[data-popup-open]]/tag:invisible">
          {count}
        </span>
      </button>
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
              title={`Rename, recolor, or delete ${tag}`}
              className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/tag:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
            />
          }
        >
          <EllipsisIcon />
        </PopoverTrigger>
        <PopoverContent align="start" side="right" className="w-60 gap-3">
          <form
            className="flex flex-col gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              rename();
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
                className="grid size-6 place-items-center rounded-full outline-none ring-offset-2 ring-offset-popover hover:ring-2 hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring aria-checked:ring-2 aria-checked:ring-foreground/60"
                onClick={() => onColor(option)}
              >
                <span className={cn("size-4 rounded-full", tagDot(option ?? undefined))} />
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
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-destructive"
              onClick={() => setConfirming(true)}
            >
              <Trash2Icon />
              Delete tag
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </li>
  );
}
