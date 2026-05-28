import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, '../../packages/shared/src'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      sourcemap: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, '../../packages/shared/src'),
      },
    },
  },
})
