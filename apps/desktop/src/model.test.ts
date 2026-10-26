import { describe, expect, it } from "vitest";
import { compareVersions, normalizeTags, parseFlags } from "./model";

describe("library input", () => {
  it("stores tags as normalized distinct values", () => {
    expect(normalizeTags(" Adventure, unfinished, ADVENTURE, , ")).toEqual([
      "adventure",
      "unfinished",
    ]);
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
