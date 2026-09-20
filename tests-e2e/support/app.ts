import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// O projeto é ESM: não há __dirname.
const AQUI = dirname(fileURLToPath(import.meta.url))

/**
 * Sobe o app desktop com um banco descartável.
 *
 * Cada execução começa de um `PDV_DATA_DIR` próprio, recém-criado. Teste que
 * depende de estado prévio passa na máquina de quem escreveu e falha no CI —
 * e no caso de um PDV, poderia apagar o banco de quem estava trabalhando.
 */

export interface AppE2E {
  app: ElectronApplication
  janela: Page
  dataDir: string
  fechar(): Promise<void>
  /** Fecha e reabre no MESMO diretório — é o que reproduz queda de energia. */
  reabrir(): Promise<AppE2E>
}

export interface OpcoesApp {
  /** Reaproveita um diretório existente, em vez de criar um novo. */
  dataDir?: string
}

export async function abrirApp(opcoes: OpcoesApp = {}): Promise<AppE2E> {
  const dataDir = opcoes.dataDir ?? mkdtempSync(join(tmpdir(), 'pdv-e2e-'))
  const raiz = join(AQUI, '..', '..')

  const app = await electron.launch({
    args: [
      raiz,
      // O sandbox SUID do Chromium exige binário root:4755; em container e em
      // CI isso não existe, e é a mesma flag com que o app roda em dev.
      '--no-sandbox',
    ],
    env: {
      ...process.env,
      PDV_DATA_DIR: dataDir,
      NODE_ENV: 'test',
    },
  })

  const janela = await app.firstWindow()
  await janela.waitForLoadState('domcontentloaded')

  const instancia: AppE2E = {
    app,
    janela,
    dataDir,
    async fechar() {
      await app.close()
    },
    async reabrir() {
      await app.close()
      return abrirApp({ ...opcoes, dataDir })
    },
  }
  return instancia
}

/** Apaga o diretório temporário. Chamar no fim de cada arquivo de teste. */
export function limpar(dataDir: string) {
  rmSync(dataDir, { recursive: true, force: true })
}

// ------------------------------------------------------------------ teclado

/**
 * Simula o leitor de código de barras, que é um teclado: digitação rápida
 * seguida de Enter.
 *
 * `fill()` não serve — ele não passa pelo caminho de captura por digitação que
 * a CaixaScreen implementa (RF-01), e é justamente esse caminho que precisa de
 * cobertura.
 */
export async function bipar(janela: Page, codigo: string) {
  await janela.keyboard.type(codigo, { delay: 5 })
  await janela.keyboard.press('Enter')
  await janela.waitForTimeout(120)
}

/** Digita num diálogo aberto e confirma com Enter. */
export async function responderDialogo(janela: Page, texto: string) {
  await janela.waitForSelector('[role="dialog"]', { timeout: 10_000 })
  // Garante que o campo do diálogo tem o foco antes de digitar. O Dialogo foca
  // no efeito de montagem; sem esperar por isso, a digitação escapa para o
  // campo de captura por trás e vira "produto não encontrado".
  await janela.waitForFunction(
    () => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement),
    { timeout: 5_000 },
  )
  await janela.keyboard.type(texto, { delay: 10 })
  await janela.keyboard.press('Enter')
  await janela.waitForTimeout(250)
}

/** Confirma um diálogo sem digitar nada (confirmação/escolha). */
export async function confirmarDialogo(janela: Page) {
  await janela.waitForSelector('[role="dialog"]', { timeout: 10_000 })
  await janela.keyboard.press('Enter')
  await janela.waitForTimeout(150)
}

export async function login(janela: Page, usuario: string, senha: string) {
  await janela.waitForSelector('input', { timeout: 20_000 })
  const campos = janela.locator('input')
  await campos.nth(0).fill(usuario)
  await campos.nth(1).fill(senha)
  await janela.keyboard.press('Enter')
}

/**
 * Injeta falha no provider fiscal simulado.
 *
 * Passa pelo mesmo canal que a tela de configuração usa — nada de gancho de
 * teste no código de produção. Exige sessão de Admin, como a regra manda.
 */
export async function definirFalhaFiscal(
  janela: Page,
  modo: 'nenhuma' | 'timeout' | 'rejeicao',
) {
  await janela.evaluate(
    (m) => window.api.fiscal.definirModoFalha(m as 'nenhuma' | 'timeout' | 'rejeicao'),
    modo,
  )
}

/** Estado do módulo fiscal, para o teste conferir o que o app está usando. */
export async function estadoFiscal(janela: Page) {
  return janela.evaluate(() => window.api.fiscal.estado())
}

/** Documentos fiscais gravados — a prova de que a venda existiu. */
export async function documentosFiscais(janela: Page) {
  return janela.evaluate(() => window.api.fiscal.listarDocumentos())
}
