import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Download04Icon,
  LinkSquare02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { request, useTask } from "../desktop";
import {
  metadataSites,
  type OwnedGame,
  type Platform,
  type Snapshot,
  type StoreSite,
  storeUser,
} from "../model";
import { Field } from "./settings";
import { SearchInput } from "./SearchInput";
import { SiteLogo } from "./logos";

const platformNames: Record<Platform, string> = {
  mac: "Mac",
  windows: "Windows",
  linux: "Linux",
  web: "Web",
};

/**
 * The itch.io account in Settings. itch.io signs in apps with an API key the user makes on its
 * API keys page; the key stays in the Keychain and only reads the account's library.
 */
export function ItchAccount({
  snapshot,
  onLibrary,
}: {
  snapshot: Snapshot;
  /** Opens the list of the account's games. */
  onLibrary: () => void;
}) {
  const [key, setKey] = useState("");
  const { run, busy, error } = useTask();

  if (snapshot.itchUser)
    return (
      <Field
        label="Account"
        hint={
          snapshot.gamesFolder
            ? "Games you download go into the games folder and are linked to their itch.io pages."
            : "Choose a games folder above to download games into."
        }
      >
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate">
            Signed in as <span className="font-medium">{snapshot.itchUser.name}</span>
          </span>
          <Button variant="outline" onClick={onLibrary}>
            <HugeiconsIcon icon={Download04Icon} />
            Your games
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => request({ action: "itchSignOut" }))}
          >
            Sign out
          </Button>
        </div>
      </Field>
    );
  return (
    <Field
      label="Account"
      htmlFor="itch-key"
      hint={
        error ?? (
          <>
            Make a key on{" "}
            <button
              type="button"
              className="inline-flex items-center gap-0.5 underline underline-offset-3 hover:text-foreground"
              onClick={() => void run(() => request({ action: "itchKeysPage" }))}
            >
              itch.io&rsquo;s API keys page
              <HugeiconsIcon icon={LinkSquare02Icon} className="size-3" />
            </button>{" "}
            with &ldquo;Generate new API key&rdquo;, then paste it here to download the games you
            own. It is kept in the Keychain.
          </>
        )
      }
    >
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await request({ action: "itchSignIn", key });
            setKey("");
          });
        }}
      >
        <Input
          id="itch-key"
          type="password"
          autoComplete="off"
          placeholder="API key"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button type="submit" disabled={busy || !key.trim()}>
          {busy && <Spinner />}
          Sign in
        </Button>
      </form>
    </Field>
  );
}

const accountHints = {
  steam: {
    signedOut: "Sign in on Steam's own page to install the games you own from here.",
    signedIn:
      "Installing asks Steam to install the game: Steam for Mac when the game has a Mac version, else the Steam in a CrossOver bottle. It joins the library when Steam finishes.",
  },
  gog: {
    signedOut: "Sign in on GOG's own page to download the games you own.",
    signedIn:
      "Games you download go into the games folder and are linked to their GOG pages. Mac installers are unpacked; Windows ones install in the default CrossOver bottle.",
  },
};

/**
 * A Steam or GOG account in Settings. Both sign in on the store's own login page, in a window
 * Aperto opens; Steam's session stays in Aperto's own cookies, GOG's token in the Keychain.
 */
export function StoreAccount({
  site,
  snapshot,
  onLibrary,
}: {
  site: "steam" | "gog";
  snapshot: Snapshot;
  /** Opens the list of the account's games. */
  onLibrary: () => void;
}) {
  const { run, busy, error } = useTask();
  const user = storeUser(snapshot, site);
  const name = metadataSites[site];
  if (user)
    return (
      <Field
        label="Account"
        hint={
          error ??
          (site === "steam" || snapshot.gamesFolder
            ? accountHints[site].signedIn
            : "Choose a games folder above to download games into.")
        }
      >
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate">
            Signed in as <span className="font-medium">{user.name}</span>
          </span>
          <Button variant="outline" onClick={onLibrary}>
            <HugeiconsIcon icon={Download04Icon} />
            Your games
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(() => request({ action: site === "steam" ? "steamSignOut" : "gogSignOut" }))
            }
          >
            Sign out
          </Button>
        </div>
      </Field>
    );
  return (
    <Field label="Account" hint={error ?? accountHints[site].signedOut}>
      <Button
        variant="outline"
        className="self-start"
        disabled={busy}
        onClick={() =>
          void run(() => request({ action: site === "steam" ? "steamSignIn" : "gogSignIn" }))
        }
      >
        {busy ? <Spinner /> : <SiteLogo site={site} />}
        Sign in to {name}
      </Button>
    </Field>
  );
}

