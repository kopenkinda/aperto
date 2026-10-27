import { describe, expect, it } from "vitest";
import { steamValues } from "./windows";

describe("Steam manifests", () => {
  it("reads app manifests and library folders, including Windows paths", () => {
    const manifest = steamValues(
      '"AppState"\n{\n\t"appid"\t\t"2225070"\n\t"name"\t\t"Trackmania"\n\t"StateFlags"\t\t"1030"\n\t"installdir"\t\t"Trackmania"\n}\n',
    );
    expect(manifest.get("appid")).toEqual(["2225070"]);
    expect(manifest.get("stateflags")).toEqual(["1030"]);
    expect(Number(manifest.get("stateflags")![0]) & 4).toBe(4);
    const folders = steamValues(
      '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}\n',
    );
    expect(folders.get("path")).toEqual(["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
  });
});
