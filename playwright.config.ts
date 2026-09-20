import { defineConfig } from '@playwright/test'

/**
 * E2E do app desktop (Electron).
 *
 * Não há `webServer` nem `browser`: cada teste sobe o próprio Electron com
 * `_electron.launch`, apontando para um `PDV_DATA_DIR` descartável. Ver
 * `tests-e2e/support/app.ts`.
 */
export default defineConfig({
  testDir: './tests-e2e',
  // O fluxo de aceite é longo (20 itens digitados a 5ms por tecla).
  timeout: 120_000,
  expect: { timeout: 15_000 },

  // Cada worker subiria um Electron e um SQLite próprios; em série o teste é
  // mais lento e muito mais legível quando falha.
  workers: 1,
  fullyParallel: false,

  // Falhar o CI por causa de retry mascarando instabilidade é pior do que ver
  // o teste vermelho: aqui um teste instável é bug, não ruído.
  retries: 0,
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  // Dois alvos, duas suítes. `--project=web` roda só a web.
  projects: [
    { name: 'desktop', testMatch: /tests-e2e\/(?!web\/).*\.spec\.ts/ },
    { name: 'web', testMatch: /tests-e2e\/web\/.*\.spec\.ts/ },
  ],

  use: {
    // Trace só do que falhou: trace de execução verde é lixo que enche storage.
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
