import type { ComponentProps } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A text field with a search icon inside it. */
export function SearchInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <div className={cn("relative", className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input {...props} className="pl-8" />
    </div>
  );
}
