import { useState } from "react";
import type { Command, ResultFor } from "./model";

export async function request<C extends Command>(command: C): Promise<ResultFor<C>> {
  if (!window.desktop)
    throw new Error("Open Aperto in the desktop app to access your local library.");
  return window.desktop.request(command);
}

export function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError };
}
