import { HugeiconsIcon } from "@hugeicons/react";
import { FolderAddIcon } from "@hugeicons/core-free-icons";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type Snapshot, type StoreSite, shownStores, storeNames, storeUser } from "../model";
import { SiteLogo } from "./logos";
import { ItchAccount, StoreAccount, StoreGames, storeLibraryHint } from "./Stores";

const navItem =
  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium";

/**
 * Every way to add games in one place: the stores down the side, the chosen one's games, or its
 * sign-in, on the right, and a folder of games from disk at the bottom.
 */
export function AddGames({
  open,
  onOpenChange,
  site,
  onSiteChange,
  snapshot,
  onAddFolder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: StoreSite;
  onSiteChange: (site: StoreSite) => void;
  snapshot: Snapshot;
  /** Picks a folder of games on disk; the dialog closes first. */
  onAddFolder: () => void;
}) {
  const sites = shownStores(snapshot);
  const signedIn = !!storeUser(snapshot, site);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[720px] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <nav
          aria-label="Stores"
          className="flex w-48 shrink-0 flex-col gap-0.5 border-r bg-sidebar p-2 pt-4"
        >
          <DialogTitle className="px-2 pb-3 text-base">Add games</DialogTitle>
          {sites.map((item) => (
            <button
              key={item}
              type="button"
              aria-current={item === site ? "page" : undefined}
              className={navItem}
              onClick={() => onSiteChange(item)}
            >
              <SiteLogo site={item} className="size-4" />
              <span className="flex-1 truncate">{storeNames[item]}</span>
              {!storeUser(snapshot, item) && (
                <span className="text-xs font-normal text-muted-foreground">Sign in</span>
              )}
            </button>
          ))}
          <button
            type="button"
            className={`${navItem} mt-auto`}
            onClick={() => {
              onOpenChange(false);
              onAddFolder();
            }}
          >
            <HugeiconsIcon icon={FolderAddIcon} className="size-4 text-muted-foreground" />
            From a folder…
          </button>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">
              {signedIn ? `Your ${storeNames[site]} games` : storeNames[site]}
            </h2>
            <DialogDescription>
              {signedIn
                ? storeLibraryHint(site, snapshot)
                : `Sign in to ${storeNames[site]} to add the games you own.`}
            </DialogDescription>
          </div>
          {signedIn ? (
            <StoreGames site={site} snapshot={snapshot} />
          ) : site === "itch" ? (
            <ItchAccount snapshot={snapshot} onLibrary={() => {}} />
          ) : (
            <StoreAccount site={site} snapshot={snapshot} onLibrary={() => {}} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
