import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { ZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { describeCount } from "./model";

const countAtom = Atom.make(0).pipe(Atom.keepAlive);

export function App() {
  const count = useAtomValue(countAtom);
  const setCount = useAtomSet(countAtom);
  const versions = window.desktop.versions();

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Aperto</CardTitle>
          <CardDescription>
            TypeScript, Effect v4, React, and Electron are ready for the first feature.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">Desktop</Badge>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-3" aria-live="polite">
            <p className="text-sm text-muted-foreground">Effect state</p>
            <p className="font-medium">{describeCount(count)}</p>
            <Button size="lg" onClick={() => setCount((current) => current + 1)}>
              <ZapIcon data-icon="inline-start" />
              Run interaction
            </Button>
          </div>

          <Separator />

          <dl className="grid grid-cols-3 gap-4" aria-label="Runtime versions">
            <div className="flex flex-col gap-1">
              <dt className="text-sm text-muted-foreground">Electron</dt>
              <dd className="font-mono text-sm">{versions.electron}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-sm text-muted-foreground">Chromium</dt>
              <dd className="font-mono text-sm">{versions.chrome}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-sm text-muted-foreground">Node</dt>
              <dd className="font-mono text-sm">{versions.node}</dd>
            </div>
          </dl>
        </CardContent>

        <CardFooter className="justify-between gap-4">
          <span className="text-sm text-muted-foreground">Effect 4 release candidate</span>
          <Badge variant="outline">Ready</Badge>
        </CardFooter>
      </Card>
    </main>
  );
}
