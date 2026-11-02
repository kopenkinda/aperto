import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Agent } from "../src/model";

const execute = promisify(execFile);

/**
 * Coding agents Aperto can start in a game's folder, and how each takes Aperto's notes about the
 * game: as added system instructions where the agent has a flag for them, else as its first
 * message, which asks it to wait for the user.
 */
const known: (Agent & { args: (context: string) => string[] })[] = [
  {
    id: "claude",
    name: "Claude Code",
    args: (context) => ["--append-system-prompt", context],
  },
  {
    id: "codex",
    name: "Codex",
    args: (context) => ["-c", `developer_instructions=${JSON.stringify(context)}`],
  },
  { id: "pi", name: "Pi", args: (context) => ["--append-system-prompt", context] },
  { id: "opencode", name: "OpenCode", args: (context) => ["--prompt", firstMessage(context)] },
  { id: "gemini", name: "Gemini CLI", args: (context) => ["-i", firstMessage(context)] },
  { id: "qwen", name: "Qwen Code", args: (context) => ["-i", firstMessage(context)] },
  { id: "copilot", name: "GitHub Copilot", args: (context) => ["-i", firstMessage(context)] },
  { id: "cursor-agent", name: "Cursor Agent", args: (context) => [firstMessage(context)] },
  { id: "amp", name: "Amp", args: () => [] },
  { id: "aider", name: "Aider", args: () => [] },
];

const firstMessage = (context: string) =>
  `${context}\n\nReply only with a one-line summary of the game, then wait for my request.`;

/**
 * The user's login shell, which knows the PATH and shell functions their terminal has. fish takes
 * different syntax, so zsh stands in for it.
 */
function loginShell() {
  const shell = process.env.SHELL || userInfo().shell || "/bin/zsh";
  return shell.endsWith("/fish") ? "/bin/zsh" : shell;
}

let found: { at: number; agents: Promise<Agent[]> } | null = null;

/**
 * The known agents the user's login shell can run, found once and again after ten minutes. Apps
 * opened from Finder have a bare PATH, so the shell is asked rather than Aperto's own PATH.
 */
export function installedAgents(): Promise<Agent[]> {
  if (!found || Date.now() - found.at > 10 * 60_000) {
    const script = `for c in ${known.map((agent) => agent.id).join(" ")}; do command -v "$c" >/dev/null 2>&1 && printf '__APERTO_AGENT__%s\\n' "$c"; done; exit 0`;
    found = {
      at: Date.now(),
      agents: execute(loginShell(), ["-lic", script], { timeout: 15_000 }).then(
        ({ stdout }) => {
          const names = new Set(
            [...stdout.matchAll(/__APERTO_AGENT__(\S+)/g)].map((match) => match[1]),
          );
          return known.filter((agent) => names.has(agent.id)).map(({ id, name }) => ({ id, name }));
        },
        (error: unknown) => {
          console.error("Could not look for coding agents:", error);
          return [];
        },
      ),
    };
  }
  return found.agents;
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Writes a script that starts the agent in `folder` with Aperto's notes, for a terminal to open.
 * The agent runs in the user's interactive login shell, so shell functions that wrap it still
 * apply, and a shell stays open in the folder after it exits. The script deletes itself.
 */
export async function agentScript(
  directory: string,
  agentId: string,
  folder: string,
  context: string,
) {
  const agent = known.find((item) => item.id === agentId);
  if (!agent) throw new Error("Aperto does not know this coding agent.");
  const script = path.join(directory, "agent-launch", `${randomUUID()}.command`);
  await mkdir(path.dirname(script), { recursive: true });
  const command = [agent.id, ...agent.args(context)].map(quote).join(" ");
  await writeFile(
    script,
    `#!/bin/sh
rm -f "$0"
cd ${quote(folder)} || exit 1
shell="\${SHELL:-/bin/zsh}"
case "$shell" in */fish) shell=/bin/zsh ;; esac
"$shell" -lic '"$@"' aperto ${command}
exec "$shell" -l
`,
    { mode: 0o755 },
  );
  return script;
}
