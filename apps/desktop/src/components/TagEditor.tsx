import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { normalizeTags, type TagColor } from "../model";
import { tagChip, TagDot } from "./tag-colors";

/**
 * Tags as a one-line multiselect. The field shows the chips that fit and a count of the rest;
 * clicking it opens a searchable list where each tag is ticked or unticked. Enter toggles the
 * highlighted tag, which is an existing library tag when one matches, so near-duplicates are easy
 * to avoid. A comma adds the text exactly as typed.
 */
export function TagEditor({
  id,
  tags,
  known,
  colors = {},
  placeholder = "Add a tag",
  disabled,
  onChange,
}: {
  id?: string;
  tags: readonly string[];
  /** Library tags, most used first. */
  known: readonly string[];
  colors?: Readonly<Record<string, TagColor>>;
  placeholder?: string;
  disabled?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  // The tags when the list opened lead it, so ticking a tag does not move it under the pointer.
  const [pinned, setPinned] = useState<readonly string[]>([]);
  // -1 means nothing is highlighted, so Enter adds the typed text as it is.
  const [active, setActive] = useState(-1);
  const query = normalizeTags(draft)[0] ?? "";
  const all = [...new Set([...pinned, ...tags, ...known])];
  const matches = all
    .filter((tag) => tag.includes(query))
    // The exact tag first, then tags that start with the text.
    .sort((a, b) => Number(b === query) - Number(a === query))
    .sort((a, b) => Number(b.startsWith(query)) - Number(a.startsWith(query)));
  // Existing tags come first so Enter picks "sandbox" for "sa"; a new tag is offered last.
  const options = query && !all.includes(query) ? [...matches, query] : matches;
  const hidden = useHiddenChips(tags);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    setDraft("");
    setActive(-1);
    if (next) setPinned(tags);
  };
  const toggle = (value: string) => {
    const [tag] = normalizeTags(value);
    setDraft("");
    setActive(-1);
    if (!tag) return;
    onChange(
      tags.includes(tag) ? tags.filter((item) => item !== tag) : normalizeTags([...tags, tag]),
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "Enter":
      case ",": {
        const choice = event.key === "Enter" ? (options[active] ?? draft) : draft;
        if (!choice.trim()) return;
        event.preventDefault();
        // A comma only adds, so typing "a, b" never removes "a".
        if (event.key === "," && tags.includes(normalizeTags(choice)[0] ?? "")) setDraft("");
        else toggle(choice);
        break;
      }
      case "ArrowDown":
      case "ArrowUp": {
        if (!options.length) return;
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const states = options.length + 1;
        setActive((current) => ((current + 1 + step + states) % states) - 1);
        break;
      }
    }
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        className="flex h-8 w-full min-w-0 items-center gap-1 rounded-lg border border-input bg-transparent py-1 pr-2 pl-1 text-left text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-popup-open:border-ring dark:bg-input/30 dark:hover:bg-input/50"
      >
        <span ref={hidden.row} className="relative flex min-w-0 flex-1 gap-1 overflow-hidden">
          {tags.length ? (
            tags.map((tag, index) => (
              <span
                key={tag}
                className={cn(
                  "inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs",
                  tagChip(colors[tag]),
                  index >= tags.length - hidden.count && "invisible",
                )}
              >
                {tag}
              </span>
            ))
          ) : (
            <span className="px-1.5 text-muted-foreground">{placeholder}</span>
          )}
        </span>
        {hidden.count > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            +{hidden.count}
          </span>
        )}
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        initialFocus={input}
        className="w-(--anchor-width) min-w-64 gap-1 p-1"
      >
        <input
          ref={input}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-label="Search or add tags"
          className="h-8 rounded-md bg-transparent px-2 outline-none placeholder:text-muted-foreground"
          placeholder={known.length ? "Search or add a tag" : placeholder}
          maxLength={40}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setActive(event.target.value.trim() ? 0 : -1);
          }}
          onKeyDown={onKeyDown}
        />
        {options.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-multiselectable
            className="-mx-1 max-h-72 overflow-y-auto border-t border-border/60 px-1 pt-1"
          >
            {options.map((tag, index) => {
              const create = !all.includes(tag);
              const on = tags.includes(tag);
              return (
                <li
                  key={`${create}-${tag}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={on}
                  data-active={index === active || undefined}
                  className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 select-none data-active:bg-accent data-active:text-accent-foreground"
                  // Keep focus in the field so typing can go on after a click.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => toggle(tag)}
                >
                  {create ? (
                    <>
                      <PlusIcon className="size-3.5 text-muted-foreground" />
                      Add &ldquo;{tag}&rdquo;
                    </>
                  ) : (
                    <>
                      <TagDot color={colors[tag]} />
                      <span className="flex-1 truncate">{tag}</span>
                      {on && <CheckIcon className="size-3.5 text-primary" />}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** How many of the trailing chips do not fit on the field's one line. */
function useHiddenChips(tags: readonly string[]) {
  const row = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(0);
  const key = tags.join("\n");
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => {
      const chips = [...element.children] as HTMLElement[];
      const fits = chips.filter(
        (chip) => chip.offsetLeft + chip.offsetWidth <= element.clientWidth,
      ).length;
      setCount(tags.length ? tags.length - fits : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [key]);
  return { row, count };
}
