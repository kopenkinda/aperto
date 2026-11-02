import type { ComponentProps } from "react";

// The app icon glyph from Artwork/Aperto.icon, drawn in the current text colour.
export function ApertoMark(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="270 182 500 680" fill="currentColor" aria-hidden="true" {...props}>
      <path
        d="M302 792V330A66 66 0 0 1 368 264H524A66 66 0 0 1 590 330V792"
        fill="none"
        stroke="currentColor"
        strokeWidth="44"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        fillRule="evenodd"
        d="M632 262C632 252 638 244 647 240L718 209C732 203 748 213 748 228V828C748 843 732 853 718 847L647 816C638 812 632 804 632 794Z M682 528a16 16 0 1 0 32 0a16 16 0 1 0 -32 0Z"
      />
      <path
        d="M388 446V638L520 542Z"
        stroke="currentColor"
        strokeWidth="28"
        strokeLinejoin="round"
      />
    </svg>
  );
}
