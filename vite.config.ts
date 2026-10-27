import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serve o site em /rally-arcade/, então os assets usam caminhos relativos.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    // three.js é o único chunk grande; o app em si é pequeno.
    chunkSizeWarningLimit: 650,
  },
});
