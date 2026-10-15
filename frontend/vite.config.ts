import { defineConfig } from 'vite';

const backend = 'http://localhost:8000';

export default defineConfig({
  server: {
    proxy: {
      '/api': backend,
      '/r': backend,
      '/ws': { target: backend.replace('http', 'ws'), ws: true },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
