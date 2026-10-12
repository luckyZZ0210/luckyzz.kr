// Home color tokens (spec §3). Exposed as CSS custom properties on the home
// header and IndexField host; canvas reads them back via getComputedStyle.
import type { CSSProperties } from "react";

export const HOME_TOKENS = {
  "--void": "#0A0B0C",
  "--ink": "#E9E9E3",
  "--soft": "#6E7378",
  "--accent": "#9DB8FF",
} as const;

export const homeTokenStyle = HOME_TOKENS as unknown as CSSProperties;
