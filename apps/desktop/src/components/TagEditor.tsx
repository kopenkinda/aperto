import { useId, useState, type KeyboardEvent } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeTags, type TagColor } from "../model";
import { tagChip, TagDot } from "./tag-colors";

/**
 * Tags as removable chips with an inline field. Enter adds the highlighted suggestion, which is an
 * existing library tag when one matches, so near-duplicates are easy to avoid. A comma adds the
 * text exactly as typed.
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
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  // -1 means nothing is highlighted, so Enter adds the typed text as it is.
  const [active, setActive] = useState(-1);
  const query = normalizeTags(draft)[0] ?? "";
  const matches = known
    .filter((tag) => !tags.includes(tag) && tag.includes(query))
    // The exact tag first, then tags that start with the text.
    .sort((a, b) => Number(b === query) - Number(a === query))
    .sort((a, b) => Number(b.startsWith(query)) - Number(a.startsWith(query)))
    .slice(0, 8);
  // Existing tags come first so Enter picks "sandbox" for "sa"; a new tag is offered last.
  const options =
    query && !known.includes(query) && !tags.includes(query) ? [...matches, query] : matches;
  const showList = open && options.length > 0;

  const type = (value: string) => {
    setDraft(value);
    setOpen(true);
    setActive(value.trim() ? 0 : -1);
  };
  const add = (value: string) => {
    const next = normalizeTags([...tags, value]);
    setDraft("");
    setActive(-1);
    if (next.length !== tags.length) onChange(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "Enter":
      case ",": {
        const choice = event.key === "Enter" ? (options[active] ?? draft) : draft;
        if (!choice.trim()) return;
        event.preventDefault();
        add(choice);
        break;
      }
      case "Tab":
        if (!draft.trim() || !showList) return;
        event.preventDefault();
        add(options[Math.max(active, 0)]!);
        break;
      case "Backspace":
        if (!draft && tags.length) onChange(tags.slice(0, -1));
        break;
      case "ArrowDown":
      case "ArrowUp": {
        if (!options.length) return;
        event.preventDefault();
        setOpen(true);
        const step = event.key === "ArrowDown" ? 1 : -1;
        const states = options.length + 1;
        setActive((current) => ((current + 1 + step + states) % states) - 1);
        break;
      }
      case "Escape":
        if (!showList) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setActive(-1);
        break;
    }
  };

  return (
    <div className="relative">
      <div
        className={cn(
          "flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          disabled && "pointer-events-none opacity-50",
        )}
        onMouseDown={(event) => {
          // Clicking the empty part of the box focuses the field, like a normal input.
          if (event.target === event.currentTarget) {
            event.preventDefault();
            event.currentTarget.querySelector("input")?.focus();
          }
        }}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className={cn(
              "inline-flex h-6 items-center gap-0.5 rounded-md pr-0.5 pl-2 text-xs",
              tagChip(colors[tag]),
            )}
          >
            {tag}
            <button
              type="button"
              className="grid size-5 place-items-center rounded text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={`Remove ${tag}`}
              disabled={disabled}
              onClick={() => onChange(tags.filter((item) => item !== tag))}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
          placeholder={tags.length ? "" : placeholder}
          maxLength={40}
          value={draft}
          disabled={disabled}
          onChange={(event) => type(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
            if (draft.trim()) add(draft);
          }}
        />
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {options.map((tag, index) => {
            const create = tag === query && !known.includes(tag);
            return (
              <li
                key={`${create}-${tag}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 select-none aria-selected:bg-accent aria-selected:text-accent-foreground"
                // Keep focus in the field so the click does not count as leaving it.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => add(tag)}
              >
                {create ? (
                  <>
                    <PlusIcon className="size-3.5 text-muted-foreground" />
                    Add &ldquo;{tag}&rdquo;
                  </>
                ) : (
                  <>
                    <TagDot color={colors[tag]} />
                    {tag}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
