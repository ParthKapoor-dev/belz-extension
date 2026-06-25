// Design tokens for the extension — injected UI + DevTools panel.
//
// One dark theme, axiom-style blue accent, sharp corners, hairline borders,
// no gradients. Hex values inlined — no external token package dependency.

const palette = {
  ink: "#0c0d0f",
  surface: "#101113",
  surface2: "#16181b",
  line: "#1f2123",
  line2: "#2a2d30",
  fg: "#e6e7e8",
  fgMuted: "#9ba1a6",
  fgFaint: "#5c6166",
  accent: "#3b82f6",
  accentHover: "#5b9bff",
  accentFg: "#08090a",
  danger: "#f85149",
  warning: "#d29922",
  success: "#3fb950",
};

/** Token palette (hex) for inline styles. */
export const T = {
  ink: palette.ink,
  surface: palette.surface,
  surface2: palette.surface2,
  line: palette.line,
  line2: palette.line2,
  fg: palette.fg,
  fgMuted: palette.fgMuted,
  fgFaint: palette.fgFaint,
  accent: palette.accent,
  accentHover: palette.accentHover,
  accentFg: palette.accentFg,
  danger: palette.danger,
  warning: palette.warning,
  success: palette.success,
};

/** Monospace stack — matches web + CLI. */
export const FONT_MONO =
  '"Berkeley Mono", "IoskeleyMono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** Sharp corners everywhere. */
export const RADIUS = "0";

/** A flat, restrained shadow for raised surfaces (no glow). */
export const SHADOW = "0 8px 24px rgba(0, 0, 0, 0.5)";

/** Modal backdrop scrim. */
export const SCRIM = "rgba(0, 0, 0, 0.66)";

/** `#rrggbb` + alpha (0..1) → `rgba()` — for subtle token-derived fills. */
export function alpha(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
