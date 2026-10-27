import type { TagColor } from "../model";

// Full class names, so Tailwind finds them in this file.
const dots: Record<TagColor, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-400",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};
const chips: Record<TagColor, string> = {
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  orange: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  amber: "bg-amber-400/20 text-amber-700 dark:text-amber-200",
  green: "bg-green-500/15 text-green-700 dark:text-green-300",
  teal: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  violet: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  pink: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
};

/** The dot shown beside a tag's name; gray for tags without a color. */
export const tagDot = (color: TagColor | undefined) =>
  color ? dots[color] : "bg-muted-foreground/40";

/** Background and text of a tag chip; the neutral secondary style for tags without a color. */
export const tagChip = (color: TagColor | undefined) =>
  color ? chips[color] : "bg-secondary text-secondary-foreground";
