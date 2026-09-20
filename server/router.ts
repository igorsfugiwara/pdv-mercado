import { eq } from 'drizzle-orm'
import { IPC } from '@shared/ipc'
import type { ProdutoInput, RelatorioVendasFiltro } from '@shared/ipc'
import type {
  FinalizarVendaInput,
  StatusDocumentoFiscal,
  ResultadoFechamento,
} from '@shared/types'
import { RASCUNHO_ID } from '@shared/types'
import { getDb } from './db'
import { vendasEspera } from './schema.pg'
import { usuariosRepo } from './repos/usuarios.repo'
import { produtosRepo, faltamCamposFiscais } from './repos/produtos.repo'
import { caixaRepo } from './repos/caixa.repo'
import { estoqueRepo } from './repos/estoque.repo'
import { fiscalRepo } from './repos/fiscal.repo'
import { configRepo } from './repos/config.repo'
import {
  podeAutorizar,
  LIMITES_PADRAO,
  CHAVES_LIMITE,
  type LimitesDesconto,
} from '@shared/autorizacao'
import { auditoriaRepo } from './repos/auditoria.repo'
import { relatoriosRepo } from './repos/relatorios.repo'
import { vendasRepo } from './repos/vendas.repo'
import { finalizarVenda, reprocessarContingencia } from './vendaService'
import { importarProdutosCsvTexto } from './csvImport'
import { getFiscalProvider } from './fiscal.web'

// Limite padrão de diferença de caixa sem justificativa: R$ 10,00 (RF-11).
const LIMITE_DIFERENCA_PADRAO = 1000

/** Efeito de sessão que o handler HTTP traduz em Set-Cookie. */
export type EfeitoSessao = { tipo: 'entrar'; usuarioId: number } | { tipo: 'sair' }

export interface Contexto {
  /** Id do usuário autenticado pelo cookie, ou null. */
  usuarioId: number | null
  /** Preenchido pelo handler quando a chamada muda a sessão. */
  efeito?: EfeitoSessao
}

// `args: any` (e não `any[]`): cada handler abaixo desestrutura uma tupla com
// aridade própria, e o TS recusaria `any[]` como origem para tuplas de tamanho fixo.
type Handler = (args: any, ctx: Contexto) => unknown

/**
 * Porte web dos `ipcMain.handle` do desktop (`electron/ipc/handlers.ts`),
 * indexado pelos MESMOS canais de `shared/ipc.ts` — o contrato continua sendo
 * fonte única para desktop, servidor e cliente.
 */
/** Limites de desconto por perfil, com o padrão quando não há configuração. */
async function lerLimitesDesconto(): Promise<LimitesDesconto> {
  const lido = async (chave: string, padrao: number) => {
    const v = await configRepo.obter(chave)
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : padrao
  }
  return {
    operador: await lido(CHAVES_LIMITE.operador, LIMITES_PADRAO.operador),
    supervisor: await lido(CHAVES_LIMITE.supervisor, LIMITES_PADRAO.supervisor),
    admin: await lido(CHAVES_LIMITE.admin, LIMITES_PADRAO.admin),
  }
}

