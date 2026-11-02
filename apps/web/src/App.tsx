import type { ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  DashboardSquareAddIcon,
  Delete02Icon,
  GithubIcon,
  Notification03Icon,
  Shield01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { ApertoMark } from "./ApertoMark";

const repo = "https://github.com/kopenkinda/aperto";

export function App() {
  return (
    <div className="relative overflow-hidden">
      <Glow />
      <Nav />
      <main>
        <Hero />
        <Stores />
        <Video />
        <Engines />
        <Feature
          id="steam"
          eyebrow="Steam"
          title="Play through Steam, or skip it."
          body="Games Steam installed, on the Mac or in a CrossOver bottle, start through Steam so their updates and DRM keep working. The arrow beside Play runs a game directly instead, for when Steam is signed out or the game needs none of it."
          shot={{ src: "play-menu", x: 32, y: 34, zoom: 2.1 }}
        />
        <Feature
          id="stores"
          eyebrow="Stores"
          title="Install what you already own."
          body="Sign in to Steam, Epic Games, GOG, or itch.io on their own pages, then install from the + menu. GOG's Mac installers are unpacked without an administrator; Windows ones install straight into a CrossOver bottle. A ring in the sidebar shows every download at once."
          shot={{ src: "gog-library", x: 50, y: 50, zoom: 1.45 }}
          flip
        />
        <Feature
          id="tags"
          eyebrow="Library"
          title="Tags and banners, found for you."
          body="Link a game to its Steam, GOG, or itch.io page and its tags and banner come along. Search by name or tag, color tags, block the ones you never want, and keep favorites at the top."
          shot={{ src: "tags", x: 54, y: 62, zoom: 1.5 }}
        />
        <Feature
          id="agents"
          eyebrow="When something breaks"
          title="Ask a coding agent to fix it."
          body="A failed launch has a button that opens Claude Code, Codex, OpenCode, or another agent you have installed, in the game's folder. Aperto tells it how the game runs, hands it the error and the end of the log, and points it at the game's settings."
          shot={{ src: "activity", x: 84, y: 66, zoom: 1.9 }}
          flip
          aside={<AgentLogos />}
        />
        <Extras />
        <Build />
      </main>
      <Footer />
    </div>
  );
}

/** Two slow, soft glows behind the page, as in the launch video. */
function Glow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[1400px]">
      <div className="absolute -top-[500px] left-1/2 h-[1100px] w-[1100px] -translate-x-[70%] rounded-full bg-[radial-gradient(circle,rgba(255,150,80,0.20),transparent_62%)] blur-2xl" />
      <div className="absolute top-[200px] left-1/2 h-[1000px] w-[1000px] translate-x-[5%] rounded-full bg-[radial-gradient(circle,rgba(150,90,255,0.16),transparent_62%)] blur-2xl" />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-ink/70 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
        <a href="#top" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <ApertoMark className="h-6 w-auto" />
          Aperto
        </a>
        <div className="hidden gap-6 text-sm text-zinc-400 md:flex">
          <a className="hover:text-zinc-100" href="#engines">
            Games
          </a>
          <a className="hover:text-zinc-100" href="#stores">
            Stores
          </a>
          <a className="hover:text-zinc-100" href="#agents">
            Agents
          </a>
          <a className="hover:text-zinc-100" href="#build">
            Build
          </a>
        </div>
        <a
          href={repo}
          className="ml-auto flex items-center gap-2 rounded-full bg-white/8 px-4 py-2 text-sm font-medium ring-1 ring-white/10 hover:bg-white/12"
        >
          <HugeiconsIcon icon={GithubIcon} className="size-4" />
          GitHub
        </a>
      </nav>
    </header>
  );
}

/** A capture of the app in a macOS window, cropped to a point at a zoom. */
function Shot({
  src,
  x = 50,
  y = 50,
  zoom = 1,
  className = "",
  alt = "",
}: {
  src: string;
  x?: number;
  y?: number;
  zoom?: number;
  className?: string;
  alt?: string;
}) {
  return (
    <div
      className={`relative aspect-[1.6] overflow-hidden rounded-2xl bg-[#0a0a0a] shadow-[0_40px_120px_rgba(0,0,0,0.6)] ring-1 ring-white/10 ${className}`}
    >
      <img
        src={`/media/${src}.jpg`}
        alt={alt}
        loading="lazy"
        className="absolute inset-0 size-full object-cover"
        style={{ transform: `scale(${zoom})`, transformOrigin: `${x}% ${y}%` }}
      />
      {zoom === 1 && (
        <div className="absolute top-[1.8%] left-[1.1%] flex gap-[0.5%] *:size-[0.75vw] *:max-h-3 *:max-w-3 *:rounded-full">
          <span className="bg-[#ff5f57]" />
          <span className="bg-[#febc2e]" />
          <span className="bg-[#28c840]" />
        </div>
      )}
    </div>
  );
}