/**
 * The games a store account owns, each downloadable into the games folder. Games already in the
 * library, matched by their link to the store, are marked.
 */
export function StoreLibrary({
  site,
  snapshot,
  onOpenChange,
}: {
  /** The store whose games show, or null when closed. */
  site: StoreSite | null;
  snapshot: Snapshot;
  onOpenChange: (open: boolean) => void;
}) {
  const open = site !== null;
  const name = site ? metadataSites[site] : "";
  // Undefined while loading.
  const [games, setGames] = useState<OwnedGame[] | undefined>();
  const [query, setQuery] = useState("");
  const { run, error } = useTask();
  const linked = new Set(snapshot.games.map((game) => site && game.links?.[site]?.id));
  const shown = (games ?? []).filter((game) =>
    game.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    if (!site) return;
    setGames(undefined);
    setQuery("");
    void run(async () => setGames(await request({ action: "ownedGames", site }))).then(
      // A failed load shows its error instead of searching forever.
      (done) => done === undefined && setGames((current) => current ?? []),
    );
  }, [site]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Your {name} games</DialogTitle>
          <DialogDescription>
            {site === "steam"
              ? "Steam installs the game, the Mac version when there is one; it joins the library when Steam finishes."
              : snapshot.gamesFolder
                ? "Downloads the Mac version when there is one, or else the Windows one, into the games folder."
                : "Choose a games folder in Settings to download games into."}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!!games?.length && (
          <SearchInput
            aria-label={`Search your ${name} games`}
            placeholder={`Search ${games.length} games`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        <div className="-mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1">
          {games === undefined && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner /> Reading your library…
            </p>
          )}
          {games?.length === 0 && !error && (
            <p className="text-muted-foreground">This account owns no games on {name} yet.</p>
          )}
          {shown.map((game) => {
            const download = snapshot.storeDownloads.find(
              (item) => item.site === game.site && item.gameId === game.gameId,
            );
            const owned = linked.has(game.page);
            return (
              <div key={game.id} className="flex items-center gap-3 rounded-lg border p-1.5">
                <span className="h-10 w-12 shrink-0 overflow-hidden rounded bg-muted">
                  {game.cover && <img src={game.cover} alt="" className="size-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{game.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {download
                      ? download.detail
                      : [game.author, ...game.platforms.map((item) => platformNames[item])]
                          .filter(Boolean)
                          .join(" · ")}
                  </span>
                </span>
                {download ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Stop downloading ${game.title}`}
                    title="Stop"
                    onClick={() =>
                      void run(() =>
                        request({
                          action: "stopStoreDownload",
                          site: game.site,
                          gameId: game.gameId,
                        }),
                      )
                    }
                  >
                    <Spinner className="group-hover/button:hidden" />
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      className="hidden group-hover/button:block"
                    />
                  </Button>
                ) : owned ? (
                  <span className="flex items-center gap-1 pr-2 text-xs text-muted-foreground">
                    <HugeiconsIcon icon={Tick02Icon} className="size-3.5" />
                    In library
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={game.site !== "steam" && !snapshot.gamesFolder}
                    onClick={() =>
                      void run(() =>
                        request({ action: "downloadOwned", site: game.site, id: game.id }),
                      )
                    }
                  >
                    <HugeiconsIcon icon={Download04Icon} />
                    {game.site === "steam" ? "Install" : "Download"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
