import { Config } from "@remotion/cli/config";
import fs from "node:fs";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);

// Dans l'environnement cloud, on réutilise le Chromium headless déjà installé.
const localShell =
  "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
// REMOTION_CHROME : exécutable alternatif optionnel (ex. wrapper qui ajoute un proxy).
const custom = process.env.REMOTION_CHROME;
if (custom && fs.existsSync(custom)) {
  Config.setBrowserExecutable(custom);
} else if (fs.existsSync(localShell)) {
  Config.setBrowserExecutable(localShell);
}
