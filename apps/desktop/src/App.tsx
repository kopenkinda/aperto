import { useEffect, useState } from "react";
import {
  FolderPlusIcon,
  Gamepad2Icon,
  HardDriveIcon,
  LayoutGridIcon,
  LibraryIcon,
  ListIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Modal } from "./components/Modal";
import { GameDetails } from "./GameDetails";
import { RuntimePanel } from "./RuntimePanel";
import { request, useTask } from "./desktop";
import type { ImportReview, Snapshot } from "./model";
import appIcon from "../resources/icon.svg";

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState<"library" | "runtimes">("library");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState("name");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [review, setReview] = useState<ImportReview | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [importName, setImportName] = useState("");
  const [importTags, setImportTags] = useState("");
  const { run, busy, error, setError } = useTask();

  useEffect(() => {
    let active = true;
    let sequence = 0;
    const refresh = () => {
      const current = ++sequence;
      void request({ action: "snapshot" })
        .then((state) => {
          if (active && current === sequence) {
            setSnapshot(state);
            setLoadError(null);
          }
        })
        .catch((cause: unknown) => {
          if (active) setLoadError(cause instanceof Error ? cause.message : String(cause));
        });
    };
    refresh();
    const unsubscribe = window.desktop?.onChange(refresh);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const games = snapshot?.games ?? [];
  const allTags = [...new Set(games.flatMap((game) => game.tags))].sort();
  const visible = games
    .filter(
      (game) =>
        (!tag || game.tags.includes(tag)) &&
        `${game.name} ${game.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "recent"
        ? (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? "")
        : sort === "added"
          ? b.addedAt.localeCompare(a.addedAt)
          : a.name.localeCompare(b.name),
    );
  const game = games.find((item) => item.id === selected);
  const candidate = review?.candidates[candidateIndex];
  const addGame = () =>
    void run(async () => {
      const result = await request({ action: "chooseImport" });
      if (result) {
        setReview(result);
        setCandidateIndex(0);
        setImportName(result.candidates[0]?.name ?? "");
        setImportTags("");
      }
    });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={appIcon} alt="" />
          Aperto
        </div>
        <p className="eyebrow sidebar-label">Your collection</p>
        <nav aria-label="Main navigation">
          <button className={page === "library" ? "active" : ""} onClick={() => setPage("library")}>
            <LibraryIcon size={18} />
            Library<span className="nav-count">{games.length}</span>
          </button>
          <button
            className={page === "runtimes" ? "active" : ""}
            onClick={() => {
              setPage("runtimes");
              setSelected(null);
            }}
          >
            <HardDriveIcon size={18} />
            Runtimes
          </button>
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          Local library<p>Your games stay in their folders.</p>
        </div>
      </aside>
      <main className="workspace">
        <div className="topbar">
          <span>{page === "library" ? "Library" : "Runtimes"}</span>
          <span className="small muted">Aperto for macOS</span>
        </div>
        {loadError && (
          <div role="alert" className="notice error load-error">
            <strong>The library is unavailable</strong>
            <p>{loadError}</p>
            <Button
              variant="outline"
              onClick={() =>
                void request({ action: "snapshot" })
                  .then((state) => {
                    setSnapshot(state);
                    setLoadError(null);
                  })
                  .catch((cause: unknown) =>
                    setLoadError(cause instanceof Error ? cause.message : String(cause)),
                  )
              }
            >
              Retry
            </Button>
          </div>
        )}
        {!snapshot && !loadError && (
          <p className="loading" role="status">
            Opening your library…
          </p>
        )}
        {snapshot && page === "runtimes" && <RuntimePanel snapshot={snapshot} />}
        {snapshot && page === "library" && (
          <div className="library-page">
            <header className="page-heading">
              <div>
                <p className="eyebrow">All in one place</p>
                <h1>Your library</h1>
                <p className="muted">
                  {games.length
                    ? `${games.length} ${games.length === 1 ? "game" : "games"}, ready when you are.`
                    : "A home for your local NW.js games."}
                </p>
              </div>
              <Button size="lg" onClick={addGame} disabled={busy}>
                <FolderPlusIcon />
                Add game
              </Button>
            </header>
            {error && !review && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            {games.length > 0 && (
              <div className="library-toolbar">
                <label className="search">
                  <SearchIcon size={17} />
                  <input
                    aria-label="Search library"
                    placeholder="Search games or tags…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter by tag"
                  value={tag}
                  onChange={(event) => setTag(event.target.value)}
                >
                  <option value="">All tags</option>
                  {allTags.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
                <select
                  aria-label="Sort games"
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="name">Name</option>
                  <option value="recent">Last played</option>
                  <option value="added">Recently added</option>
                </select>
                <div className="layout-picker">
                  <Button
                    variant={layout === "grid" ? "secondary" : "ghost"}
                    size="icon"
                    aria-label="Grid layout"
                    aria-pressed={layout === "grid"}
                    onClick={() => setLayout("grid")}
                  >
                    <LayoutGridIcon />
                  </Button>
                  <Button
                    variant={layout === "list" ? "secondary" : "ghost"}
                    size="icon"
                    aria-label="List layout"
                    aria-pressed={layout === "list"}
                    onClick={() => setLayout("list")}
                  >
                    <ListIcon />
                  </Button>
                </div>
              </div>
            )}
            {!games.length ? (
              <div className="empty-library">
                <div className="empty-art">
                  <div />
                  <div />
                  <div>
                    <Gamepad2Icon size={42} strokeWidth={1.3} />
                  </div>
                </div>
                <h2>Your library starts here</h2>
                <p>
                  Choose an unpacked game folder. Aperto will find its name
                  <br className="wide-break" /> and keep a reference to the original files.
                </p>
                <Button size="lg" onClick={addGame} disabled={busy}>
                  <FolderPlusIcon />
                  Choose a game folder
                </Button>
                <span className="small muted">Your original files stay in place.</span>
              </div>
            ) : !visible.length ? (
              <div className="empty-inline">
                <SearchIcon />
                <h2>No matching games</h2>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setTag("");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <div className={`game-collection ${layout}`}>
                {visible.map((item) => (
                  <button
                    className={`game-card ${selected === item.id ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => setSelected(item.id)}
                    aria-label={`Open ${item.name}`}
                  >
                    <div className="game-art">
                      {item.artwork ? (
                        <img src={item.artwork} alt="" style={{ objectFit: item.artworkFit }} />
                      ) : (
                        <span>{item.name.slice(0, 1).toUpperCase()}</span>
                      )}
                      {snapshot.running.includes(item.id) && (
                        <span className="game-status">Running</span>
                      )}
                    </div>
                    <div className="game-card-copy">
                      <h3>{item.name}</h3>
                      <p>
                        {snapshot.missing.includes(item.id)
                          ? "Folder missing"
                          : item.runtime
                            ? `NW.js ${item.runtime}`
                            : "Runtime needed"}
                      </p>
                      {item.tags.length > 0 && (
                        <div className="tags">
                          {item.tags.slice(0, 3).map((itemTag) => (
                            <span key={itemTag}>{itemTag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      {snapshot && game && page === "library" && (
        <GameDetails
          key={game.id}
          game={game}
          snapshot={snapshot}
          onClose={() => setSelected(null)}
          onRuntimes={() => {
            setPage("runtimes");
            setSelected(null);
          }}
        />
      )}
      {review && (
        <Modal
          className="import-dialog"
          label="Review your game"
          onClose={() => {
            if (!busy) {
              setReview(null);
              setError(null);
            }
          }}
        >
          <header className="detail-heading">
            <div>
              <p className="eyebrow">Add to your library</p>
              <h2 id="import-heading">Review your game</h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close import review"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setError(null);
              }}
            >
              <XIcon />
            </Button>
          </header>
          {review.problems.map((problem) => (
            <p className="notice" key={problem}>
              {problem}
            </p>
          ))}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {candidate ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const state = await request({
                    action: "import",
                    token: candidate.token,
                    name: importName,
                    tags: importTags,
                  });
                  setSnapshot(state);
                  setReview(null);
                  setPage("library");
                  setSelected(state.games.find((item) => item.root === candidate.root)?.id ?? null);
                });
              }}
            >
              {review.candidates.length > 1 && (
                <label>
                  Application folder
                  <select
                    value={candidateIndex}
                    onChange={(event) => {
                      const index = Number(event.target.value);
                      setCandidateIndex(index);
                      setImportName(review.candidates[index]?.name ?? "");
                    }}
                  >
                    {review.candidates.map((item, index) => (
                      <option key={item.token} value={index}>
                        {item.root}
                      </option>
                    ))}
                  </select>
                  <span className="field-help">
                    More than one application was found. Choose the game to add.
                  </span>
                </label>
              )}
              <div className="import-preview">
                {candidate.artwork ? (
                  <img src={candidate.artwork} alt="Discovered artwork" />
                ) : (
                  <Gamepad2Icon size={44} strokeWidth={1.2} />
                )}
                <div>
                  <strong>{candidate.evidence.join(" · ") || "Possible NW.js application"}</strong>
                  <p className="small muted">{candidate.root}</p>
                </div>
              </div>
              {candidate.warnings.map((warning) => (
                <p className="notice small" key={warning}>
                  {warning}
                </p>
              ))}
              <label>
                Display name
                <input
                  autoFocus
                  required
                  maxLength={160}
                  placeholder="Name this game"
                  value={importName}
                  onChange={(event) => setImportName(event.target.value)}
                />
              </label>
              <label>
                Tags
                <input
                  placeholder="Adventure, unfinished"
                  value={importTags}
                  onChange={(event) => setImportTags(event.target.value)}
                />
                <span className="field-help">Optional, separated by commas.</span>
              </label>
              <p className="small muted">
                The game stays in its current folder. You can change its name and artwork later.
              </p>
              <footer>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setReview(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !importName.trim()}>
                  {busy ? "Adding…" : "Add game"}
                </Button>
              </footer>
            </form>
          ) : (
            <Button variant="outline" onClick={addGame} disabled={busy}>
              Choose another folder
            </Button>
          )}
        </Modal>
      )}
    </div>
  );
}
