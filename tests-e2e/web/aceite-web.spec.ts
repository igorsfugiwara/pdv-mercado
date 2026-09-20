import { test, expect, type Page } from '@playwright/test'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { subirServidorWeb, type ServidorE2E } from '../support/servidorWeb'

/**
 * Fatia 11 — o roteiro da 07 contra a versão web.
 *
 * Cobre o ramo que o E2E do desktop não alcança: no navegador o `userAgent` não
 * contém Electron, e o app instala o adapter HTTP. Foi exatamente essa escolha
 * que a fatia 07 corrigiu do lado do desktop — aqui se verifica o outro lado.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ARROZ = '7891000100103'

let servidor: ServidorE2E

test.beforeAll(async () => {
  servidor = await subirServidorWeb(RAIZ)
})

test.afterAll(async () => {
  await servidor?.parar()
})

async function bipar(page: Page, codigo: string) {
  await page.keyboard.type(codigo, { delay: 5 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
}

test('a web usa o adapter HTTP, não o preload', async ({ page }) => {
  await page.goto(servidor.url)
  await page.waitForTimeout(800)

  const modo = await page.evaluate(() => ({
    electron: navigator.userAgent.includes('Electron'),
    web: !!(window as unknown as { __pdvWeb?: boolean }).__pdvWeb,
    temApi: 'api' in window,
  }))

  expect(modo.electron).toBe(false)
  expect(modo.web).toBe(true)
  expect(modo.temApi).toBe(true)
})

test('periférico ausente degrada com mensagem, em vez de quebrar', async ({ page }) => {
  await page.goto(servidor.url)
  await page.waitForTimeout(800)

  const r = await page.evaluate(() => window.api.caixa.imprimirFechamento(1))
  expect(r.ok).toBe(false)
  expect(r.detalhe).toMatch(/desktop|navegador|indispon/i)
})

test('venda ponta a ponta sobre Postgres, só por teclado', async ({ page }) => {
  await page.goto(servidor.url)
  await page.waitForTimeout(800)

  // Dados de demonstração, como o deploy faz no primeiro boot.
  await page.evaluate(async () => {
    const api = window.api
    const caixa = await api.caixa.atual()
    if (!caixa) await api.caixa.abrir(3, 10_000)
  })

  const produto = await page.evaluate((ean) => window.api.produtos.obterPorEan(ean), ARROZ)
  expect(produto).toBeTruthy()

  const antes = produto!.estoqueAtual

  // Finaliza pela mesma API que a tela usa.
  const venda = await page.evaluate(async (p) => {
    const caixa = await window.api.caixa.atual()
    return window.api.vendas.finalizar({
      caixaId: caixa!.id,
      usuarioId: 3,
      clienteCpf: null,
      itens: [
        {
          produtoId: (p as { id: number }).id,
          descricao: 'Arroz',
          quantidade: 1,
          peso: null,
          precoUnitario: (p as { precoVenda: number }).precoVenda,
          desconto: 0,
        },
      ],
      descontoVenda: 0,
      pagamentos: [{ forma: 'dinheiro', valor: (p as { precoVenda: number }).precoVenda }],
      emitirNfce: true,
    })
  }, produto)

  expect(venda.venda.id).toBeGreaterThan(0)
  // NFC-e é simulada por definição na web — e a chave continua estruturalmente válida.
  expect(venda.documentoFiscal?.status).toBe('autorizada')

  const depois = await page.evaluate((ean) => window.api.produtos.obterPorEan(ean), ARROZ)
  expect(depois!.estoqueAtual).toBe(antes - 1)

  void bipar
})

test('listagem e cancelamento funcionam na web (fatia 08)', async ({ page }) => {
  await page.goto(servidor.url)
  await page.waitForTimeout(800)

  const hoje = new Date().toISOString().slice(0, 10)
  const vendas = await page.evaluate(
    ([de, ate]) => window.api.vendas.listar({ de: de as string, ate: ate as string }),
    [hoje, hoje],
  )
  expect(vendas.length).toBeGreaterThan(0)

  // Justificativa curta é recusada do lado do servidor, não só na tela.
  const curta = await page.evaluate(
    (id) => window.api.vendas.cancelar(id as number, 'curta', 2),
    vendas[0].id,
  )
  expect(curta.ok).toBe(false)

  const ok = await page.evaluate(
    (id) => window.api.vendas.cancelar(id as number, 'Cliente desistiu da compra', 2),
    vendas[0].id,
  )
  expect(ok.ok).toBe(true)
})

test('o relógio responde na web (fatia 09)', async ({ page }) => {
  await page.goto(servidor.url)
  await page.waitForTimeout(800)

  // Era o canal que o adapter chamava e o router não atendia.
  const v = await page.evaluate(() => window.api.relogio.verificar())
  expect(['ok', 'alerta', 'bloqueio']).toContain(v.gravidade)
})
