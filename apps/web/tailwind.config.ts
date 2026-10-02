import type { Config } from 'tailwindcss';

/**
 * Tailwind is for layout only (flex, grid, gap, padding, width). Colors,
 * borders, radii, shadows and type come from Perfect UI (docs/TASARIM.md);
 * there is no custom color scale here on purpose. Preflight is off because
 * its unlayered reset would beat the kit's cascade layers.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};

export default config;
