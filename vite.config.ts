import { defineConfig, type PluginOption } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

// Dois alvos a partir do MESMO renderer:
//   · desktop (padrão) → React + build do main/preload do Electron;
//   · web (PDV_TARGET=web) → só o SPA estático, servido pela Vercel com /api.
//
// Os plugins do Electron entram por import dinâmico de propósito: no build da
// Vercel eles não estão instalados (ver `optionalDependencies` no package.json),
// e um import estático quebraria o carregamento deste arquivo.

// Módulos nativos rodam SÓ no processo main — marcados external p/ o Vite não empacotar.
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

export default defineConfig(async () => {
  const alvoWeb = process.env.PDV_TARGET === 'web'
  const plugins: PluginOption[] = [react()]

  if (!alvoWeb) {
    const { default: electron } = await import('vite-plugin-electron/simple')
    const { default: renderer } = await import('vite-plugin-electron-renderer')
    plugins.push(
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
      // Permite built-ins do Node/Electron no renderer onde explicitamente liberado.
      renderer(),
    )
  }

  return {
    resolve: { alias },
    plugins,
    build: { outDir: 'dist' },
  }
})
