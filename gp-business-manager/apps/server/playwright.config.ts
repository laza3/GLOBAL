import { defineConfig } from '@playwright/test';
// PW_CHROMIUM : chemin d'un Chromium déjà installé (environnements sans accès au téléchargement)
const executablePath = process.env.PW_CHROMIUM;
export default defineConfig({ testDir: 'e2e', timeout: 120_000, workers: 1, reporter: 'list', use: { trace: 'off', actionTimeout: 15_000, launchOptions: { executablePath, args: ['--no-sandbox'] } } });
