import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { describeCount } from "./model";

const countAtom = Atom.make(0).pipe(Atom.keepAlive);

export function App() {
  const count = useAtomValue(countAtom);
  const setCount = useAtomSet(countAtom);
  const versions = window.desktop.versions();

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="app-title">
        <p className="eyebrow">Electron desktop starter</p>
        <h1 id="app-title">Aperto</h1>
        <p className="intro">
          TypeScript, Effect v4, React, and Electron are wired together and ready for the first
          feature.
        </p>

        <div className="counter" aria-live="polite">
          <span>{describeCount(count)}</span>
          <button type="button" onClick={() => setCount((current) => current + 1)}>
            Run interaction
          </button>
        </div>
      </section>

      <dl className="runtime" aria-label="Runtime versions">
        <div>
          <dt>Electron</dt>
          <dd>{versions.electron}</dd>
        </div>
        <div>
          <dt>Chromium</dt>
          <dd>{versions.chrome}</dd>
        </div>
        <div>
          <dt>Node</dt>
          <dd>{versions.node}</dd>
        </div>
      </dl>
    </main>
  );
}
