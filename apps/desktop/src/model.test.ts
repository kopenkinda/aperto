import { describe, expect, it } from "vitest";
import { describeCount } from "./model";

describe("describeCount", () => {
  it("uses the singular label for one interaction", () => {
    expect(describeCount(1)).toBe("One Effect-backed interaction");
  });

  it("uses the plural label for other counts", () => {
    expect(describeCount(2)).toBe("2 Effect-backed interactions");
  });
});
