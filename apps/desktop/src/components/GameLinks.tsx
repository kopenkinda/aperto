import { useState } from "react";
import { ExternalLinkIcon, Link2Icon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { request } from "../desktop";
import { metadataSites, type Game, type MetadataSite } from "../model";
import { MetadataDialog } from "./MetadataDialog";

/**
 * The game's F95zone, Steam, and itch.io links. A linked site opens a card to visit, change, or unlink the
 * page; an unlinked one opens the search for it. Tags, banners, and update checks use the links.
 */
export function GameLinks({
  game,
  blocked,
  run,
}: {
  game: Game;
  /** Tags that never go on a game, left out of the search's tag list. */
  blocked: readonly string[];
  run: (work: () => Promise<unknown>) => unknown;
}) {
  const [finding, setFinding] = useState<MetadataSite | null>(null);
  const [card, setCard] = useState<MetadataSite | null>(null);
  const sites = Object.keys(metadataSites) as MetadataSite[];

  return (
    <div className="flex items-center gap-1">
      {sites.map((site) => {
        const link = game.links?.[site];
        if (!link)
          return (
            <Button
              key={site}
              variant="ghost"
              size="xs"
              className="font-normal text-muted-foreground"
              title={`Find ${game.name} on ${metadataSites[site]}`}
              onClick={() => setFinding(site)}
            >
              <PlusIcon />
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
                  <Link2Icon />
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
                  <ExternalLinkIcon />
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
