import { describe, expect, it } from "vitest";
import {
  availableSites,
  compareGameVersions,
  linkedSites,
  shownSites,
  steamApp,
  updateAvailable,
  searchName,
  titleMatches,
  chooseOption,
  chosenOption,
  compareVersions,
  launchOptions,
  matchesGame,
  migrateLibrary,
  noFilters,
  normalizeTags,
  sortGames,
  parseFlags,
  parseSearch,
  playtime,
  tagCounts,
  type Game,
  type SortOrder,
} from "./model";

describe("library input", () => {
  it("stores tags as normalized distinct values", () => {
    expect(normalizeTags(" Adventure, unfinished, ADVENTURE, , ")).toEqual([
      "adventure",
      "unfinished",
    ]);
    expect(normalizeTags(["RPG  Maker", "a, b", "rpg maker"])).toEqual(["rpg maker", "a", "b"]);
  });
  it("compares runtime versions numerically and validates argument boundaries", () => {
    expect(compareVersions("0.100.0", "0.99.1")).toBeGreaterThan(0);
    expect(parseFlags("--disable-gpu\n--use-angle=metal")).toEqual([
      "--disable-gpu",
      "--use-angle=metal",
    ]);
    expect(() => parseFlags("--user-data-dir=/tmp/shared")).toThrow("controlled by Aperto");
    expect(() => parseFlags("--disable-gpu\n--disable-gpu")).toThrow("only once");
    expect(() => parseFlags("--disable-gpu && touch /tmp/unwanted")).toThrow("one switch");
  });
});

describe("library filters", () => {
  const game = (name: string, tags: string[], extra: Partial<Game> = {}): Game => ({
    id: name,
    folder: `/games/${name}`,
    root: `/games/${name}`,
    name,
    tags,
    artwork: null,
    runtime: null,
    flags: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    lastPlayed: null,
    removed: false,
    ...extra,
  });
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const games = [
    game("Moon Road", ["rpg", "horror"], { lastPlayed: "2026-10-20T00:00:00.000Z" }),
    game("Grpg Quest", ["puzzle"], { kind: "windows", favorite: true }),
    game("Ember", ["rpg maker", "rpg"], { kind: "mac", lastPlayed: "2026-01-01T00:00:00.000Z" }),
  ];
  const state = { running: ["Ember"], missing: ["Grpg Quest"] };
  const names = (filters = noFilters, search = "") =>
    games.filter((item) => matchesGame(item, filters, search, state, now)).map((item) => item.name);

  it("counts tags across the library, most used first", () => {
    expect(tagCounts(games)).toEqual([
      ["rpg", 2],
      ["horror", 1],
      ["puzzle", 1],
      ["rpg maker", 1],
    ]);
  });
  it("matches plain search words against names only, and tag: terms against tags", () => {
    expect(parseSearch('moon tag:RPG tag:"rpg maker"')).toEqual({
      name: "moon",
      tags: ["rpg", "rpg maker"],
    });
    expect(names(noFilters, "rpg")).toEqual(["Grpg Quest"]);
    expect(names(noFilters, "tag:rpg")).toEqual(["Moon Road", "Ember"]);
    expect(names(noFilters, "tag:hor")).toEqual(["Moon Road"]);
    expect(names(noFilters, 'tag:"rpg maker"')).toEqual(["Ember"]);
  });
  it("requires every tag and status, and any one type", () => {
    expect(names({ ...noFilters, tags: ["rpg", "horror"] })).toEqual(["Moon Road"]);
    expect(names({ ...noFilters, kinds: ["windows", "mac"] })).toEqual(["Grpg Quest", "Ember"]);
    expect(names({ ...noFilters, statuses: ["recent"] })).toEqual(["Moon Road"]);
    expect(names({ ...noFilters, statuses: ["unplayed", "missing"] })).toEqual(["Grpg Quest"]);
    expect(names({ ...noFilters, statuses: ["favorite"] })).toEqual(["Grpg Quest"]);
    expect(names({ ...noFilters, tags: ["rpg"], statuses: ["running"] })).toEqual(["Ember"]);
  });
  it("hides games with any excluded tag", () => {
    const included = names({ ...noFilters, tags: ["rpg"] });
    const excluded = names({ ...noFilters, tags: ["rpg"], excludedTags: ["horror"] });
    expect(excluded).toEqual(included.filter((name) => name !== "Moon Road"));
  });
  it("sorts favorites first, then by the chosen order with the name breaking ties", () => {
    const sorted = (order: SortOrder, launches = [] as { gameId: string }[], reversed = false) =>
      sortGames(
        [
          game("Moon Road", [], {
            lastPlayed: "2026-10-20T00:00:00.000Z",
            addedAt: "2026-03-01T00:00:00.000Z",
          }),
          game("Grpg Quest", [], { favorite: true }),
          game("Ember", [], { lastPlayed: "2026-01-01T00:00:00.000Z", plays: 5 }),
          game("Ash", []),
        ],
        { order, reversed },
        launches,
      ).map((item) => item.name);
    expect(sorted("name")).toEqual(["Grpg Quest", "Ash", "Ember", "Moon Road"]);
    expect(sorted("lastPlayed")).toEqual(["Grpg Quest", "Moon Road", "Ember", "Ash"]);
    expect(sorted("added")).toEqual(["Grpg Quest", "Moon Road", "Ash", "Ember"]);
    // Games without a stored count use the launch history.
    const history = Array.from({ length: 6 }, () => ({ gameId: "Moon Road" }));
    expect(sorted("plays", history)).toEqual(["Grpg Quest", "Moon Road", "Ember", "Ash"]);
    // Reversing keeps favorites first and never-played games last under Last played.
    expect(sorted("name", [], true)).toEqual(["Grpg Quest", "Moon Road", "Ember", "Ash"]);
    expect(sorted("lastPlayed", [], true)).toEqual(["Grpg Quest", "Ember", "Moon Road", "Ash"]);
    expect(sorted("plays", history, true)).toEqual(["Grpg Quest", "Ash", "Ember", "Moon Road"]);
  });
  it("totals playtime from the stored count or else the finished launches", () => {
    const launch = (gameId: string, minutes: number, outcome = "ended" as const) => ({
      gameId,
      startedAt: "2026-10-20T10:00:00.000Z",
      endedAt: new Date(Date.parse("2026-10-20T10:00:00.000Z") + minutes * 60_000).toISOString(),
      outcome,
    });
    const history = [
      launch("Ember", 30),
      launch("Ember", 15),
      { ...launch("Ember", 600), outcome: "interrupted" as const },
      { ...launch("Ember", 0), endedAt: null, outcome: "running" as const },
      launch("Ash", 90),
    ];
    expect(playtime(game("Ember", []), history)).toBe(45 * 60);
    expect(playtime(game("Ember", [], { playtime: 7 }), history)).toBe(7);
  });
});

