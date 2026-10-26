import { useState } from "react";
import {
  FolderOpenIcon,
  ImageIcon,
  PlayIcon,
  PuzzleIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Modal } from "./components/Modal";
import { compareVersions, type Game, type PluginList, type Snapshot } from "./model";
import { request, useTask } from "./desktop";

export function GameDetails({
  game,
  snapshot,
  onClose,
  onRuntimes,
}: {
  game: Game;
  snapshot: Snapshot;
  onClose: () => void;
  onRuntimes: () => void;
}) {
  const [tab, setTab] = useState<"details" | "plugins" | "activity">("details");
  const [name, setName] = useState(game.name);
  const [tags, setTags] = useState(game.tags.join(", "));
  const [flags, setFlags] = useState(game.flags.join("\n"));
  const [runtimeOverride, setRuntimeOverride] = useState<string | undefined>();
  const [fit, setFit] = useState(game.artworkFit);
  const [plugins, setPlugins] = useState<PluginList | null>(null);
  const [pluginSearch, setPluginSearch] = useState("");
  const [confirm, setConfirm] = useState<"remove" | "restore" | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [reportedFailure, setReportedFailure] = useState(false);
  const { run, busy, error, setError } = useTask();
  const running = snapshot.running.includes(game.id);
  const missing = snapshot.missing.includes(game.id);
  const runtime = runtimeOverride ?? game.runtime ?? "";
  const launches = snapshot.launches.filter((launch) => launch.gameId === game.id);
  const latest = launches[0];
  const fallback = [...snapshot.runtimes]
    .filter((item) => game.runtime && compareVersions(item.version, game.runtime) < 0)
    .sort((a, b) => compareVersions(b.version, a.version))[0];
  const dirty =
    name !== game.name ||
    tags !== game.tags.join(", ") ||
    flags !== game.flags.join("\n") ||
    runtime !== (game.runtime ?? "") ||
    fit !== game.artworkFit;
  const downgrading = game.runtime && runtime && compareVersions(runtime, game.runtime) < 0;

  async function loadPlugins() {
    const list = await run(() => request({ action: "plugins", id: game.id }));
    if (list) setPlugins(list);
  }

  return (
    <aside className="game-details" aria-label={`${game.name} settings`}>
      <header className="detail-heading">
        <div>
          <p className="eyebrow">Game details</p>
          <h2>{game.name}</h2>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close game details" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      {game.artwork ? (
        <img
          className="detail-artwork"
          src={game.artwork}
          alt=""
          style={{ objectFit: game.artworkFit }}
        />
      ) : (
        <div className="detail-placeholder">
          <span>{game.name.slice(0, 1).toUpperCase()}</span>
        </div>
      )}
      <div className="detail-launch">
        <Button
          size="lg"
          disabled={busy || missing || (!running && (!game.runtime || dirty))}
          onClick={() =>
            void run(() => request({ action: running ? "stop" : "launch", id: game.id }))
          }
        >
          {running ? <SquareIcon /> : <PlayIcon />}
          {running ? "Stop game" : "Launch game"}
        </Button>
        <Button
          variant="outline"
          size="lg"
          aria-label="Show game folder"
          onClick={() => void run(() => request({ action: "reveal", id: game.id }))}
        >
          <FolderOpenIcon />
        </Button>
      </div>
      {!game.runtime && (
        <p className="notice">
          This game needs a runtime.{" "}
          <button className="text-link" onClick={onRuntimes}>
            Install NW.js
          </button>
        </p>
      )}
      {dirty && <p className="small muted">Save your changes before launching.</p>}
      {missing && (
        <p className="notice error">
          The game folder is missing.{" "}
          <button
            className="text-link"
            onClick={() => void run(() => request({ action: "relink", id: game.id }))}
          >
            Locate folder
          </button>
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {(latest?.outcome === "failed" || reportedFailure) && !running && (
        <div className="notice">
          <strong>Having trouble launching?</strong>
          <p className="small">
            {latest?.outcome === "failed"
              ? latest.detail
              : "A running process does not always mean the game loaded correctly."}{" "}
            Check Activity for details. A missing file or plugin may need attention before trying
            another runtime.
          </p>
          {fallback ? (
            <Button
              variant="outline"
              disabled={busy || dirty}
              onClick={() => {
                setRuntimeOverride(fallback.version);
                setTab("details");
              }}
            >
              Review NW.js {fallback.version}
            </Button>
          ) : (
            <Button variant="outline" onClick={onRuntimes}>
              Find an older runtime
            </Button>
          )}
        </div>
      )}
      <nav className="detail-tabs" aria-label="Game settings sections">
        {(["details", "plugins", "activity"] as const).map((item) => (
          <button
            key={item}
            aria-current={tab === item ? "page" : undefined}
            onClick={() => {
              setTab(item);
              setError(null);
              if (item === "plugins") void loadPlugins();
            }}
          >
            {item === "details" ? "Settings" : item === "plugins" ? "Plugins" : "Activity"}
          </button>
        ))}
      </nav>
      {tab === "details" && (
        <form
          className="detail-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await request({
                action: "update",
                id: game.id,
                name,
                tags,
                fit,
                runtime: runtime || null,
                flags,
              });
              setRuntimeOverride(undefined);
              setTags(
                tags
                  .split(",")
                  .map((tag) => tag.trim().toLowerCase())
                  .filter(Boolean)
                  .filter((tag, index, all) => all.indexOf(tag) === index)
                  .join(", "),
              );
              setName(name.trim());
              setFlags(
                flags
                  .split("\n")
                  .map((flag) => flag.trim())
                  .filter(Boolean)
                  .join("\n"),
              );
            });
          }}
        >
          <label>
            Display name
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Tags
            <input
              value={tags}
              placeholder="Adventure, unfinished"
              onChange={(event) => setTags(event.target.value)}
            />
            <span className="field-help">Separate tags with commas.</span>
          </label>
          <div className="inline-controls">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => request({ action: "artwork", id: game.id }))}
            >
              <ImageIcon />
              Change artwork
            </Button>
            <select
              aria-label="Artwork fit"
              value={fit}
              onChange={(event) => setFit(event.target.value as "cover" | "contain")}
            >
              <option value="cover">Fill frame</option>
              <option value="contain">Fit image</option>
            </select>
          </div>
          <label>
            NW.js runtime
            <select
              value={runtime}
              disabled={running}
              onChange={(event) => setRuntimeOverride(event.target.value)}
            >
              <option value="">Not assigned</option>
              {[...snapshot.runtimes]
                .sort((a, b) => compareVersions(b.version, a.version))
                .map((item) => (
                  <option key={item.version} value={item.version}>
                    {item.version}
                  </option>
                ))}
            </select>
          </label>
          {downgrading && (
            <p className="notice small">
              Saving will assign an older runtime. Aperto will first back up this game's browser
              data. Existing saves may still be incompatible with the older runtime.
            </p>
          )}
          <details>
            <summary>Launch profile</summary>
            <p className="small muted">
              Normal graphics settings are used by default. Add one switch per line. Removing a line
              removes Aperto's override; flags supplied by the game itself remain.
            </p>
            <label>
              Additional flags
              <textarea
                value={flags}
                rows={4}
                placeholder="--disable-gpu"
                spellCheck={false}
                onChange={(event) => setFlags(event.target.value)}
              />
            </label>
          </details>
          <Button type="submit" disabled={busy || running || !dirty}>
            {busy ? "Saving…" : downgrading ? "Back up data and assign runtime" : "Save changes"}
          </Button>
          <div className="folder-reference">
            <span className="small muted">Referenced folder</span>
            <p>{game.folder}</p>
          </div>
          <div className="detail-danger">
            <Button
              type="button"
              variant="ghost"
              disabled={busy || running}
              onClick={() => setConfirm("remove")}
            >
              Remove from library
            </Button>
            <button
              type="button"
              className="text-link small"
              onClick={() => {
                setReportedFailure(true);
                setTab("activity");
              }}
            >
              The game didn't work
            </button>
          </div>
        </form>
      )}
      {tab === "plugins" && (
        <section className="plugin-section">
          <div className="section-heading inline-controls">
            <h3>Included plugins</h3>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void loadPlugins()}>
              <RotateCcwIcon />
              Refresh
            </Button>
          </div>
          <p className="small muted">
            Changes apply on the next launch, including launches outside Aperto. Plugin order and
            parameters stay unchanged. Disabling a required plugin may affect saves or prevent the
            game from working.
          </p>
          {running && <p className="notice small">Close the game before editing plugins.</p>}
          {plugins?.conflict && (
            <p className="notice error">
              The configuration was changed outside Aperto. Editing and restoration are paused to
              protect those changes. Your original backup is retained in Aperto's data folder.
            </p>
          )}
          {plugins && (
            <>
              <input
                aria-label="Search plugins"
                placeholder="Find a plugin…"
                value={pluginSearch}
                onChange={(event) => setPluginSearch(event.target.value)}
              />
              <div className="plugin-list">
                {plugins.plugins
                  .map((plugin, index) => ({ plugin, index }))
                  .filter(({ plugin }) =>
                    `${plugin.name} ${plugin.description}`
                      .toLowerCase()
                      .includes(pluginSearch.toLowerCase()),
                  )
                  .map(({ plugin, index }) => (
                    <label className="plugin-row" key={`${index}-${plugin.name}`}>
                      <div>
                        <strong>{plugin.name || "Unnamed entry"}</strong>
                        <p className="small muted">{plugin.description || "No description"}</p>
                        {plugin.missing && (
                          <span className="small warning">Plugin file is missing</span>
                        )}
                      </div>
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={`Enable ${plugin.name || "unnamed plugin"}`}
                        checked={plugin.enabled}
                        disabled={
                          busy ||
                          running ||
                          plugins.conflict ||
                          !plugin.name ||
                          (plugin.missing && !plugin.enabled)
                        }
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          void run(async () =>
                            setPlugins(
                              await request({
                                action: "togglePlugin",
                                id: game.id,
                                hash: plugins.hash,
                                index,
                                enabled,
                              }),
                            ),
                          );
                        }}
                      />
                    </label>
                  ))}
              </div>
              {!plugins.plugins.length && (
                <p className="empty-inline">
                  <PuzzleIcon />
                  No plugins are registered in this game.
                </p>
              )}
              <Button
                variant="outline"
                disabled={busy || running || !plugins.canRestore}
                onClick={() => setConfirm("restore")}
              >
                <RotateCcwIcon />
                Restore original configuration
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(() => request({ action: "revealPluginBackup", id: game.id }))
                }
              >
                Show backup in Finder
              </Button>
            </>
          )}
          {!plugins && !busy && !error && (
            <p className="muted">Open this section to inspect MV/MZ plugins.</p>
          )}
        </section>
      )}
      {tab === "activity" && (
        <section className="activity-section">
          <h3>Recent launches</h3>
          {!launches.length && <p className="muted">No launches recorded yet.</p>}
          {launches.map((launch) => (
            <details key={launch.id} className="launch-record">
              <summary>
                <span>
                  {launch.outcome === "running"
                    ? "Running process"
                    : launch.outcome === "ended"
                      ? "Session ended"
                      : launch.outcome === "stopped"
                        ? "Stopped"
                        : launch.outcome === "interrupted"
                          ? "Tracking interrupted"
                          : "Launch problem"}
                </span>
                <time>{new Date(launch.startedAt).toLocaleString()}</time>
              </summary>
              <p className="small">
                NW.js {launch.runtime} · {launch.detail || "Waiting for the process to exit."}
              </p>
              <p className="small muted">Launch arguments</p>
              <pre>{launch.flags.join("\n")}</pre>
              <p className="small muted">Process output</p>
              <pre>{launch.log || "No process output captured."}</pre>
            </details>
          ))}
        </section>
      )}
      {confirm && (
        <Modal
          className="confirmation"
          label={confirm === "remove" ? "Remove game" : "Restore plugins"}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <h3>{confirm === "remove" ? `Remove ${game.name}?` : "Restore original plugins?"}</h3>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <p>
            {confirm === "remove"
              ? "The original game folder and its saves stay where they are. Plugin settings and backups are retained."
              : "This restores the plugin configuration from before Aperto first changed it."}
          </p>
          {confirm === "remove" && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={deleteData}
                onChange={(event) => setDeleteData(event.target.checked)}
              />
              Also permanently delete browser data and its backups. This can include saves.
            </label>
          )}
          <div className="inline-controls">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (confirm === "remove") {
                    await request({ action: "remove", id: game.id, deleteData });
                    onClose();
                  } else if (plugins)
                    setPlugins(
                      await request({ action: "restorePlugins", id: game.id, hash: plugins.hash }),
                    );
                  setConfirm(null);
                })
              }
            >
              {confirm === "remove" ? "Remove game" : "Restore original"}
            </Button>
          </div>
        </Modal>
      )}
    </aside>
  );
}
