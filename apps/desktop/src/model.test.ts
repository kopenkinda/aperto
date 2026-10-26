import { describe, expect, it } from "vitest";
import {
  compareVersions,
  matchesGame,
  noFilters,
  normalizeTags,
  sortGames,
  parseFlags,
  parseSearch,
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
});
