import { HugeiconsIcon } from "@hugeicons/react";
import { AiProgrammingIcon, Link01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import type { MetadataSite } from "../model";
import claude from "@/assets/logos/claude.svg";
import codex from "@/assets/logos/codex.svg";
import copilot from "@/assets/logos/copilot.svg";
import cursor from "@/assets/logos/cursor.svg";
import gemini from "@/assets/logos/gemini.svg";
import opencode from "@/assets/logos/opencode.svg";
import pi from "@/assets/logos/pi.svg";
import qwen from "@/assets/logos/qwen.svg";
import steam from "@/assets/logos/steam.svg";

// Logos from svgl.app, in their dark-theme versions, since Aperto is always dark.
const agents: Record<string, string> = {
  claude,
  codex,
  copilot,
  "cursor-agent": cursor,
  gemini,
  opencode,
  pi,
  qwen,
};
const sites: Partial<Record<MetadataSite, string>> = { steam };

/** A coding agent's logo; agents svgl has no logo for get a generic one. */
export function AgentLogo({ id, className }: { id: string; className?: string }) {
  const logo = agents[id];
  return logo ? (
    <img src={logo} alt="" className={cn("size-4 shrink-0 object-contain", className)} />
  ) : (
    <HugeiconsIcon icon={AiProgrammingIcon} className={cn("size-4 shrink-0", className)} />
  );
}

/** A store's logo; sites svgl has no logo for, F95zone and itch.io, get a link icon. */
export function SiteLogo({ site, className }: { site: MetadataSite; className?: string }) {
  const logo = sites[site];
  return logo ? (
    <img src={logo} alt="" className={cn("size-3 shrink-0 object-contain", className)} />
  ) : (
    <HugeiconsIcon icon={Link01Icon} className={cn("size-3 shrink-0", className)} />
  );
}
