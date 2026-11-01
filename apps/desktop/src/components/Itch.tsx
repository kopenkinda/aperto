import { useEffect, useState } from "react";
import { CheckIcon, DownloadIcon, ExternalLinkIcon, XIcon } from "lucide-react";
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
import { type ItchGame, type ItchPlatform, type Snapshot } from "../model";
import { Field } from "./settings";
import { SearchInput } from "./SearchInput";

const platformNames: Record<ItchPlatform, string> = {
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
            <DownloadIcon />
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
              <ExternalLinkIcon className="size-3" />
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

/**
 * The games the itch.io account owns, each downloadable into the games folder. Games already in
 * the library, matched by their itch.io link, are marked.
 */
export function ItchLibrary({
  snapshot,
  open,
  onOpenChange,
}: {
  snapshot: Snapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Undefined while loading.
  const [games, setGames] = useState<ItchGame[] | undefined>();
  const [query, setQuery] = useState("");
  const { run, error } = useTask();
  const linked = new Set(snapshot.games.map((game) => game.links?.itch?.id));
  const shown = (games ?? []).filter((game) =>
    game.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    setGames(undefined);
    setQuery("");
    void run(async () => setGames(await request({ action: "itchGames" }))).then(
      // A failed load shows its error instead of searching forever.
      (done) => done === undefined && setGames((current) => current ?? []),
    );
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Your itch.io games</DialogTitle>
          <DialogDescription>
            {snapshot.gamesFolder
              ? "Downloads the Mac build when there is one, or else the Windows build, into the games folder."
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
            aria-label="Search your itch.io games"
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
            <p className="text-muted-foreground">This account owns no games on itch.io yet.</p>
          )}
          {shown.map((game) => {
            const download = snapshot.itchDownloads.find((item) => item.gameId === game.gameId);
            const owned = linked.has(game.page);
            return (
              <div key={game.keyId} className="flex items-center gap-3 rounded-lg border p-1.5">
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
                      void run(() => request({ action: "itchCancel", gameId: game.gameId }))
                    }
                  >
                    <Spinner className="group-hover/button:hidden" />
                    <XIcon className="hidden group-hover/button:block" />
                  </Button>
                ) : owned ? (
                  <span className="flex items-center gap-1 pr-2 text-xs text-muted-foreground">
                    <CheckIcon className="size-3.5" />
                    In library
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!snapshot.gamesFolder}
                    onClick={() =>
                      void run(() => request({ action: "itchDownload", keyId: game.keyId }))
                    }
                  >
                    <DownloadIcon />
                    Download
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
