import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({ ...base, testMatch: 'p5.spec.mjs', outputDir: 'measurements/p5/tests',
  timeout: 120000, expect: { timeout: 12000 }, use: { actionTimeout: 12000 } });
