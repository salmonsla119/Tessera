import { defineConfig } from 'vite';

export default defineConfig({
  // 상대 경로로 빌드해 두면 GitHub Pages의 하위 경로(/Tessera/)에서도 그대로 동작한다.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
});
