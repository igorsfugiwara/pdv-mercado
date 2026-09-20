import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { PdvApi } from '../shared/ipc'

// contextBridge com contrato tipado. nodeIntegration=false, contextIsolation=true.
// O renderer só enxerga `window.api` — nunca ipcRenderer/require/fs diretamente.
const invoke = (canal: string, ...args: unknown[]) => ipcRenderer.invoke(canal, ...args)

const api: PdvApi = {
  auth: {
    login: (login, senha) => invoke(IPC.auth.login, login, senha),
    trocarOperador: (pin) => invoke(IPC.auth.trocarOperador, pin),
    autorizarSupervisor: (pin) => invoke(IPC.auth.autorizarSupervisor, pin),
    autorizarDesconto: (pin, descontoBps) => invoke(IPC.auth.autorizarDesconto, pin, descontoBps),
    logout: () => invoke(IPC.auth.logout),
  },
  auditoria: {
    registrar: (acao, detalhe) => invoke(IPC.auditoria.registrar, acao, detalhe),
  },
  produtos: {
    listar: (incluirInativos) => invoke(IPC.produtos.listar, incluirInativos),
    buscar: (termo) => invoke(IPC.produtos.buscar, termo),
    obterPorEan: (ean) => invoke(IPC.produtos.obterPorEan, ean),
    obterPorCodigoInterno: (codigo) => invoke(IPC.produtos.obterPorCodigoInterno, codigo),
    salvar: (input) => invoke(IPC.produtos.salvar, input),
    inativar: (id, usuarioId) => invoke(IPC.produtos.inativar, id, usuarioId),
    reativar: (id, usuarioId) => invoke(IPC.produtos.reativar, id, usuarioId),
    excluir: (id, usuarioId) => invoke(IPC.produtos.excluir, id, usuarioId),
    importarCsv: (caminho) => invoke(IPC.produtos.importarCsv, caminho),
    listarGrupos: () => invoke(IPC.produtos.listarGrupos),
  },
  caixa: {
    atual: () => invoke(IPC.caixa.atual),
    abrir: (usuarioId, valor) => invoke(IPC.caixa.abrir, usuarioId, valor),
    resumoPreFechamento: (caixaId, usuarioId) =>
      invoke(IPC.caixa.resumoPreFechamento, caixaId, usuarioId),
    fechar: (caixaId, usuarioId, contado, motivo, autorizadoPorId) =>
      invoke(IPC.caixa.fechar, caixaId, usuarioId, contado, motivo, autorizadoPorId),
    relatorioFechamento: (caixaId) => invoke(IPC.caixa.relatorioFechamento, caixaId),
    imprimirFechamento: (caixaId) => invoke(IPC.caixa.imprimirFechamento, caixaId),
    movimentar: (caixaId, tipo, valor, motivo, usuarioId, autorizadoPorId) =>
      invoke(IPC.caixa.movimentar, caixaId, tipo, valor, motivo, usuarioId, autorizadoPorId),
  },
  vendas: {
    finalizar: (input) => invoke(IPC.vendas.finalizar, input),
    cancelar: (vendaId, usuarioId, autorizadoPorId) =>
      invoke(IPC.vendas.cancelar, vendaId, usuarioId, autorizadoPorId),
    salvarEspera: (input) => invoke(IPC.vendas.salvarEspera, input),
    recuperarEspera: () => invoke(IPC.vendas.recuperarEspera),
    removerEspera: (id) => invoke(IPC.vendas.removerEspera, id),
    salvarRascunho: (input) => invoke(IPC.vendas.salvarRascunho, input),
    recuperarRascunho: () => invoke(IPC.vendas.recuperarRascunho),
  },
  estoque: {
    entrada: (produtoId, quantidade, usuarioId, motivo) =>
      invoke(IPC.estoque.entrada, produtoId, quantidade, usuarioId, motivo),
    ajuste: (produtoId, novoSaldo, usuarioId, motivo) =>
      invoke(IPC.estoque.ajuste, produtoId, novoSaldo, usuarioId, motivo),
    alertasMinimo: () => invoke(IPC.estoque.alertasMinimo),
  },
  fiscal: {
    statusServico: () => invoke(IPC.fiscal.statusServico),
    validarCertificado: () => invoke(IPC.fiscal.validarCertificado),
    cancelarNfce: (chave, justificativa) => invoke(IPC.fiscal.cancelarNfce, chave, justificativa),
    inutilizar: (serie, numIni, numFim, justificativa) =>
      invoke(IPC.fiscal.inutilizar, serie, numIni, numFim, justificativa),
    listarDocumentos: (status) => invoke(IPC.fiscal.listarDocumentos, status),
    filaContingencia: () => invoke(IPC.fiscal.filaContingencia),
    reprocessarFila: () => invoke(IPC.fiscal.reprocessarFila),
    estado: () => invoke(IPC.fiscal.estado),
    definirProvider: (provider) => invoke(IPC.fiscal.definirProvider, provider),
    definirModoFalha: (modo) => invoke(IPC.fiscal.definirModoFalha, modo),
  },
  relatorios: {
    vendas: (filtro) => invoke(IPC.relatorios.vendas, filtro),
    curvaAbc: (de, ate) => invoke(IPC.relatorios.curvaAbc, de, ate),
    mediaDiariaProdutos: (de, ate) => invoke(IPC.relatorios.mediaDiariaProdutos, de, ate),
    exportarCsv: (dados, nomeArquivo) => invoke(IPC.relatorios.exportarCsv, dados, nomeArquivo),
  },
  hardware: {
    testarImpressora: () => invoke(IPC.hardware.testarImpressora),
    testarBalanca: () => invoke(IPC.hardware.testarBalanca),
    abrirGaveta: () => invoke(IPC.hardware.abrirGaveta),
    lerPeso: () => invoke(IPC.hardware.lerPeso),
  },
  config: {
    obter: (chave) => invoke(IPC.config.obter, chave),
    definir: (chave, valor) => invoke(IPC.config.definir, chave, valor),
    todas: () => invoke(IPC.config.todas),
  },
  backup: {
    executarAgora: () => invoke(IPC.backup.executarAgora),
    exportarPara: (destino) => invoke(IPC.backup.exportarPara, destino),
  },
}

contextBridge.exposeInMainWorld('api', api)