const handlers: Record<string, Handler> = {
  // ---- Auth (RF-19/20) ----
  [IPC.auth.login]: async ([login, senha]: [string, string], ctx) => {
    const usuario = await usuariosRepo.porLogin(login, senha)
    if (!usuario) return { ok: false, erro: 'Credenciais inválidas.' }
    ctx.efeito = { tipo: 'entrar', usuarioId: usuario.id }
    await auditoriaRepo.registrar(usuario.id, 'login', { login })
    return { ok: true, usuario }
  },

  [IPC.auth.trocarOperador]: async ([pin]: [string], ctx) => {
    const usuario = await usuariosRepo.porPin(pin)
    if (!usuario) return { ok: false, erro: 'PIN inválido.' }
    ctx.efeito = { tipo: 'entrar', usuarioId: usuario.id }
    await auditoriaRepo.registrar(usuario.id, 'troca_operador')
    return { ok: true, usuario }
  },

  [IPC.auth.autorizarSupervisor]: async ([pin]: [string]) => {
    const usuario = await usuariosRepo.porPin(pin, ['admin', 'supervisor'])
    return usuario ? { ok: true, usuario } : { ok: false }
  },

  // Mesma regra do desktop: PIN **e** alçada, verificados no servidor.
  [IPC.auth.autorizarDesconto]: async ([pin, descontoBps]: [string, number], ctx) => {
    const usuario = await usuariosRepo.porPin(pin, ['admin', 'supervisor'])
    if (!usuario) return { ok: false, motivo: 'PIN sem permissão para autorizar desconto.' }

    const veredito = podeAutorizar(usuario.perfil, descontoBps, await lerLimitesDesconto())
    if (!veredito.ok) return { ok: false, motivo: veredito.motivo }

    await auditoriaRepo.registrar(ctx.usuarioId, 'desconto_autorizar', {
      descontoBps,
      autorizadoPorId: usuario.id,
    })
    return { ok: true, usuario }
  },

  // Auditoria é append-only: o contrato só expõe registrar.
  [IPC.auditoria.registrar]: async (
    [acao, detalhe]: [string, Record<string, unknown>?],
    ctx,
  ) => {
    await auditoriaRepo.registrar(ctx.usuarioId, acao, detalhe)
  },

  [IPC.auth.logout]: async (_args, ctx) => {
    ctx.efeito = { tipo: 'sair' }
  },

  // ---- Produtos (RF-14/15/18.1) ----
  [IPC.produtos.listar]: ([incluirInativos]: [boolean?]) => produtosRepo.listar(incluirInativos),
  [IPC.produtos.buscar]: ([termo]: [string]) => produtosRepo.buscar(termo),
  [IPC.produtos.obterPorEan]: ([ean]: [string]) => produtosRepo.porEan(ean),
  [IPC.produtos.obterPorCodigoInterno]: ([codigo]: [string]) =>
    produtosRepo.porCodigoInterno(codigo),
  [IPC.produtos.listarGrupos]: () => produtosRepo.listarGrupos(),

  [IPC.produtos.salvar]: async ([input]: [ProdutoInput], ctx) => {
    if (input.ativo && faltamCamposFiscais(input).length > 0) {
      throw new Error('Campos fiscais obrigatórios ausentes para ativar o produto.')
    }
    const p = await produtosRepo.salvar(input)
    await auditoriaRepo.registrar(ctx.usuarioId, 'produto_salvar', { id: p.id })
    return p
  },

  [IPC.produtos.inativar]: async ([id, usuarioId]: [number, number]) => {
    await produtosRepo.setAtivo(id, false)
    await auditoriaRepo.registrar(usuarioId, 'produto_inativar', { id })
  },

  [IPC.produtos.reativar]: async ([id, usuarioId]: [number, number]) => {
    await produtosRepo.setAtivo(id, true)
    await auditoriaRepo.registrar(usuarioId, 'produto_reativar', { id })
  },

  // RF-18.1: exclusão só sem histórico; com histórico → inativa.
  [IPC.produtos.excluir]: async ([id, usuarioId]: [number, number]) => {
    if (await produtosRepo.temHistoricoVenda(id)) {
      await produtosRepo.setAtivo(id, false)
      await auditoriaRepo.registrar(usuarioId, 'produto_inativar_com_historico', { id })
      return { ok: false, motivo: 'Produto possui histórico de venda; foi inativado.' }
    }
    await produtosRepo.excluir(id)
    await auditoriaRepo.registrar(usuarioId, 'produto_excluir', { id })
    return { ok: true }
  },

  // Na web o argumento é o CONTEÚDO do CSV, não um caminho (ver server/csvImport.ts).
  [IPC.produtos.importarCsv]: ([conteudo]: [string]) => importarProdutosCsvTexto(conteudo),

  // ---- Caixa (RF-11/12/13) ----
  [IPC.caixa.atual]: () => caixaRepo.atual(),
  [IPC.caixa.abrir]: ([usuarioId, valor]: [number, number]) => caixaRepo.abrir(usuarioId, valor),
  [IPC.caixa.resumoPreFechamento]: ([caixaId, usuarioId]: [number, number]) =>
    caixaRepo.resumoPreFechamento(caixaId, usuarioId),

  // RF-11: conferência cega — o esperado só é calculado depois que o contado chega.
  [IPC.caixa.fechar]: async ([caixaId, usuarioId, contado, motivo, autorizadoPorId]: [
    number,
    number,
    number,
    (string | null)?,
    (number | null)?,
  ]): Promise<ResultadoFechamento> => {
    const bloqueios = await caixaRepo.bloqueiosFechamento(caixaId, usuarioId)
    if (bloqueios.length > 0) return { status: 'bloqueado', bloqueios }

    const esperado = await caixaRepo.saldoEsperado(caixaId)
    const diferenca = contado - esperado
    const limite = Number(
      (await configRepo.obter('caixa.diferenca.limite')) ?? LIMITE_DIFERENCA_PADRAO,
    )

    // Auditoria de toda tentativa, inclusive a recusada: sem isso dá para tentar
    // valores até a diferença zerar e a conferência cega vira teatro.
    await auditoriaRepo.registrar(usuarioId, 'caixa_conferencia', { caixaId, contado, diferenca })

    if (Math.abs(diferenca) > limite && (!motivo || !autorizadoPorId)) {
      return { status: 'requer_justificativa', diferenca, limite }
    }

    await caixaRepo.fechar(caixaId, usuarioId, contado, motivo ?? null, autorizadoPorId ?? null)
    await auditoriaRepo.registrar(usuarioId, 'caixa_fechar', {
      caixaId,
      contado,
      diferenca,
      motivo: motivo ?? null,
      autorizadoPorId: autorizadoPorId ?? null,
    })
    return { status: 'fechado', relatorio: await caixaRepo.relatorioFechamento(caixaId) }
  },

  [IPC.caixa.relatorioFechamento]: ([caixaId]: [number]) =>
    caixaRepo.relatorioFechamento(caixaId),
  // imprimirFechamento não existe na web — resolvido no adapter (sem impressora).
  [IPC.caixa.movimentar]: async ([caixaId, tipo, valor, motivo, usuarioId, autorizadoPorId]: [
    number,
    'sangria' | 'suprimento',
    number,
    string,
    number,
    number,
  ]) => {
    const mov = await caixaRepo.movimentar(
      caixaId,
      tipo,
      valor,
      motivo,
      usuarioId,
      autorizadoPorId,
    )
    await auditoriaRepo.registrar(usuarioId, `caixa_${tipo}`, { valor, motivo, autorizadoPorId })
    return mov
  },

  // ---- Vendas (RF-01..10, 16, 26, 27) ----
  [IPC.vendas.finalizar]: ([input]: [FinalizarVendaInput]) => finalizarVenda(input),

  [IPC.vendas.cancelar]: async ([vendaId, usuarioId, autorizadoPorId]: [
    number,
    number,
    number,
  ]) => {
    await vendasRepo.cancelar(vendaId, usuarioId)
    await auditoriaRepo.registrar(usuarioId, 'venda_cancelar', { vendaId, autorizadoPorId })
  },

  [IPC.vendas.salvarEspera]: async ([input]: [FinalizarVendaInput]) => {
    const db = getDb()
    const id = crypto.randomUUID()
    await db
      .insert(vendasEspera)
      .values({ id, payloadJson: JSON.stringify(input), criadoEm: new Date().toISOString() })
    return { id }
  },

  [IPC.vendas.recuperarEspera]: async () => {
    const db = getDb()
    const rows = await db.select().from(vendasEspera)
    return rows
      .filter((r) => r.id !== RASCUNHO_ID)
      .map((r) => ({ id: r.id, input: JSON.parse(r.payloadJson) }))
  },

  [IPC.vendas.removerEspera]: async ([id]: [string]) => {
    const db = getDb()
    await db.delete(vendasEspera).where(eq(vendasEspera.id, id))
  },

  // Invariante 4: rascunho persistido a cada item; recuperado na reabertura.
  [IPC.vendas.salvarRascunho]: async ([input]: [FinalizarVendaInput | null]) => {
    const db = getDb()
    if (!input) {
      await db.delete(vendasEspera).where(eq(vendasEspera.id, RASCUNHO_ID))
      return
    }
    const agora = new Date().toISOString()
    await db
      .insert(vendasEspera)
      .values({ id: RASCUNHO_ID, payloadJson: JSON.stringify(input), criadoEm: agora })
      .onConflictDoUpdate({
        target: vendasEspera.id,
        set: { payloadJson: JSON.stringify(input), criadoEm: agora },
      })
  },

  [IPC.vendas.recuperarRascunho]: async () => {
    const db = getDb()
    const [row] = await db.select().from(vendasEspera).where(eq(vendasEspera.id, RASCUNHO_ID))
    return row ? (JSON.parse(row.payloadJson) as FinalizarVendaInput) : null
  },

  // ---- Estoque (RF-16/17/18) ----
  [IPC.estoque.entrada]: async ([produtoId, quantidade, usuarioId, motivo]: [
    number,
    number,
    number,
    string,
  ]) => {
    await estoqueRepo.entrada(produtoId, quantidade, usuarioId, motivo)
    await auditoriaRepo.registrar(usuarioId, 'estoque_entrada', { produtoId, quantidade, motivo })
  },
  [IPC.estoque.ajuste]: async ([produtoId, novoSaldo, usuarioId, motivo]: [
    number,
    number,
    number,
    string,
  ]) => {
    await estoqueRepo.ajuste(produtoId, novoSaldo, usuarioId)
    await auditoriaRepo.registrar(usuarioId, 'estoque_ajuste', { produtoId, novoSaldo, motivo })
  },
  [IPC.estoque.alertasMinimo]: () => estoqueRepo.alertasMinimo(),

  // ---- Fiscal (RF-24/27/28/29/30) ----
  [IPC.fiscal.statusServico]: () => getFiscalProvider().statusServico(),
  [IPC.fiscal.validarCertificado]: async () => {
    const r = await getFiscalProvider().validarCertificado()
    return { valido: r.valido, expiraEm: r.expiraEm ? r.expiraEm.toISOString() : null }
  },
  [IPC.fiscal.cancelarNfce]: async ([chave, justificativa]: [string, string], ctx) => {
    const r = await getFiscalProvider().cancelar(chave, justificativa)
    if (r.ok) {
      const doc = await fiscalRepo.porChave(chave)
      if (doc) {
        await fiscalRepo.atualizarStatus(doc.id, {
          status: 'cancelada',
          canceladaEm: new Date().toISOString(),
        })
      }
    }
    await auditoriaRepo.registrar(ctx.usuarioId, 'fiscal_cancelar', { chave })
    return r
  },
  [IPC.fiscal.inutilizar]: async ([serie, numIni, numFim, justificativa]: [
    number,
    number,
    number,
    string,
  ], ctx) => {
    await getFiscalProvider().inutilizar(serie, numIni, numFim, justificativa)
    await auditoriaRepo.registrar(ctx.usuarioId, 'fiscal_inutilizar', { serie, numIni, numFim })
  },
  [IPC.fiscal.listarDocumentos]: ([status]: [StatusDocumentoFiscal?]) => fiscalRepo.listar(status),
  [IPC.fiscal.filaContingencia]: () => fiscalRepo.listar('contingencia_pendente'),
  [IPC.fiscal.reprocessarFila]: () => reprocessarContingencia(),

  // ---- Relatórios (RF-22..25) ----
  [IPC.relatorios.vendas]: ([filtro]: [RelatorioVendasFiltro]) => relatoriosRepo.vendas(filtro),
  [IPC.relatorios.mediaDiariaProdutos]: ([de, ate]: [string, string]) =>
    relatoriosRepo.mediaDiariaPorProduto(de, ate),
  [IPC.relatorios.curvaAbc]: ([de, ate]: [string, string]) => relatoriosRepo.curvaAbc(de, ate),
  // exportarCsv é resolvido no navegador (download via Blob) — ver src/web/apiWeb.ts.

  // ---- Config ----
  [IPC.config.obter]: ([chave]: [string]) => configRepo.obter(chave),
  [IPC.config.definir]: ([chave, valor]: [string, string]) => configRepo.definir(chave, valor),
  [IPC.config.todas]: () => configRepo.todas(),
}

/** Canais liberados sem sessão. Todo o resto exige cookie válido. */
const PUBLICOS = new Set<string>([IPC.auth.login])

export async function despachar(canal: string, args: unknown[], ctx: Contexto) {
  const handler = handlers[canal]
  if (!handler) throw new HttpError(404, `Canal desconhecido: ${canal}`)
  if (!PUBLICOS.has(canal) && ctx.usuarioId === null) {
    throw new HttpError(401, 'Sessão expirada. Faça login novamente.')
  }
  return await handler(args, ctx)
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem)
  }
}
