import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Relative asset paths so the build works both at a domain root
  // (username.github.io) and under a project subpath (username.github.io/repo/).
  base: './',
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
