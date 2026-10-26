import { useState } from "react";
import { DownloadIcon, FolderOpenIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { compareVersions, type Release, type Snapshot } from "./model";
import { request, useTask } from "./desktop";

export function Settings({
  open,
  onOpenChange,
  snapshot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Snapshot;
}) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const { run, busy, error } = useTask();
  const installed = [...snapshot.runtimes].sort((a, b) => compareVersions(b.version, a.version));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-6 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">Games folder and NW.js runtimes</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="font-medium">Games folder</h3>
            <p className="text-muted-foreground">
              Aperto adds the NW.js games in this folder when it opens and when you come back to it.
              Copies of a game you already have are skipped. Different versions are added
              separately.
            </p>
          </div>
          {snapshot.gamesFolder ? (
            <div className="flex items-center gap-2 rounded-lg border bg-input/30 py-1 pr-1 pl-3">
              <span
                className="min-w-0 flex-1 truncate font-mono text-xs"
                title={snapshot.gamesFolder}
              >
                {snapshot.gamesFolder}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Scan now"
                title="Scan now"
                disabled={snapshot.scanning}
                onClick={() => void run(() => request({ action: "scan" }))}
              >
                {snapshot.scanning ? <Spinner /> : <RefreshCwIcon />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Stop using this folder"
                title="Stop using this folder"
                onClick={() => void run(() => request({ action: "clearGamesFolder" }))}
              >
                <XIcon />
              </Button>
            </div>
          ) : null}
          <Button
            variant="outline"
            className="self-start"
            disabled={busy || snapshot.scanning}
            onClick={() => void run(() => request({ action: "chooseGamesFolder" }))}
          >
            <FolderOpenIcon />
            {snapshot.gamesFolder ? "Change folder" : "Choose folder"}
          </Button>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h3 className="font-medium">NW.js runtimes</h3>
            <p className="text-muted-foreground">
              Official macOS ARM64 builds, verified before installing. New games use the newest one.
            </p>
          </div>
          {installed.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {installed.map((runtime) => {
                const users = snapshot.games.filter(
                  (game) => game.runtime === runtime.version,
                ).length;
                return (
                  <li
                    key={runtime.version}
                    className="flex items-center justify-between gap-3 py-1.5 pr-1.5 pl-3"
                  >
                    <span>
                      {runtime.version}
                      <span className="ml-2 text-muted-foreground">
                        {users ? `${users} ${users === 1 ? "game" : "games"}` : "unused"}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || users > 0}
                      title={users ? "Assign another runtime to its games first" : undefined}
                      onClick={() =>
                        void run(() =>
                          request({ action: "removeRuntime", version: runtime.version }),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {snapshot.downloads.map((download) => (
            <div
              key={download.version}
              className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
            >
              <Spinner />
              <span className="min-w-0 flex-1 truncate" role="status">
                {download.version} · {download.detail}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void request({ action: "cancelDownload", version: download.version }).catch(
                    () => {},
                  )
                }
              >
                Cancel
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            {releases.length ? (
              <>
                <Select
                  value={version}
                  onValueChange={(value) => setVersion(value as string | null)}
                  items={releases.map((release, index) => ({
                    value: release.version,
                    label: index === 0 ? `${release.version} (latest)` : release.version,
                  }))}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {releases.map((release, index) => (
                      <SelectItem key={release.version} value={release.version}>
                        {index === 0 ? `${release.version} (latest)` : release.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={busy || !version || installed.some((item) => item.version === version)}
                  onClick={() =>
                    version && void run(() => request({ action: "installRuntime", version }))
                  }
                >
                  <DownloadIcon />
                  Install
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const entries = await request({ action: "releases" });
                    setReleases(entries);
                    setVersion(entries[0]?.version ?? null);
                  })
                }
              >
                {busy ? <Spinner /> : <DownloadIcon />}
                {installed.length ? "Install another version" : "Install NW.js"}
              </Button>
            )}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
