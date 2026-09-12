import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Evals de modelos contra OpenRouter real (`npm run eval`). No corren con
 * `npm test`: cuestan plata y dependen de la red. Ver api/evals/.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['evals/**/*.eval.ts'],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    // Uno por vez: las latencias medidas no se contaminan entre sí.
    fileParallelism: false,
  },
});
