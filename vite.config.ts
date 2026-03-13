import { defineConfig } from 'vite';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

function getBuildVersion(): string {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
  const ver = pkg.version.replace(/\.0$/, ''); // "1.1.0" → "1.1"
  try {
    const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    return `v${ver}-${hash}`;
  } catch {
    return `v${ver}`;
  }
}

export default defineConfig({
  base: './',
  root: '.',
  publicDir: 'public',
  define: {
    __BUILD_VERSION__: JSON.stringify(getBuildVersion()),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor/index.html'),
      },
    },
  },
});
