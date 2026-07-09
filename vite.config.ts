import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import renderer from 'vite-plugin-electron-renderer'

// Renderer (React) + Electron main/preload build orchestration.
// Native modules (better-sqlite3, koffi, serialport, argon2, node-thermal-printer)
// run ONLY in the main process and are marked external so Vite never bundles them.
const nativeMainDeps = [
  'better-sqlite3',
  'koffi',
  'serialport',
  'argon2',
  'node-thermal-printer',
  'electron-log',
  'drizzle-orm',
]

// Aliases precisam ser replicados nos sub-builds do main/preload (não herdam do root).
const alias = {
  '@': resolve(__dirname, 'src'),
  '@shared': resolve(__dirname, 'shared'),
}

export default defineConfig({
  resolve: { alias },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          resolve: { alias },
          build: {
            outDir: 'dist-electron',
            rollupOptions: { external: nativeMainDeps },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          resolve: { alias },
          build: {
            outDir: 'dist-electron',
            rollupOptions: { external: nativeMainDeps },
          },
        },
      },
    }),
    // Allows using Node/Electron built-ins from the renderer only where whitelisted.
    renderer(),
  ],
  build: {
    outDir: 'dist',
  },
})
