import { test, expect } from '@playwright/test'
import { abrirApp, limpar, login, bipar, type AppE2E } from './support/app'

/**
 * Fatia 08 ponta a ponta: vender, achar a venda na tela nova e cancelar —
 * conferindo que o estoque volta e a NFC-e é cancelada.
 */
const ARROZ = '7891000100103'
let ctx: AppE2E

test.afterEach(async () => {
  if (ctx) {
    await ctx.fechar()
    limpar(ctx.dataDir)
  }
})

test('vender, cancelar pela tela de vendas e conferir estoque e NFC-e', async () => {
  ctx = await abrirApp()
  const { janela } = ctx

  await login(janela, 'admin', 'admin123')
  await janela.waitForSelector('text=Painel', { timeout: 20_000 })
  await janela.keyboard.press('F1')
  await janela.waitForSelector('input[aria-label="Fundo de troco"]', { timeout: 20_000 })
  await janela.keyboard.type('100,00', { delay: 10 })
  await janela.keyboard.press('Enter')
  await janela.waitForSelector('input[aria-label="Captura de código de barras"]', {
    timeout: 20_000,
  })

  const estoqueAntes = await janela.evaluate(async () => {
    const p = await window.api.produtos.obterPorEan('7891000100103')
    return p!.estoqueAtual
  })

  await bipar(janela, ARROZ)
  await janela.keyboard.press('F10')
  await janela.waitForSelector('text=Pagamento', { timeout: 10_000 })
  await janela.keyboard.press('Alt+1')
  await janela.waitForTimeout(200)
  await janela.keyboard.press('Enter')
  await janela.waitForTimeout(1500)

  // A venda existe e a NFC-e foi autorizada.
  const antes = await janela.evaluate(() => {
    const hoje = new Date().toISOString().slice(0, 10)
    return window.api.vendas.listar({ de: hoje, ate: hoje })
  })
  expect(antes).toHaveLength(1)
  expect(antes[0].documentoStatus).toBe('autorizada')

  // Cancela pelo mesmo caminho que a tela usa.
  const auth = await janela.evaluate(() => window.api.auth.autorizarSupervisor('1234'))
  expect(auth.ok).toBe(true)

  const r = await janela.evaluate(
    ([id, autorizador]) =>
      window.api.vendas.cancelar(
        id as number,
        'Cliente desistiu da compra no caixa',
        autorizador as number,
      ),
    [antes[0].id, auth.usuario!.id],
  )
  expect(r.ok).toBe(true)
  expect(r.fiscal).toBe('cancelada')

  const depois = await janela.evaluate(async () => {
    const hoje = new Date().toISOString().slice(0, 10)
    const vendas = await window.api.vendas.listar({ de: hoje, ate: hoje })
    const p = await window.api.produtos.obterPorEan('7891000100103')
    return { status: vendas[0].status, doc: vendas[0].documentoStatus, estoque: p!.estoqueAtual }
  })

  expect(depois.status).toBe('cancelada')
  expect(depois.doc).toBe('cancelada')
  expect(depois.estoque).toBe(estoqueAntes) // estoque de volta
})
