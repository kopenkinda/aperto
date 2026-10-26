import { describe, expect, it } from "vitest";
import {
  compareVersions,
  matchesGame,
  noFilters,
  normalizeTags,
  parseFlags,
  parseSearch,
  tagCounts,
  type Game,
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
    game("Grpg Quest", ["puzzle"], { kind: "windows" }),
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
    expect(names({ ...noFilters, tags: ["rpg"], statuses: ["running"] })).toEqual(["Ember"]);
  });
});
