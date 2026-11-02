import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Undo02Icon } from "@hugeicons/core-free-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { request } from "../desktop";
import { managedPlugins, type Game, type PluginList } from "../model";
import { SearchInput } from "./SearchInput";
import { Field, SettingsCard, useSaved } from "./settings";

/**
 * An RPG Maker MV/MZ game's plugins: the cheat menu and getPixel fix Aperto manages, then the
 * game's own plugins with switches, and restoring the original list. Nothing shows for NW.js games
 * without an RPG Maker plugin list.
 */
export function PluginsSection({
  game,
  running,
  busy,
  run,
  queue,
}: {
  game: Game;
  running: boolean;
  busy: boolean;
  /** Runs a change and shows its error on the page. */
  run: <T>(work: () => Promise<T>) => Promise<T | undefined>;
  /** Runs a change after the page's earlier changes, as the library takes one at a time. */
  queue: (work: () => Promise<unknown>) => Promise<unknown>;
}) {
  // Undefined while loading; null when the game is not an RPG Maker export and has no plugin list.
  const [plugins, setPlugins] = useState<PluginList | null | undefined>(undefined);
  const [pluginError, setPluginError] = useState<string | null>(null);
  const [pluginSearch, setPluginSearch] = useState("");
  const [pixelFix, changePixelFix] = useSaved(game.pixelFix !== false, (enabled) =>
    queue(async () => {
      const list = await request({ action: "setPixelFix", id: game.id, enabled });
      if (list) setPlugins(list);
      return list ?? true;
    }),
  );
  const [restoring, setRestoring] = useState(false);
  // Keeps each plugin's position in the game's list, which toggling refers to.
  const pluginQuery = pluginSearch.trim().toLowerCase();
  const gamePlugins = (plugins?.plugins ?? [])
    .map((plugin, index) => ({ plugin, index }))
    .filter(({ plugin }) => !managedPlugins.includes(plugin.name));
  const shownPlugins = gamePlugins.filter(
    ({ plugin }) =>
      !pluginQuery ||
      plugin.name.toLowerCase().includes(pluginQuery) ||
      plugin.description.toLowerCase().includes(pluginQuery),
  );

  // Launching can add the getPixel fix, so the list is read again when the game closes.
  useEffect(() => {
    if (running) return;
    let active = true;
    request({ action: "plugins", id: game.id }).then(
      (list) => active && setPlugins(list),
      (cause: unknown) =>
        active && setPluginError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      active = false;
    };
  }, [game.id, running]);

  if (plugins === null) return null;
  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="flex items-baseline justify-between font-medium">
          Plugins
          {gamePlugins.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {gamePlugins.filter(({ plugin }) => plugin.enabled).length} of {gamePlugins.length} on
            </span>
          )}
        </h2>
        <p className="text-xs text-muted-foreground">
          Changes edit the game's own plugin list and apply on the next launch, also outside Aperto.
        </p>
        {running && (
          <p className="text-xs text-muted-foreground">Close the game to edit plugins.</p>
        )}
        {plugins?.conflict && (
          <Alert variant="destructive">
            <AlertDescription>
              The plugin list was changed outside Aperto. Editing is paused so those changes are not
              overwritten.
            </AlertDescription>
          </Alert>
        )}
        {pluginError && <p className="text-muted-foreground">{pluginError}</p>}
        {plugins === undefined && !pluginError && (
          <p className="text-muted-foreground">Reading plugins…</p>
        )}
        {plugins && (
          <SettingsCard>
            <Field
              label="Cheat menu"
              htmlFor="game-cheat-menu"
              hint="Press 1 in the game to open it. Aperto downloads emerladCoder's RPG Maker Cheat Menu the first time."
            >
              <div className="flex min-h-8 items-center">
                <Switch
                  id="game-cheat-menu"
                  checked={plugins.cheatMenu}
                  disabled={busy || running || plugins.conflict}
                  onCheckedChange={(enabled) =>
                    void queue(async () =>
                      setPlugins(
                        await request({
                          action: "setCheatMenu",
                          id: game.id,
                          hash: plugins.hash,
                          enabled,
                        }),
                      ),
                    )
                  }
                />
              </div>
            </Field>
            <Field
              label="getPixel fix"
              htmlFor="game-pixel-fix"
              hint="Prevents a crash in some games that read a pixel at an invalid position in newer NW.js. Added when the game launches."
            >
              <div className="flex min-h-8 items-center">
                <Switch
                  id="game-pixel-fix"
                  checked={pixelFix}
                  disabled={running || plugins.conflict}
                  onCheckedChange={changePixelFix}
                />
              </div>
            </Field>
          </SettingsCard>
        )}
        {plugins && !gamePlugins.length && (
          <p className="text-muted-foreground">This game has no plugins.</p>
        )}
        {gamePlugins.length > 0 && (
          <SearchInput
            aria-label="Search plugins"
            placeholder="Search plugins"
            value={pluginSearch}
            onChange={(event) => setPluginSearch(event.target.value)}
          />
        )}
        {gamePlugins.length > 0 && !shownPlugins.length && (
          <p className="text-muted-foreground">No plugins match “{pluginSearch.trim()}”.</p>
        )}
        {shownPlugins.length > 0 && plugins && (
          <ul className="divide-y rounded-lg border">
            {shownPlugins.map(({ plugin, index }) => (
              <li key={`${index}-${plugin.name}`} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{plugin.name || "Unnamed entry"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {plugin.missing ? "Plugin file is missing" : plugin.description}
                  </p>
                </div>
                <Switch
                  aria-label={`Enable ${plugin.name || "unnamed plugin"}`}
                  checked={plugin.enabled}
                  disabled={
                    busy ||
                    running ||
                    plugins.conflict ||
                    !plugin.name ||
                    (plugin.missing && !plugin.enabled)
                  }
                  onCheckedChange={(enabled) =>
                    void run(async () =>
                      setPlugins(
                        await request({
                          action: "togglePlugin",
                          id: game.id,
                          hash: plugins.hash,
                          index,
                          enabled,
                        }),
                      ),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {plugins?.canRestore && (
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy || running} onClick={() => setRestoring(true)}>
              <HugeiconsIcon icon={Undo02Icon} />
              Restore original
            </Button>
            <Button
              variant="ghost"
              onClick={() => void run(() => request({ action: "revealPluginBackup", id: game.id }))}
            >
              Show backup
            </Button>
          </div>
        )}
      </section>

      <Dialog open={restoring} onOpenChange={(open) => !open && !busy && setRestoring(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore original plugins?</DialogTitle>
            <DialogDescription>
              This puts back the plugin list from before Aperto first changed it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoring(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (plugins)
                    setPlugins(
                      await request({ action: "restorePlugins", id: game.id, hash: plugins.hash }),
                    );
                  setRestoring(false);
                })
              }
            >
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