describe("launch options", () => {
  const [display, graphics] = launchOptions({ kind: "windows" }, "unity");

  it("offers controls by engine", () => {
    expect(launchOptions({ kind: "windows" }, null)).toEqual([]);
    expect(launchOptions({ kind: "mac" }, "unity").map((option) => option.id)).toEqual([
      "unity-display",
    ]);
    expect(launchOptions({}, null).map((option) => option.id)).toEqual(["nwjs-software"]);
  });

  it("reads the choice from the text and writes it back, keeping other lines", () => {
    let text = "-popupwindow\n";
    expect(chosenOption(display!, text)).toBe(0);
    text = chooseOption(display!, text, 1);
    expect(text).toBe("-popupwindow\n-screen-fullscreen\n1");
    expect(chosenOption(display!, text)).toBe(1);
    text = chooseOption(graphics!, text, 3);
    text = chooseOption(display!, text, 2);
    expect(text).toBe("-popupwindow\n-force-vulkan\n-screen-fullscreen\n0");
    expect(chosenOption(graphics!, text)).toBe(3);
    text = chooseOption(graphics!, chooseOption(display!, text, 0), 0);
    expect(text).toBe("-popupwindow");
  });

  it("treats unknown values and one-line pairs as custom, and replaces them on change", () => {
    expect(chosenOption(display!, "-screen-fullscreen\n2")).toBeNull();
    expect(chosenOption(display!, "-screen-fullscreen 0")).toBeNull();
    expect(chosenOption(graphics!, "-force-d3d11\n-force-vulkan")).toBeNull();
    expect(chooseOption(display!, "-screen-fullscreen 0\n-x", 1)).toBe("-x\n-screen-fullscreen\n1");
  });
});

