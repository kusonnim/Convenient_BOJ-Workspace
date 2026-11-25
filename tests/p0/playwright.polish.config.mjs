import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'polish.spec.mjs', workers: 1, retries: 0, timeout: 100_000, reporter: 'list' });
