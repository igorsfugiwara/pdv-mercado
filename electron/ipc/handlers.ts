import { ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import log from 'electron-log'
import { IPC } from '@shared/ipc'
import { toCsv } from '@shared/csv'
import type { ProdutoInput, RelatorioVendasFiltro } from '@shared/ipc'
import type { FinalizarVendaInput, StatusDocumentoFiscal } from '@shared/types'
import { getDb } from '../db/index'
import { vendasEspera } from '../db/schema'
import { session } from './session'
import { usuariosRepo } from '../db/repositories/usuarios.repo'
import { produtosRepo, faltamCamposFiscais } from '../db/repositories/produtos.repo'
import { caixaRepo } from '../db/repositories/caixa.repo'
import { estoqueRepo } from '../db/repositories/estoque.repo'
import { fiscalRepo } from '../db/repositories/fiscal.repo'
import { configRepo } from '../db/repositories/config.repo'
import { auditoriaRepo } from '../db/repositories/auditoria.repo'
import { relatoriosRepo } from '../db/repositories/relatorios.repo'
import { vendasRepo } from '../db/repositories/vendas.repo'
import { finalizarVenda } from '../services/vendaService'
import { importarProdutosCsv } from '../services/csvImport'
import { backupAgora, exportarPara } from '../services/backup'
import { getFiscalProvider, getContingenciaQueue } from '../fiscal'
import { imprimirTeste } from '../hardware/printer'
import { lerPeso } from '../hardware/balanca'
import { abrirGaveta } from '../hardware/gaveta'

const RASCUNHO_ID = '__rascunho__'

export function registerIpc(dataDir: string) {
  const backupsDir = join(dataDir, 'backups')

  // ---- Auth (RF-19/20) ----
  ipcMain.handle(IPC.auth.login, async (_e, login: string, senha: string) => {
    const usuario = await usuariosRepo.porLogin(login, senha)
    if (!usuario) return { ok: false, erro: 'Credenciais inválidas.' }
    session.set(usuario)
    await auditoriaRepo.registrar(usuario.id, 'login', { login })
    return { ok: true, usuario }
  })

  ipcMain.handle(IPC.auth.trocarOperador, async (_e, pin: string) => {
    const usuario = await usuariosRepo.porPin(pin)
    if (!usuario) return { ok: false, erro: 'PIN inválido.' }
    session.set(usuario)
    await auditoriaRepo.registrar(usuario.id, 'troca_operador')
    return { ok: true, usuario }
  })

  ipcMain.handle(IPC.auth.autorizarSupervisor, async (_e, pin: string) => {
    const usuario = await usuariosRepo.porPin(pin, ['admin', 'supervisor'])
    return usuario ? { ok: true, usuario } : { ok: false }
  })

  ipcMain.handle(IPC.auth.logout, async () => {
    session.set(null)
  })

  // ---- Produtos (RF-14/15/18.1) ----
  ipcMain.handle(IPC.produtos.listar, (_e, incluirInativos?: boolean) =>
    produtosRepo.listar(incluirInativos),
  )
  ipcMain.handle(IPC.produtos.buscar, (_e, termo: string) => produtosRepo.buscar(termo))
  ipcMain.handle(IPC.produtos.obterPorEan, (_e, ean: string) => produtosRepo.porEan(ean))
  ipcMain.handle(IPC.produtos.listarGrupos, () => produtosRepo.listarGrupos())

  ipcMain.handle(IPC.produtos.salvar, async (_e, input: ProdutoInput) => {
    if (input.ativo && faltamCamposFiscais(input).length > 0) {
      throw new Error('Campos fiscais obrigatórios ausentes para ativar o produto.')
    }
    const p = await produtosRepo.salvar(input)
    await auditoriaRepo.registrar(session.get()?.id ?? null, 'produto_salvar', { id: p.id })
    return p
  })

  ipcMain.handle(IPC.produtos.inativar, async (_e, id: number, usuarioId: number) => {
    await produtosRepo.setAtivo(id, false)
    await auditoriaRepo.registrar(usuarioId, 'produto_inativar', { id })
  })

  ipcMain.handle(IPC.produtos.reativar, async (_e, id: number, usuarioId: number) => {
    await produtosRepo.setAtivo(id, true)
    await auditoriaRepo.registrar(usuarioId, 'produto_reativar', { id })
  })

  // RF-18.1: exclusão só sem histórico; com histórico → inativa.
  ipcMain.handle(IPC.produtos.excluir, async (_e, id: number, usuarioId: number) => {
    if (await produtosRepo.temHistoricoVenda(id)) {
      await produtosRepo.setAtivo(id, false)
      await auditoriaRepo.registrar(usuarioId, 'produto_inativar_com_historico', { id })
      return { ok: false, motivo: 'Produto possui histórico de venda; foi inativado.' }
    }
    await produtosRepo.excluir(id)
    await auditoriaRepo.registrar(usuarioId, 'produto_excluir', { id })
    return { ok: true }
  })

  ipcMain.handle(IPC.produtos.importarCsv, (_e, caminho: string) => importarProdutosCsv(caminho))

  // ---- Caixa (RF-11/12/13) ----
  ipcMain.handle(IPC.caixa.atual, () => caixaRepo.atual())
  ipcMain.handle(IPC.caixa.abrir, (_e, usuarioId: number, valor: number) =>
    caixaRepo.abrir(usuarioId, valor),
  )
  ipcMain.handle(IPC.caixa.fechar, (_e, caixaId: number, usuarioId: number, contado: number) =>
    caixaRepo.fechar(caixaId, usuarioId, contado),
  )
  ipcMain.handle(
    IPC.caixa.movimentar,
    async (_e, caixaId, tipo, valor, motivo, usuarioId, autorizadoPorId) => {
      const mov = caixaRepo.movimentar(caixaId, tipo, valor, motivo, usuarioId, autorizadoPorId)
      await auditoriaRepo.registrar(usuarioId, `caixa_${tipo}`, { valor, motivo, autorizadoPorId })
      return mov
    },
  )

  // ---- Vendas (RF-01..10, 16, 26, 27) ----
  ipcMain.handle(IPC.vendas.finalizar, (_e, input: FinalizarVendaInput) => finalizarVenda(input))

  ipcMain.handle(
    IPC.vendas.cancelar,
    async (_e, vendaId: number, usuarioId: number, autorizadoPorId: number) => {
      vendasRepo.cancelar(vendaId, usuarioId)
      await auditoriaRepo.registrar(usuarioId, 'venda_cancelar', { vendaId, autorizadoPorId })
    },
  )

  ipcMain.handle(IPC.vendas.salvarEspera, async (_e, input: FinalizarVendaInput) => {
    const db = getDb()
    const id = randomUUID()
    await db
      .insert(vendasEspera)
      .values({ id, payloadJson: JSON.stringify(input), criadoEm: new Date().toISOString() })
    return { id }
  })

  ipcMain.handle(IPC.vendas.recuperarEspera, async () => {
    const db = getDb()
    const rows = await db.select().from(vendasEspera)
    return rows
      .filter((r) => r.id !== RASCUNHO_ID)
      .map((r) => ({ id: r.id, input: JSON.parse(r.payloadJson) }))
  })

  ipcMain.handle(IPC.vendas.removerEspera, async (_e, id: string) => {
    const db = getDb()
    await db.delete(vendasEspera).where(eq(vendasEspera.id, id))
  })

  // Invariante 4: rascunho persistido a cada item; recuperado na reabertura.
  ipcMain.handle(IPC.vendas.salvarRascunho, async (_e, input: FinalizarVendaInput | null) => {
    const db = getDb()
    if (!input) {
      await db.delete(vendasEspera).where(eq(vendasEspera.id, RASCUNHO_ID))
      return
    }
    await db
      .insert(vendasEspera)
      .values({ id: RASCUNHO_ID, payloadJson: JSON.stringify(input), criadoEm: new Date().toISOString() })
      .onConflictDoUpdate({
        target: vendasEspera.id,
        set: { payloadJson: JSON.stringify(input), criadoEm: new Date().toISOString() },
      })
  })

  ipcMain.handle(IPC.vendas.recuperarRascunho, async () => {
    const db = getDb()
    const [row] = await db.select().from(vendasEspera).where(eq(vendasEspera.id, RASCUNHO_ID))
    return row ? (JSON.parse(row.payloadJson) as FinalizarVendaInput) : null
  })

  // ---- Estoque (RF-16/17/18) ----
  ipcMain.handle(IPC.estoque.entrada, async (_e, produtoId, quantidade, usuarioId, motivo) => {
    estoqueRepo.entrada(produtoId, quantidade, usuarioId, motivo)
    await auditoriaRepo.registrar(usuarioId, 'estoque_entrada', { produtoId, quantidade, motivo })
  })
  ipcMain.handle(IPC.estoque.ajuste, async (_e, produtoId, novoSaldo, usuarioId, motivo) => {
    await estoqueRepo.ajuste(produtoId, novoSaldo, usuarioId)
    await auditoriaRepo.registrar(usuarioId, 'estoque_ajuste', { produtoId, novoSaldo, motivo })
  })
  ipcMain.handle(IPC.estoque.alertasMinimo, () => estoqueRepo.alertasMinimo())

  // ---- Fiscal (RF-24/27/28/29/30) ----
  ipcMain.handle(IPC.fiscal.statusServico, () => getFiscalProvider().statusServico())
  ipcMain.handle(IPC.fiscal.validarCertificado, async () => {
    const r = await getFiscalProvider().validarCertificado()
    return { valido: r.valido, expiraEm: r.expiraEm ? r.expiraEm.toISOString() : null }
  })
  ipcMain.handle(IPC.fiscal.cancelarNfce, async (_e, chave: string, justificativa: string) => {
    const r = await getFiscalProvider().cancelar(chave, justificativa)
    if (r.ok) {
      const doc = await fiscalRepo.porChave(chave)
      if (doc)
        await fiscalRepo.atualizarStatus(doc.id, {
          status: 'cancelada',
          canceladaEm: new Date().toISOString(),
        })
    }
    await auditoriaRepo.registrar(session.get()?.id ?? null, 'fiscal_cancelar', { chave })
    return r
  })
  ipcMain.handle(IPC.fiscal.inutilizar, async (_e, serie, numIni, numFim, justificativa) => {
    await getFiscalProvider().inutilizar(serie, numIni, numFim, justificativa)
    await auditoriaRepo.registrar(session.get()?.id ?? null, 'fiscal_inutilizar', {
      serie,
      numIni,
      numFim,
    })
  })
  ipcMain.handle(IPC.fiscal.listarDocumentos, (_e, status?: StatusDocumentoFiscal) =>
    fiscalRepo.listar(status),
  )
  ipcMain.handle(IPC.fiscal.filaContingencia, () => fiscalRepo.listar('contingencia_pendente'))
  ipcMain.handle(IPC.fiscal.reprocessarFila, () => getContingenciaQueue().reprocessar())

  // ---- Relatórios (RF-22..25) ----
  ipcMain.handle(IPC.relatorios.vendas, (_e, filtro: RelatorioVendasFiltro) =>
    relatoriosRepo.vendas(filtro),
  )
  ipcMain.handle(IPC.relatorios.curvaAbc, (_e, de: string, ate: string) =>
    relatoriosRepo.curvaAbc(de, ate),
  )
  ipcMain.handle(IPC.relatorios.exportarCsv, async (_e, dados: unknown, nomeArquivo: string) => {
    const { filePath, canceled } = await dialog.showSaveDialog({ defaultPath: nomeArquivo })
    if (canceled || !filePath) return { caminho: '' }
    writeFileSync(filePath, toCsv(dados as Record<string, unknown>[]), 'utf-8')
    return { caminho: filePath }
  })

  // ---- Hardware (Seção 5) ----
  ipcMain.handle(IPC.hardware.testarImpressora, () => imprimirTeste())
  ipcMain.handle(IPC.hardware.abrirGaveta, () => abrirGaveta())
  ipcMain.handle(IPC.hardware.lerPeso, () => lerPeso())
  ipcMain.handle(IPC.hardware.testarBalanca, async () => {
    const r = await lerPeso()
    return { ok: r.ok, detalhe: r.ok ? `Peso lido: ${r.peso} kg` : (r.erro ?? 'erro'), peso: r.peso }
  })

  // ---- Config ----
  ipcMain.handle(IPC.config.obter, (_e, chave: string) => configRepo.obter(chave))
  ipcMain.handle(IPC.config.definir, (_e, chave: string, valor: string) =>
    configRepo.definir(chave, valor),
  )
  ipcMain.handle(IPC.config.todas, () => configRepo.todas())

  // ---- Backup (RNF-05) ----
  ipcMain.handle(IPC.backup.executarAgora, () => backupAgora(backupsDir))
  ipcMain.handle(IPC.backup.exportarPara, async () => {
    const { filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!filePaths[0]) return { caminho: '' }
    return exportarPara(backupsDir, filePaths[0])
  })

  log.info('[ipc] handlers registrados')
}

