/** Curated project identity hues (oklch-friendly hex). */
export const PROJECT_SWATCH_PALETTE = [
  "#38bdf8", // sky
  "#2dd4bf", // teal
  "#a3e635", // lime
  "#fbbf24", // amber
  "#fb7185", // rose
  "#c084fc", // violet (identity only — not UI theme)
  "#f472b6", // pink
  "#67e8f9", // cyan
  "#86efac", // green
  "#fdba74", // orange soft
  "#93c5fd", // blue
  "#e879f9", // fuchsia
] as const;

export type ProjectSwatch = {
  /** Hex colour for stripes / accents */
  hex: string;
  /** Tailwind-friendly inline style helpers */
  stripeStyle: { backgroundColor: string };
  softBgStyle: { backgroundColor: string };
  ringStyle: { boxShadow: string };
};

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function projectSwatchIndex(projectId: string): number {
  return hashString(projectId) % PROJECT_SWATCH_PALETTE.length;
}

export function projectSwatch(projectId: string): ProjectSwatch {
  const hex = PROJECT_SWATCH_PALETTE[projectSwatchIndex(projectId)]!;
  return {
    hex,
    stripeStyle: { backgroundColor: hex },
    softBgStyle: { backgroundColor: `${hex}22` },
    ringStyle: { boxShadow: `inset 3px 0 0 0 ${hex}` },
  };
}
