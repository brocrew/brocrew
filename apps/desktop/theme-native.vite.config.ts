import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/theme-native',
      lib: { entry: 'test/themes/native-pictures.smoke.ts' },
      rollupOptions: { external: ['electron'] },
    },
  },
})
