import { defineConfig } from '@playwright/test';
import baseline from './playwright.config.mjs';

export default defineConfig({
  ...baseline,
  testMatch: 'native-browser.spec.mjs',
  outputDir: 'native-results',
  timeout: 180_000,
  expect: { timeout: 25_000 },
});
