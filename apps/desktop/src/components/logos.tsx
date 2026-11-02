import { HugeiconsIcon } from "@hugeicons/react";
import { AiProgrammingIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import type { MetadataSite, StoreSite } from "../model";
import claude from "@/assets/logos/claude.svg";
import codex from "@/assets/logos/codex.svg";
import copilot from "@/assets/logos/copilot.svg";
import cursor from "@/assets/logos/cursor.svg";
import gemini from "@/assets/logos/gemini.svg";
import opencode from "@/assets/logos/opencode.svg";
import pi from "@/assets/logos/pi.svg";
import qwen from "@/assets/logos/qwen.svg";
import dlsiteFavicon from "@/assets/favicons/dlsite.png";
import epicFavicon from "@/assets/favicons/epic.png";
import f95Favicon from "@/assets/favicons/f95.png";
import gogFavicon from "@/assets/favicons/gog.png";
import itchFavicon from "@/assets/favicons/itch.png";
import steamFavicon from "@/assets/favicons/steam.png";

// Agent logos from svgl.app, in their dark-theme versions, since Aperto is always dark.
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
// Each store's own favicon.
const favicons: Record<MetadataSite | StoreSite, string> = {
  epic: epicFavicon,
  f95: f95Favicon,
  steam: steamFavicon,
  gog: gogFavicon,
  dlsite: dlsiteFavicon,
  itch: itchFavicon,
};

/** A coding agent's logo; agents svgl has no logo for get a generic one. */
export function AgentLogo({ id, className }: { id: string; className?: string }) {
  const logo = agents[id];
  return logo ? (
    <img src={logo} alt="" className={cn("size-4 shrink-0 object-contain", className)} />
  ) : (
    <HugeiconsIcon icon={AiProgrammingIcon} className={cn("size-4 shrink-0", className)} />
  );
}

/** A store's favicon, in color when the game is linked there and grayed out when not. */
export function SiteLogo({
  site,
  linked = true,
  className,
}: {
  site: MetadataSite | StoreSite;
  linked?: boolean;
  className?: string;
}) {
  return (
    <img
      src={favicons[site]}
      alt=""
      className={cn(
        "size-3.5 shrink-0 rounded-[3px] object-contain transition",
        !linked && "opacity-50 grayscale",
        className,
      )}
    />
  );
}
