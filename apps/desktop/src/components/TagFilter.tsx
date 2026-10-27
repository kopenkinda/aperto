import { useState } from "react";
import { SearchInput } from "./SearchInput";
import { CheckIcon, MinusIcon, TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Filters, TagColor } from "../model";
import { TagDot } from "./tag-colors";

/**
 * The tag filter beside the sort and filter button. Clicking a tag cycles it through showing only
 * games with it, hiding games with it, and neither.
 */
export function TagFilter({
  tags,
  colors,
  filters,
  onChange,
}: {
  /** Tags with how many games carry them, most used first. */
  tags: [tag: string, count: number][];
  colors: Readonly<Record<string, TagColor>>;
  filters: Filters;
  onChange: (filters: Filters) => void;
}) {
  const [query, setQuery] = useState("");
  const count = filters.tags.length + filters.excludedTags.length;
  const shown = tags.filter(([tag]) => tag.includes(query.trim().toLocaleLowerCase()));
  const cycle = (tag: string) => {
    const tagsWithout = filters.tags.filter((item) => item !== tag);
    const excludedWithout = filters.excludedTags.filter((item) => item !== tag);
    if (filters.tags.includes(tag))
      onChange({ ...filters, tags: tagsWithout, excludedTags: [...excludedWithout, tag] });
    else if (filters.excludedTags.includes(tag))
      onChange({ ...filters, tags: tagsWithout, excludedTags: excludedWithout });
    else onChange({ ...filters, tags: [...tagsWithout, tag], excludedTags: excludedWithout });
  };
  return (
    <Popover onOpenChange={(open) => open || setQuery("")}>
      <PopoverTrigger
        render={
          <Button
            variant={count ? "secondary" : "outline"}
            size="icon"
            className="relative shrink-0"
            aria-label={count ? `Tags, ${count} on` : "Tags"}
            title="Filter by tags"
          />
        }
      >
        <TagIcon />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground">
            {count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2">
        <SearchInput
          aria-label="Search tags"
          placeholder="Search tags"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Click once to show only games with a tag, again to hide them.
        </p>
        <ul className="-mx-1 max-h-80 overflow-y-auto">
          {shown.map(([tag, uses]) => {
            const state = filters.tags.includes(tag)
              ? "include"
              : filters.excludedTags.includes(tag)
                ? "exclude"
                : null;
            return (
              <li key={tag}>
                <button
                  type="button"
                  aria-label={`${tag}: ${state === "include" ? "only games with it" : state === "exclude" ? "hiding games with it" : "not filtered"}`}
                  className="flex w-full cursor-default items-center gap-2 rounded-md px-1 py-1 text-left select-none outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => cycle(tag)}
                >
                  <span
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-[4px] border",
                      state === "include" && "border-primary bg-primary text-primary-foreground",
                      state === "exclude" &&
                        "border-destructive bg-destructive text-destructive-foreground",
                    )}
                  >
                    {state === "include" && <CheckIcon className="size-3" />}
                    {state === "exclude" && <MinusIcon className="size-3" />}
                  </span>
                  <TagDot color={colors[tag]} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      state === "exclude" && "text-muted-foreground line-through",
                    )}
                  >
                    {tag}
                  </span>
                  <span className="text-xs text-muted-foreground">{uses}</span>
                </button>
              </li>
            );
          })}
          {!shown.length && (
            <li className="px-1 py-1 text-xs text-muted-foreground">
              {tags.length ? "No tags match." : "No tags yet. Add them on a game's page."}
            </li>
          )}
        </ul>
        {count > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...filters, tags: [], excludedTags: [] })}
          >
            Clear tag filters
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
