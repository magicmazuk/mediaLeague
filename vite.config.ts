import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { devApi } from './backend/dev.js';

export default defineConfig(({ mode }) => {
  // Let `npm run dev` pick up APP_PASSWORD / DATABASE_URL from .env.local, like Vercel does from its settings.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['APP_PASSWORD', 'SESSION_SECRET', 'DATABASE_URL']) if (env[key] && !process.env[key]) process.env[key] = env[key];

  return {
    plugins: [react(), devApi()],
    base: '/',
    build: { chunkSizeWarningLimit: 1200 },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'backend/**/*.test.ts'],
    },
  };
});