function Hero() {
  return (
    <section id="top" className="relative mx-auto max-w-6xl px-6 pt-24 pb-16 text-center md:pt-32">
      <img src="/icon.png" alt="" className="mx-auto mb-8 size-24 drop-shadow-2xl" />
      <h1 className="text-5xl font-semibold tracking-[-0.04em] text-balance md:text-7xl">
        Every game on your Mac.
        <br />
        One launcher.
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-zinc-400 md:text-xl">
        Aperto finds the NW.js, Ren'Py, RPG Maker, Windows, and Mac games in a folder and runs each
        with what it needs. Free and open source, for Apple silicon.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <a
          href={repo}
          className="flex items-center gap-2 rounded-full bg-zinc-100 px-6 py-3 font-medium text-zinc-900 hover:bg-white"
        >
          <HugeiconsIcon icon={GithubIcon} className="size-5" />
          Get it on GitHub
        </a>
        <a
          href="#build"
          className="flex items-center gap-2 rounded-full px-6 py-3 font-medium text-zinc-200 ring-1 ring-white/15 hover:bg-white/5"
        >
          Build your own copy
          <HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
        </a>
      </div>
      <div className="relative mt-20 [perspective:2400px]">
        <div className="[transform:rotateX(14deg)] transition-transform duration-700 hover:[transform:rotateX(0deg)]">
          <Shot
            src="library"
            alt="Aperto showing a game library with Skyrim Special Edition selected"
          />
        </div>
      </div>
    </section>
  );
}

function Stores() {
  const stores = [
    ["steam", "Steam"],
    ["epic", "Epic Games"],
    ["gog", "GOG"],
    ["itch", "itch.io"],
  ];
  return (
    <section className="mx-auto max-w-6xl px-6 py-12">
      <p className="text-center text-sm text-zinc-500">Installs and links games from</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
        {stores.map(([id, name]) => (
          <div key={id} className="flex items-center gap-3 text-lg font-medium text-zinc-300">
            <img src={`/logos/${id}.png`} alt="" className="size-8 rounded-lg" />
            {name}
          </div>
        ))}
      </div>
    </section>
  );
}

function Video() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <video
        className="w-full rounded-2xl shadow-[0_40px_120px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
        src="/media/aperto-launch.mp4"
        poster="/media/aperto-launch-poster.jpg"
        controls
        playsInline
        preload="none"
      />
    </section>
  );
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div>
      <p className="text-sm font-medium tracking-wide text-orange-300/90 uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-balance md:text-5xl">
        {title}
      </h2>
      <p className="mt-5 text-lg text-pretty text-zinc-400">{body}</p>
    </div>
  );
}

const engines = [
  { src: "library", name: "Windows games", detail: "Through CrossOver, in a bottle you choose" },
  { src: "nwjs", name: "NW.js and RPG Maker MV/MZ", detail: "With the NW.js runtime each needs" },
  {
    src: "renpy",
    name: "Ren'Py",
    detail: "Its own Mac build, or the Ren'Py release it was made with",
  },
  { src: "rpgmaker", name: "RPG Maker XP–VX Ace", detail: "Natively, with mkxp-z" },
  { src: "mac", name: "Mac apps", detail: "Including Mac games installed with Steam" },
];

