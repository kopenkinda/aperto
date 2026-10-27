import { useState, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** A group of settings rows in a card, as on a game's page and in Settings. */
export function SettingsCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("divide-y rounded-lg border bg-card/40", className)}>{children}</div>;
}

/** A titled group of settings rows, as in the Settings dialog. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <SettingsCard>{children}</SettingsCard>
    </section>
  );
}

/** One setting: its label on the left, the control and an optional hint on the right. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <Label htmlFor={htmlFor} className="sm:h-8">
        {label}
      </Label>
      <div className="flex min-w-0 flex-col gap-1.5">
        {children}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** A setting that is only an explanation, such as what runs a game. */
export function Note({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Field label={label}>
      <p className="flex min-h-8 items-center text-sm text-muted-foreground">{children}</p>
    </Field>
  );
}

/**
 * A setting that saves on every change: it shows the new value at once and goes back to the saved
 * value if saving fails, which `persist` reports by resolving to undefined.
 */
export function useSaved<T>(saved: T, persist: (value: T) => Promise<unknown>) {
  const [value, setValue] = useState(saved);
  const change = (next: T) => {
    setValue(next);
    void persist(next).then((result) => result === undefined && setValue(saved));
  };
  return [value, change] as const;
}
