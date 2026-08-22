import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Os testes de Postgres sobem uma instância PGlite (WASM) no beforeAll, o que
    // pode passar dos 10s padrão quando dois arquivos inicializam em paralelo.
    hookTimeout: 30_000,
  },
})