describe("metadata matching", () => {
  it("drops versions, notes, and release words from search names", () => {
    expect(searchName("Winter Memories v1.08")).toBe("Winter Memories");
    expect(searchName("Breakthru (Steam - R18)")).toBe("Breakthru");
    expect(searchName("Five Nights with Maids ver1.03 - EN")).toBe("Five Nights with Maids");
    expect(searchName("That Time I Got Reincarnated as a Demon Hand v2026-01-31")).toBe(
      "That Time I Got Reincarnated as a Demon Hand",
    );
    expect(searchName("Elf Girl Pinball DLC1")).toBe("Elf Girl Pinball");
  });

  it("matches the same title, or a store title with a subtitle the name leaves out", () => {
    expect(titleMatches("SummerClover v1.11", "Summer Clover")).toBe(true);
    expect(titleMatches("Take Me To The Dungeon v1.7.6", "Take Me To The Dungeon!!")).toBe(true);
    expect(
      titleMatches("Nightmare Knight", "Nightmare Knight ~Sacred Maiden & Fallen Magic~"),
    ).toBe(true);
    // The library title's subtitle may name a different game in a series.
    expect(titleMatches("Lunar Mirror - The Pavilion of Desire", "Lunar Mirror")).toBe(false);
    expect(titleMatches("Ark Mobius", "Ark")).toBe(false);
  });
});

describe("library migration", () => {
  it("moves the old source and the update check's thread into links", () => {
    const update = { installed: "1.0", latest: "1.1", checkedAt: "2026-01-01T00:00:00.000Z" };
    const migrated = migrateLibrary({
      games: [
        { id: "a", source: { site: "steam", id: "7", title: "Game" } },
        { id: "b", update: { ...update, thread: "9", title: "Game" } },
        { id: "c", source: { site: "f95", id: "3", title: "Old" }, update: { thread: "4" } },
        { id: "d" },
      ],
    }) as { games: unknown[] };
    expect(migrated.games).toEqual([
      { id: "a", links: { steam: { id: "7", title: "Game" } } },
      {
        id: "b",
        update: { ...update, thread: "9", title: "Game" },
        links: { f95: { id: "9", title: "Game" } },
      },
      { id: "c", update: { thread: "4" }, links: { f95: { id: "3", title: "Old" } } },
      { id: "d" },
    ]);
  });
});

describe("game versions", () => {
  it("compares the version-like part of labels", () => {
    expect(compareGameVersions("v2.3", "2.2")).toBeGreaterThan(0);
    expect(compareGameVersions("v1.0.10", "1.0.9")).toBeGreaterThan(0);
    expect(compareGameVersions("1.18c", "1.18b")).toBeGreaterThan(0);
    expect(compareGameVersions("1.0.1", "1.0")).toBeGreaterThan(0);
    expect(compareGameVersions("Ch.3 v0.5", "0.5")).toBe(0);
    expect(compareGameVersions("2026-02-14", "2026.01.31")).toBeGreaterThan(0);
    expect(compareGameVersions("Final", "1.0")).toBeNull();
  });

  it("flags an update only when both versions are known and the thread's is newer", () => {
    const checkedAt = "2026-10-27T00:00:00.000Z";
    expect(
      updateAvailable({
        update: { installed: "2.1", latest: "v2.2", checkedAt },
      }),
    ).toBe(true);
    expect(
      updateAvailable({
        update: { installed: "2.2", latest: "v2.2", checkedAt },
      }),
    ).toBe(false);
    expect(
      updateAvailable({
        update: { installed: null, latest: "v2.2", checkedAt },
      }),
    ).toBe(false);
    expect(updateAvailable({})).toBe(false);
  });
});

describe("steamApp", () => {
  const steam = { steam: { id: "10", title: "Space Game" } };
  it("knows games a Steam client installed, not ones only linked to Steam", () => {
    expect(
      steamApp({
        kind: "mac",
        root: "/Users/me/Library/Application Support/Steam/steamapps/common/Space/Space.app",
        links: steam,
      }),
    ).toBe("10");
    expect(steamApp({ kind: "mac", root: "/Applications/Space.app", links: steam })).toBe(null);
    expect(
      steamApp({
        kind: "windows",
        root: "/bottle/steamapps/common/Space",
        steam: { appId: "20", bottle: "Steam", installdir: "Space", client: "steam.exe" },
      }),
    ).toBe("20");
  });
});

describe("adult content", () => {
  it("hides F95zone and DLsite until it is on, keeping the saved choice", () => {
    const library = { linkSites: ["f95", "steam", "dlsite"] as const };
    expect(availableSites({})).toEqual(["steam", "gog", "itch"]);
    expect(shownSites(library)).toEqual(["steam"]);
    expect(shownSites({ ...library, adultContent: true })).toEqual(["f95", "steam", "dlsite"]);
    const game = { links: { f95: { id: "1", title: "A" }, steam: { id: "2", title: "A" } } };
    expect(linkedSites(game, {})).toEqual(["steam"]);
    expect(linkedSites(game, { adultContent: true })).toEqual(["steam", "f95"]);
  });
});
