import { useLayoutEffect, useRef, useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import type { TagColor } from "../model";
import { tagDot } from "./tag-colors";

const chip =
  "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-background/50 px-2 text-xs whitespace-nowrap text-foreground/80 ring-1 ring-foreground/10 backdrop-blur outline-none hover:bg-background/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * A game's tags on one line. Tags that do not fit are counted in a "+N" chip whose hover card
 * lists them. The chips are measured in a hidden copy, so the line refits when the page resizes.
 */
export function TagLine({
  tags,
  colors,
  onTag,
}: {
  tags: readonly string[];
  colors: Readonly<Record<string, TagColor>>;
  onTag: (tag: string) => void;
}) {
  const line = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(tags.length);

  useLayoutEffect(() => {
    const fit = () => {
      const available = line.current?.clientWidth ?? 0;
      const chips = [...(measure.current?.children ?? [])] as HTMLElement[];
      const more = chips.pop()?.offsetWidth ?? 0;
      const gap = 6;
      let used = 0;
      let count = 0;
      for (const [index, item] of chips.entries()) {
        const width = item.offsetWidth + (index ? gap : 0);
        // The last tag fits without the "+N" chip; earlier ones must leave room for it.
        const room = index === chips.length - 1 ? available : available - more - gap;
        if (used + width > room) break;
        used += width;
        count++;
      }
      setShown(count);
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (line.current) observer.observe(line.current);
    return () => observer.disconnect();
  }, [tags, colors]);

  const button = (tag: string) => (
    <button
      key={tag}
      type="button"
      title={`Show games tagged ${tag}`}
      className={chip}
      onClick={() => onTag(tag)}
    >
      {colors[tag] && <span className={cn("size-2 rounded-full", tagDot(colors[tag]))} />}
      {tag}
    </button>
  );
  const hidden = tags.slice(shown);

  return (
    <div
      ref={line}
      className="relative mt-2 flex min-w-0 gap-1.5 overflow-hidden"
      aria-label="Tags"
    >
      {tags.slice(0, shown).map(button)}
      {hidden.length > 0 && (
        <HoverCard>
          <HoverCardTrigger
            delay={150}
            render={
              <button
                type="button"
                className={chip}
                aria-label={`${hidden.length} more tags: ${hidden.join(", ")}`}
              />
            }
          >
            +{hidden.length}
          </HoverCardTrigger>
          <HoverCardContent align="start" className="flex w-auto max-w-sm flex-wrap gap-1.5 p-2">
            {hidden.map((tag) => (
              <button
                key={tag}
                type="button"
                title={`Show games tagged ${tag}`}
                className="inline-flex h-6 items-center gap-1.5 rounded-md bg-secondary px-2 text-xs text-secondary-foreground outline-none hover:bg-secondary/70 focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() => onTag(tag)}
              >
                {colors[tag] && <span className={cn("size-2 rounded-full", tagDot(colors[tag]))} />}
                {tag}
              </button>
            ))}
          </HoverCardContent>
        </HoverCard>
      )}
      {/* The same chips, out of sight, to measure how many fit. */}
      <div
        ref={measure}
        aria-hidden
        className="invisible absolute top-0 left-0 flex gap-1.5 whitespace-nowrap"
      >
        {tags.map((tag) => (
          <span key={tag} className={chip}>
            {colors[tag] && <span className="size-2" />}
            {tag}
          </span>
        ))}
        <span className={chip}>+{tags.length}</span>
      </div>
    </div>
  );
}
