import { test, expect } from '@playwright/test'
import { abrirApp, limpar, login } from './support/app'

// Primeiro degrau: o app sobe, o banco é o temporário, e o login funciona.
test('o app sobe num banco descartável e aceita login', async () => {
  const { janela, dataDir, fechar } = await abrirApp()
  try {
    await login(janela, 'caixa', 'caixa123')
    await expect(janela.locator('text=/abrir caixa|caixa/i').first()).toBeVisible({
      timeout: 20_000,
    })
    expect(dataDir).toContain('pdv-e2e-')
  } finally {
    await fechar()
    limpar(dataDir)
  }
})
