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
    // `node` é o padrão porque a maior parte da suíte toca SQLite nativo e
    // Postgres. Teste de componente opta por jsdom com o docblock
    // `// @vitest-environment jsdom` no topo do arquivo.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/support/setupDom.ts'],
    // Os testes de Postgres sobem uma instância PGlite (WASM) no beforeAll, o que
    // pode passar dos 10s padrão quando dois arquivos inicializam em paralelo.
    hookTimeout: 30_000,
  },
})