function Engines() {
  return (
    <section id="engines" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24">
      <div className="max-w-2xl">
        <SectionHead
          eyebrow="Games"
          title="Runs what macOS can't."
          body="Point Aperto at a games folder. It recognizes each game, downloads what that game needs the first time, and leaves your files where they are."
        />
      </div>
      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {engines.map((engine) => (
          <figure key={engine.name} className="group">
            <Shot src={engine.src} x={46} y={28} zoom={1.25} />
            <figcaption className="mt-4">
              <p className="font-medium">{engine.name}</p>
              <p className="text-sm text-zinc-500">{engine.detail}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function Feature({
  id,
  eyebrow,
  title,
  body,
  shot,
  flip = false,
  aside,
}: {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  shot: { src: string; x: number; y: number; zoom: number };
  flip?: boolean;
  aside?: ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
      <div
        className={`grid items-center gap-12 lg:grid-cols-[5fr_7fr] ${flip ? "lg:[direction:rtl]" : ""}`}
      >
        <div className="[direction:ltr]">
          <SectionHead eyebrow={eyebrow} title={title} body={body} />
          {aside}
        </div>
        <div className="[direction:ltr]">
          <Shot {...shot} />
        </div>
      </div>
    </section>
  );
}

function AgentLogos() {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      {[
        ["claude", "Claude Code"],
        ["codex", "Codex"],
        ["opencode", "OpenCode"],
      ].map(([id, name]) => (
        <span
          key={id}
          className="flex items-center gap-2 rounded-full bg-white/5 px-3.5 py-1.5 text-sm ring-1 ring-white/10"
        >
          <img src={`/logos/${id}.svg`} alt="" className="size-4" />
          {name}
        </span>
      ))}
    </div>
  );
}

const extras: { icon: IconSvgElement; title: string; body: string }[] = [
  {
    icon: Shield01Icon,
    title: "Protection",
    body: "NW.js, Ren'Py, and RPG Maker games run in a macOS sandbox: no internet, no other programs, and writes only to their own folders.",
  },
  {
    icon: DashboardSquareAddIcon,
    title: "Shortcuts and links",
    body: "Make a small app that starts one game, for Spotlight, Raycast, or the Dock, or copy its aperto:// link.",
  },
  {
    icon: Notification03Icon,
    title: "Notifications",
    body: "Hear when a download or Steam install finishes, or a game you follow has an update.",
  },
  {
    icon: Tag01Icon,
    title: "Tag tools",
    body: "Rename, recolor, merge, and block tags across the library, and look up every game's tags at once.",
  },
  {
    icon: Delete02Icon,
    title: "Delete the right way",
    body: "Remove a game from the library or delete it from disk. Steam games uninstall through Steam, and removed games can come back.",
  },
];

function Extras() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <h2 className="text-3xl font-semibold tracking-[-0.03em] md:text-4xl">
        And the small things.
      </h2>
      <div className="mt-10 grid gap-px overflow-hidden rounded-2xl bg-white/8 ring-1 ring-white/8 sm:grid-cols-2 lg:grid-cols-3">
        {extras.map((extra) => (
          <div key={extra.title} className="bg-ink p-7">
            <HugeiconsIcon icon={extra.icon} className="size-6 text-orange-300/90" />
            <p className="mt-4 font-medium">{extra.title}</p>
            <p className="mt-2 text-sm text-pretty text-zinc-400">{extra.body}</p>
          </div>
        ))}
        <a
          href={repo}
          className="group flex flex-col justify-between bg-ink p-7 hover:bg-white/[0.03]"
        >
          <HugeiconsIcon icon={GithubIcon} className="size-6 text-zinc-300" />
          <p className="mt-4 flex items-center gap-1 font-medium">
            Everything else is in the README
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              className="size-4 transition group-hover:translate-x-1"
            />
          </p>
        </a>
      </div>
    </section>
  );
}

function Build() {
  return (
    <section id="build" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24">
      <div className="grid gap-12 *:min-w-0 lg:grid-cols-2">
        <SectionHead
          eyebrow="Build"
          title="Build your own copy."
          body="Aperto is source-only. With Xcode, Node.js 22.12 or newer, pnpm, and Python 3 on an Apple silicon Mac running macOS 14 or later, these commands build it, sign it with your own local certificate, and open it. CrossOver is only needed for Windows games."
        />
        {/* min-w-0 lets the column shrink, so long commands scroll instead of widening the page. */}
        <div className="min-w-0 self-center">
          <pre className="overflow-x-auto rounded-2xl bg-white/[0.04] p-6 font-mono text-sm leading-7 ring-1 ring-white/10">
            <span className="text-zinc-500">$ </span>git clone {repo}.git
            {"\n"}
            <span className="text-zinc-500">$ </span>cd aperto
            {"\n"}
            <span className="text-zinc-500">$ </span>pnpm install
            {"\n"}
            <span className="text-zinc-500">$ </span>./scripts/run.sh
          </pre>
          <p className="mt-4 text-sm text-zinc-500">
            It installs into /Applications/Aperto.app. No Apple Developer account or notarization
            needed.
          </p>
        </div>
      </div>
      <div className="mt-20 rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-8 ring-1 ring-white/10 md:p-12">
        <h3 className="text-2xl font-semibold tracking-tight">Why can't I just download it?</h3>
        <p className="mt-4 max-w-3xl text-pretty text-zinc-400">
          Shipping a download that opens without macOS warnings means paying Apple $100 a year for
          Developer ID signing and notarization, even for a free app. Building it yourself skips
          that, and you get all the source: see what it does, and change whatever you want.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-10 text-sm text-zinc-500">
        <ApertoMark className="h-5 w-auto text-zinc-400" />
        <span>Aperto, under the MIT license.</span>
        <a href={repo} className="ml-auto hover:text-zinc-300">
          github.com/kopenkinda/aperto
        </a>
      </div>
    </footer>
  );
}
