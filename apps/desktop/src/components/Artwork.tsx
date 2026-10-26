import { cn } from "@/lib/utils";
import type { Game } from "@/model";

/**
 * Game artwork at any aspect ratio. Most NW.js games only ship a small square icon, so the image
 * is shown whole over a blurred copy of itself instead of being cropped or stretched.
 */
export function Artwork({ game, className }: { game: Game; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      {game.artwork ? (
        <>
          <img
            src={game.artwork}
            alt=""
            className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-2xl"
          />
          <img
            src={game.artwork}
            alt=""
            className="absolute inset-0 size-full object-contain p-[8%] drop-shadow-lg"
          />
        </>
      ) : (
        <span className="absolute inset-0 grid place-items-center text-4xl font-semibold text-muted-foreground/60">
          {game.name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </div>
  );
}
