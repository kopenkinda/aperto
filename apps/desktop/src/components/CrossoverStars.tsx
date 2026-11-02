import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StarIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { request } from "../desktop";
import type { CrossoverRating } from "../model";

/**
 * How well CrossOver runs a game, as CodeWeavers rates it, in five stars that open the rating's
 * page. Nothing shows while it loads, when CodeWeavers has not rated the game, or when the lookup
 * fails.
 */
export function CrossoverStars({ name, className }: { name: string; className?: string }) {
  const [rating, setRating] = useState<CrossoverRating | null>(null);
  useEffect(() => {
    setRating(null);
    let active = true;
    request({ action: "crossoverRating", name }).then(
      (found) => active && setRating(found),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [name]);
  if (!rating) return null;
  return (
    <button
      type="button"
      className={cn(
        "flex shrink-0 items-center rounded-sm text-amber-400 outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      aria-label={`Rated ${rating.stars} of 5 for CrossOver on CodeWeavers`}
      title={`CodeWeavers rates ${rating.title} ${rating.stars} of 5 in CrossOver on Mac.\nClick to open its page.`}
      onClick={() => void request({ action: "openCrossoverRating", name }).catch(() => {})}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <HugeiconsIcon
          key={star}
          icon={StarIcon}
          className={cn(
            "size-3",
            star <= rating.stars ? "fill-current" : "text-muted-foreground/50",
          )}
        />
      ))}
    </button>
  );
}
