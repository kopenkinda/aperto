import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { request } from "../desktop";
import { metadataSites, type Game, type MetadataSite } from "../model";
import { SiteLogo } from "./logos";
import { MetadataDialog } from "./MetadataDialog";

/**
 * The game's links to the sites chosen in Settings, with each site's favicon in color when linked.
 * A linked site opens a card to visit, change, or unlink the page; an unlinked one opens the
 * search for it. Tags, banners, and update checks use the links.
 */
export function GameLinks({
  game,
  sites,
  blocked,
  run,
}: {
  game: Game;
  /** The sites chosen in Settings to show. */
  sites: readonly MetadataSite[];
  /** Tags that never go on a game, left out of the search's tag list. */
  blocked: readonly string[];
  run: (work: () => Promise<unknown>) => unknown;
}) {
  const [finding, setFinding] = useState<MetadataSite | null>(null);
  const [card, setCard] = useState<MetadataSite | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sites.map((site) => {
        const link = game.links?.[site];
        if (!link)
          return (
            <Button
              key={site}
              variant="outline"
              size="xs"
              className="border-dashed font-normal text-muted-foreground"
              title={`Find ${game.name} on ${metadataSites[site]}`}
              onClick={() => setFinding(site)}
            >
              <SiteLogo site={site} linked={false} />
              {metadataSites[site]}
            </Button>
          );
        return (
          <Popover
            key={site}
            open={card === site}
            onOpenChange={(open) => setCard(open ? site : null)}
          >
            <PopoverTrigger
              render={
                <Button variant="outline" size="xs" className="font-normal">
                  <SiteLogo site={site} />
                  {metadataSites[site]}
                </Button>
              }
            />
            <PopoverContent align="end" className="w-72 gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  Linked on {metadataSites[site]}
                </span>
                <span className="font-medium break-words">{link.title || `Thread ${link.id}`}</span>
                {site === "f95" && game.update && (
                  <span className="text-xs text-muted-foreground">
                    Latest version {game.update.latest}
                    {game.update.installed && `; this copy is ${game.update.installed}`}.
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setCard(null);
                    void run(() => request({ action: "openSource", id: game.id, site }));
                  }}
                >
                  <HugeiconsIcon icon={LinkSquare02Icon} />
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setCard(null);
                    setFinding(site);
                  }}
                >
                  Change
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-1 text-destructive"
                  onClick={() => {
                    setCard(null);
                    void run(() => request({ action: "unlink", id: game.id, site }));
                  }}
                >
                  Unlink
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        );
      })}
      {finding && (
        <MetadataDialog
          game={game}
          site={finding}
          blocked={blocked}
          open
          onOpenChange={(open) => !open && setFinding(null)}
        />
      )}
    </div>
  );
}
