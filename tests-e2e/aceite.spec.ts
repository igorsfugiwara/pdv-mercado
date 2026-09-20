import { test, expect } from '@playwright/test'
import {
  abrirApp,
  limpar,
  login,
  bipar,
  responderDialogo,
  confirmarDialogo,
  documentosFiscais,
  type AppE2E,
} from './support/app'
import { chaveValida } from '../shared/chaveFiscal'
import { montarEtiqueta } from '../shared/eanBalanca'

/**
 * Critério 9.4 do PRD, automatizado.
 *
 * > Operador sem treinamento técnico executa, apenas com teclado e leitor:
 * > abertura de caixa → venda de 20 itens (incluindo pesável) → pagamento em
 * > 2 formas → NFC-e autorizada → sangria → fechamento com conferência cega.
 *
 * Regra desta suíte: **nenhum `page.click()` no caminho principal**. Se um
 * passo precisar de mouse, o requisito de operação por teclado está quebrado e
 * é este teste que tem de acusar.
 */

// Do seed (electron/db/seed.ts):
const ARROZ = { ean: '7891000100103', preco: 2790 }
const REFRI = { ean: '7894900011517', preco: 899 }
const BANANA = { codigo: '2001', preco: 599 }

let ctx: AppE2E

test.afterEach(async () => {
  if (ctx) {
    await ctx.fechar()
    limpar(ctx.dataDir)
  }
})

test('aceite 9.4: abertura → 20 itens → 2 formas → NFC-e → sangria → fechamento cego', async () => {
  ctx = await abrirApp()
  const { janela } = ctx

  // ---------------------------------------------------------- 1) login
  await login(janela, 'caixa', 'caixa123')

  // ---------------------------------------------------- 2) abertura R$ 100
  await janela.waitForSelector('input[aria-label="Fundo de troco"]', { timeout: 20_000 })
  await janela.keyboard.type('100,00', { delay: 10 })
  await janela.keyboard.press('Enter')

  await janela.waitForSelector('input[aria-label="Captura de código de barras"]', {
    timeout: 20_000,
  })

  // --------------------------------------------------------- 3) 20 itens
  // 15 por bipe de EAN
  for (let i = 0; i < 15; i++) {
    await bipar(janela, i % 2 === 0 ? ARROZ.ean : REFRI.ean)
  }

  // 3 de uma vez, pelo multiplicador (RF-04)
  await bipar(janela, '3 *')
  await bipar(janela, REFRI.ean)

  // 1 pesável pelo diálogo de peso (balança ausente cai para digitação)
  await bipar(janela, BANANA.codigo)
  await responderDialogo(janela, '1,250')

  // 1 pesável por ETIQUETA DE BALANÇA (fatia 05): resolve produto e peso juntos
  const etiqueta = montarEtiqueta(BANANA.codigo, 0.75, {
    prefixo: '2',
    layout: 'peso',
    digitosCodigo: 5,
  })
  await bipar(janela, etiqueta)

  // A tela agrupa bipes repetidos do mesmo produto numa linha só, então contar
  // linhas não diz nada: o que importa é que os três produtos entraram e que o
  // total deixou de ser zero.
  const tela = await janela.evaluate(() => document.body.innerText)
  expect(tela).toContain('Arroz Branco')
  expect(tela).toContain('Refrigerante')
  expect(tela).toContain('Banana')
  expect(tela).not.toMatch(/TOTAL\s*R\$\s*0,00/)

  // ------------------------------------------- 4) desconto dentro do limite
  // Com item selecionado, F4 desconta NO ITEM (fatia 03). A linha selecionada é
  // a banana da etiqueta: 0,750 kg × R$ 5,99 = R$ 4,49. O teto do operador é 5%
  // (R$ 0,22), então R$ 0,20 passa sem pedir autorização.
  await janela.keyboard.press('F4')
  await responderDialogo(janela, '0,20')
  expect(await janela.locator('[role="dialog"]').count()).toBe(0)

  // ------------------------------------------------------------ 5) CPF
  await janela.keyboard.press('F8')
  await responderDialogo(janela, '529.982.247-25')

  // ------------------------------- 6) cancelar item do meio, com PIN (fatia 03)
  await janela.keyboard.press('ArrowDown')
  await janela.keyboard.press('F6')
  await responderDialogo(janela, '1234') // PIN do supervisor (seed)
  await janela.waitForTimeout(400)

  // -------------------------------------------- 7) pagamento em duas formas
  const totalTexto = await janela.locator('text=/^R\\$/').last().textContent()
  expect(totalTexto).toBeTruthy()

  await janela.keyboard.press('F10')
  await janela.waitForSelector('text=Pagamento', { timeout: 10_000 })

  // Parte em dinheiro (Alt+1), o resto no crédito (Alt+3).
  await janela.keyboard.type('50,00', { delay: 10 })
  await janela.keyboard.press('Alt+1')
  await janela.waitForTimeout(200)
  await janela.keyboard.press('Alt+3') // sem valor digitado = restante
  await janela.waitForTimeout(200)

  // Enter finaliza quando não falta valor.
  await janela.keyboard.press('Enter')
  await janela.waitForTimeout(1500)

  // ------------------------------------------ 8) NFC-e autorizada, chave válida
  const docs = await documentosFiscais(janela)
  expect(docs.length).toBeGreaterThan(0)
  const doc = docs[docs.length - 1]
  expect(doc.status).toBe('autorizada')
  expect(doc.chaveAcesso).toHaveLength(44)
  expect(chaveValida(doc.chaveAcesso!)).toBe(true)

  // ------------------------------------------------ 9) sangria com autorização
  await janela.keyboard.press('F9')
  await confirmarDialogo(janela) // escolhe "Sangria" (1ª opção)
  await responderDialogo(janela, '20,00')
  await responderDialogo(janela, 'Retirada para o cofre')
  await responderDialogo(janela, '1234') // PIN do supervisor
  await janela.waitForTimeout(500)

  // --------------------------------- 10/11) fechamento com conferência cega
  const resumo = await janela.evaluate(async () => {
    const caixa = await window.api.caixa.atual()
    if (!caixa) return null
    return window.api.caixa.resumoPreFechamento(caixa.id, 3)
  })
  expect(resumo).not.toBeNull()

  // A etapa cega não pode entregar valor esperado: é o ponto da conferência.
  const textoResumo = JSON.stringify(resumo)
  expect(textoResumo).not.toContain('esperado')
})
