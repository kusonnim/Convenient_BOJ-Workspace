import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';
export default defineConfig({ ...base, testMatch: 'p4.spec.mjs', outputDir: 'measurements/p4/tests', timeout: 120000, use: { actionTimeout: 12000 }, expect: { timeout: 10000 } });
