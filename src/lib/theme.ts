/**
 * Running Days Theme - Design System
 *
 * OKLCH-based color system with bioluminescent ocean aesthetics.
 * Deep blue-black backgrounds with warm orange/amber accents.
 */

// OKLCH to RGB conversion
function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bVal = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  const toSrgb = (x: number) => {
    const clamped = Math.max(0, Math.min(1, x));
    return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  };

  return [Math.round(toSrgb(r) * 255), Math.round(toSrgb(g) * 255), Math.round(toSrgb(bVal) * 255)];
}

function oklchToHex(l: number, c: number, h: number): string {
  const [r, g, b] = oklchToRgb(l, c, h);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Running Days Theme Colors
 */
export const colors = {
  // Background colors - deep ocean blues
  bg: {
    primary: oklchToHex(0.15, 0.02, 260),
    secondary: oklchToHex(0.18, 0.025, 260),
    tertiary: oklchToHex(0.12, 0.015, 260),
    elevated: oklchToHex(0.2, 0.03, 260),
    hover: oklchToHex(0.22, 0.035, 260),
  },

  // Foreground colors - soft whites
  fg: {
    primary: oklchToHex(0.95, 0.02, 210),
    secondary: oklchToHex(0.75, 0.02, 210),
    tertiary: oklchToHex(0.55, 0.02, 210),
    disabled: oklchToHex(0.4, 0.01, 210),
  },

  // Accent colors - bioluminescent warmth
  accent: {
    primary: oklchToHex(0.75, 0.18, 40),
    secondary: oklchToHex(0.7, 0.15, 50),
    muted: oklchToHex(0.55, 0.1, 40),
  },

  // Agent states
  agent: {
    thinking: oklchToHex(0.7, 0.15, 180),
    executing: oklchToHex(0.75, 0.18, 40),
    waiting: oklchToHex(0.6, 0.12, 280),
    streaming: oklchToHex(0.72, 0.16, 160),
  },

  // Semantic colors
  semantic: {
    success: oklchToHex(0.7, 0.18, 145),
    warning: oklchToHex(0.75, 0.18, 75),
    error: oklchToHex(0.65, 0.2, 25),
    info: oklchToHex(0.7, 0.15, 230),
  },

  // Tool approval
  tool: {
    safe: oklchToHex(0.7, 0.18, 145),
    caution: oklchToHex(0.75, 0.18, 75),
    danger: oklchToHex(0.65, 0.2, 25),
  },

  // Border colors
  border: {
    default: oklchToHex(0.3, 0.03, 260),
    focused: oklchToHex(0.75, 0.18, 40),
    muted: oklchToHex(0.22, 0.02, 260),
  },
} as const;

/**
 * Design tokens
 */
export const tokens = {
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    xxl: '3rem',
  },
  radius: {
    sm: '0.25rem',
    md: '0.5rem',
    lg: '0.75rem',
    full: '9999px',
  },
  transition: {
    fast: '150ms ease',
    normal: '250ms ease',
    slow: '400ms ease',
  },
} as const;

export type ThemeColors = typeof colors;
export type ThemeTokens = typeof tokens;
