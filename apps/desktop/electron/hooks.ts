import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import { hookEvents, type HookEvent } from "../src/model";

/**
 * Runs a hook's commands in the user's login shell, so their PATH and profile apply, with what it
 * is for in `APERTO_*` variables. Waiting resolves once the commands finish, or after `timeout`
 * when they hang, which leaves them running; otherwise they run on in the background, even after
 * Aperto quits. Resolves with a problem to report, or null.
 */
export function runHook(
  event: HookEvent,
  script: string | undefined,
  variables: Record<string, string>,
  options: { wait?: boolean; timeout?: number } = {},
): Promise<string | null> {
  if (!script?.trim()) return Promise.resolve(null);
  const name = `The “${hookEvents[event]}” hook`;
  const timeout = options.timeout ?? 30_000;
  const shell = process.env.SHELL || userInfo().shell || "/bin/zsh";
  const env: NodeJS.ProcessEnv = { ...process.env, APERTO_HOOK: event, ...variables };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    const child = spawn(shell, ["-l", "-c", script], {
      env,
      cwd: variables.APERTO_GAME_FOLDER ?? userInfo().homedir,
      stdio: "ignore",
      detached: !options.wait,
    });
    child.once("error", (error) => resolve(`${name} could not start: ${error.message}`));
    if (!options.wait) {
      child.once("spawn", () => {
        child.unref();
        resolve(null);
      });
      return;
    }
    const timer = setTimeout(
      () =>
        resolve(`${name} is still running after ${timeout / 1000}s; Aperto went on without it.`),
      timeout,
    );
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve(
        code === 0
          ? null
          : `${name} ${signal ? `ended with ${signal}` : `exited with code ${code}`}.`,
      );
    });
  });
}
