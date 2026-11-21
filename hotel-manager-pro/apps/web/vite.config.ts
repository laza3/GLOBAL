import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// L'interface appelle l'API en même origine (/api) : les cookies de session restent « SameSite » et aucun CORS n'est nécessaire.
// En développement et en prévisualisation, Vite relaie /api vers le serveur d'API (API_URL, défaut http://127.0.0.1:3000).
const api = { '/api': { target: process.env.API_URL ?? 'http://127.0.0.1:3000', changeOrigin: false } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5173, proxy: api },
  preview: { host: '127.0.0.1', port: 4173, proxy: api },
  build: {
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Les bibliothèques volumineuses sont isolées : elles se mettent en cache indépendamment du code de l'application
        advancedChunks: {
          groups: [
            // Chemins pnpm : node_modules/.pnpm/<paquet>@<version>/node_modules/<paquet>/… — d'où le préfixe optionnel
            { name: 'react', test: /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react|react-dom|scheduler)[\\/]/ },
            { name: 'radix', test: /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:radix-ui|@radix-ui[\\/][^\\/]+|cmdk)[\\/]/ },
            { name: 'router-query', test: /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react-router|@tanstack[\\/][^\\/]+)[\\/]/ },
          ],
        },
      },
    },
  },
});
