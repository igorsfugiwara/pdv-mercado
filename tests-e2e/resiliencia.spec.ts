import { test, expect } from '@playwright/test'
import {
  abrirApp,
  limpar,
  login,
  bipar,
  definirFalhaFiscal,
  documentosFiscais,
  type AppE2E,
} from './support/app'

/**
 * Seção 9.2 do PRD — o que dá para automatizar sem hardware.
 *
 * Disco cheio, papel acabando e balança desconectada continuam manuais, em
 * `docs/TESTES_HARDWARE.md`.
 */
const ARROZ = '7891000100103'

let ctx: AppE2E

test.afterEach(async () => {
  if (ctx) {
    await ctx.fechar()
    limpar(ctx.dataDir)
  }
})

/** Login + abertura de caixa, que todo roteiro precisa. */
async function abrirCaixa(c: AppE2E, usuario = 'caixa', senha = 'caixa123') {
  await login(c.janela, usuario, senha)
  await c.janela.waitForSelector('input[aria-label="Fundo de troco"]', { timeout: 20_000 })
  await c.janela.keyboard.type('100,00', { delay: 10 })
  await c.janela.keyboard.press('Enter')
  await c.janela.waitForSelector('input[aria-label="Captura de código de barras"]', {
    timeout: 20_000,
  })
}

/** Finaliza em dinheiro pelo teclado. */
async function pagarEmDinheiro(c: AppE2E) {
  await c.janela.keyboard.press('F10')
  await c.janela.waitForSelector('text=Pagamento', { timeout: 10_000 })
  await c.janela.keyboard.press('Alt+1') // sem valor digitado = restante
  await c.janela.waitForTimeout(200)
  await c.janela.keyboard.press('Enter')
  await c.janela.waitForTimeout(1500)
}

test('queda no meio da venda: o rascunho volta com os mesmos itens', async () => {
  ctx = await abrirApp()
  await abrirCaixa(ctx)

  await bipar(ctx.janela, ARROZ)
  await bipar(ctx.janela, ARROZ)
  await ctx.janela.waitForTimeout(600) // o rascunho é persistido a cada mudança

  // Mata o processo sem finalizar — é o que reproduz a queda de energia, com o
  // WAL do SQLite no estado real.
  ctx = await ctx.reabrir()

  await login(ctx.janela, 'caixa', 'caixa123')
  await ctx.janela.waitForSelector('input[aria-label="Captura de código de barras"]', {
    timeout: 20_000,
  })
  await ctx.janela.waitForTimeout(800)

  const tela = await ctx.janela.evaluate(() => document.body.innerText)
  expect(tela).toContain('Arroz Branco')
})

test('impressora ausente: a venda finaliza e o documento é gravado', async () => {
  // Não há impressora térmica nesta máquina — é exatamente o cenário.
  ctx = await abrirApp()
  await abrirCaixa(ctx)
  await bipar(ctx.janela, ARROZ)
  await pagarEmDinheiro(ctx)

  const docs = await documentosFiscais(ctx.janela)
  expect(docs.length).toBe(1)
  expect(docs[0].status).toBe('autorizada')
})

test('SEFAZ em timeout: a venda persiste e o documento fica em contingência', async () => {
  ctx = await abrirApp()
  // Trocar o modo de falha exige Admin — é a regra da fatia 01, respeitada aqui.
  await login(ctx.janela, 'admin', 'admin123')
  // Admin cai no painel (fatia 06); F1 leva ao caixa, como o menu anuncia.
  await ctx.janela.waitForSelector('text=Painel', { timeout: 20_000 })
  await definirFalhaFiscal(ctx.janela, 'timeout')
  await ctx.janela.keyboard.press('F1')
  await ctx.janela.waitForSelector('input[aria-label="Fundo de troco"]', { timeout: 20_000 })

  await ctx.janela.keyboard.type('100,00', { delay: 10 })
  await ctx.janela.keyboard.press('Enter')
  await ctx.janela.waitForSelector('input[aria-label="Captura de código de barras"]', {
    timeout: 20_000,
  })

  await bipar(ctx.janela, ARROZ)
  await pagarEmDinheiro(ctx)

  const docs = await documentosFiscais(ctx.janela)
  expect(docs.length).toBe(1)
  expect(docs[0].status).toBe('contingencia_pendente')

  // A venda existe no banco — invariante 1: falha fiscal não desfaz venda.
  const vendas = await ctx.janela.evaluate(() =>
    window.api.relatorios.vendas({
      de: new Date().toISOString().slice(0, 10),
      ate: new Date().toISOString().slice(0, 10),
    }),
  )
  expect(vendas.resumo.quantidadeVendas).toBe(1)
})

test('SEFAZ rejeitando: documento rejeitado com motivo, venda mantida', async () => {
  ctx = await abrirApp()
  await login(ctx.janela, 'admin', 'admin123')
  // Admin cai no painel (fatia 06); F1 leva ao caixa, como o menu anuncia.
  await ctx.janela.waitForSelector('text=Painel', { timeout: 20_000 })
  await definirFalhaFiscal(ctx.janela, 'rejeicao')
  await ctx.janela.keyboard.press('F1')
  await ctx.janela.waitForSelector('input[aria-label="Fundo de troco"]', { timeout: 20_000 })

  await ctx.janela.keyboard.type('100,00', { delay: 10 })
  await ctx.janela.keyboard.press('Enter')
  await ctx.janela.waitForSelector('input[aria-label="Captura de código de barras"]', {
    timeout: 20_000,
  })

  await bipar(ctx.janela, ARROZ)
  await pagarEmDinheiro(ctx)

  const docs = await documentosFiscais(ctx.janela)
  expect(docs.length).toBe(1)
  expect(docs[0].status).toBe('rejeitada')
  expect(docs[0].motivoRejeicao).toBeTruthy()

  const vendas = await ctx.janela.evaluate(() =>
    window.api.relatorios.vendas({
      de: new Date().toISOString().slice(0, 10),
      ate: new Date().toISOString().slice(0, 10),
    }),
  )
  expect(vendas.resumo.quantidadeVendas).toBe(1)
})

test('fechar caixa com venda em espera é bloqueado', async () => {
  ctx = await abrirApp()
  await abrirCaixa(ctx)

  await bipar(ctx.janela, ARROZ)
  await ctx.janela.keyboard.press('F7') // coloca em espera
  await ctx.janela.waitForTimeout(600)

  const resultado = await ctx.janela.evaluate(async () => {
    const caixa = await window.api.caixa.atual()
    if (!caixa) return null
    return window.api.caixa.resumoPreFechamento(caixa.id, 3)
  })

  // O resumo pré-fechamento acusa a pendência em vez de deixar fechar.
  expect(JSON.stringify(resultado)).toMatch(/espera|bloqueio|pendenc/i)
})
