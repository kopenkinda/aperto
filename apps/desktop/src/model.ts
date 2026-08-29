import * as Effect from "effect/Effect";

export const describeCount = (count: number): string =>
  Effect.runSync(
    Effect.sync(() =>
      count === 1 ? "One Effect-backed interaction" : `${count} Effect-backed interactions`,
    ),
  );
