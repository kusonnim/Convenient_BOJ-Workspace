import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({ ...base, testMatch: 'editor.spec.mjs', outputDir: 'editor-results', timeout: 150000,
  use: { actionTimeout: 10000 }, expect: { timeout: 12000 } });
