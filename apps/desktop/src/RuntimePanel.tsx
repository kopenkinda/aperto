import { useState } from "react";
import { DownloadIcon, HardDriveIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { Button } from "./components/ui/button";
import { compareVersions, type Release, type Snapshot } from "./model";
import { request, useTask } from "./desktop";

export function RuntimePanel({ snapshot }: { snapshot: Snapshot }) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [selected, setSelected] = useState("");
  const { run, busy, error } = useTask();
  const installed = [...snapshot.runtimes].sort((a, b) => compareVersions(b.version, a.version));
  return (
    <section className="runtime-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Shared by your games</p>
          <h1>NW.js runtimes</h1>
          <p className="muted">Install a version once, then assign it to any game.</p>
        </div>
        <HardDriveIcon size={28} />
      </header>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="panel">
        <h2>Download a runtime</h2>
        <p className="muted">
          Official macOS ARM64 releases. Aperto checks the release signature and download checksum
          before installing.
        </p>
        <div className="inline-controls">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const entries = await request({ action: "releases" });
                setReleases(entries);
                setSelected(entries[0]?.version ?? "");
              })
            }
          >
            <RefreshCwIcon />
            {busy ? "Working…" : "Check available versions"}
          </Button>
          {releases.length > 0 && (
            <>
              <select
                aria-label="Runtime version to download"
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                {releases.map((release, index) => (
                  <option key={release.version} value={release.version}>
                    {release.version}
                    {index === 0 ? " · latest stable" : ""}
                  </option>
                ))}
              </select>
              <Button
                disabled={busy || !selected || installed.some((item) => item.version === selected)}
                onClick={() =>
                  void run(() => request({ action: "installRuntime", version: selected }))
                }
              >
                <DownloadIcon />
                Install
              </Button>
            </>
          )}
        </div>
        <p className="small muted">
          Older versions are compatibility options. Installing one never changes an existing
          assignment. A new runtime is assigned only to games that have none.
        </p>
      </div>
      {snapshot.downloads.map((download) => (
        <div className="panel download" key={download.version}>
          <div>
            <strong>NW.js {download.version}</strong>
            <p role="status">{download.detail}</p>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              void request({ action: "cancelDownload", version: download.version }).catch(() => {})
            }
          >
            <XIcon />
            Cancel
          </Button>
        </div>
      ))}
      <h2 className="section-heading">
        Installed <span className="muted">{installed.length}</span>
      </h2>
      {!installed.length && (
        <div className="empty-inline">
          <HardDriveIcon />
          <p>No runtimes installed yet.</p>
          <p className="muted">You can organize your library before downloading one.</p>
        </div>
      )}
      {installed.map((runtime) => {
        const games = snapshot.games.filter((game) => game.runtime === runtime.version);
        return (
          <div className="runtime-row" key={runtime.version}>
            <div>
              <strong>NW.js {runtime.version}</strong>
              <p className="muted small">
                {games.length
                  ? games.map((game) => game.name).join(", ")
                  : "Not assigned to any games"}
              </p>
            </div>
            <Button
              variant="ghost"
              disabled={busy || games.length > 0}
              onClick={() =>
                void run(() => request({ action: "removeRuntime", version: runtime.version }))
              }
            >
              Remove
            </Button>
          </div>
        );
      })}
    </section>
  );
}
