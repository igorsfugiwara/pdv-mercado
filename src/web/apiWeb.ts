import { IPC } from '@shared/ipc'
import type { PdvApi } from '@shared/ipc'
import { toCsv } from '@shared/csv'

/**
 * Implementação de `PdvApi` para o navegador.
 *
 * No desktop o preload injeta `window.api` ligado ao IPC do Electron; na web o
 * mesmo contrato é servido por `POST /api/rpc`, usando os MESMOS nomes de canal.
 * O renderer (src/screens, src/components) não sabe em qual dos dois está rodando.
 *
 * Só três coisas divergem, e todas por limite físico do navegador:
 *   · hardware  → não existe porta serial nem impressora térmica;
 *   · backup    → o dump do banco é do provedor Postgres, não da aplicação;
 *   · arquivos  → importar/exportar passam por file picker e download.
 */

export class ErroRpc extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem)
  }
}

async function rpc<T>(canal: string, ...args: unknown[]): Promise<T> {
  const resp = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Cookie de sessão é HttpOnly; `same-origin` garante que ele acompanhe a chamada.
    credentials: 'same-origin',
    body: JSON.stringify({ canal, args }),
  })

  let corpo: any = null
  try {
    corpo = await resp.json()
  } catch {
    throw new ErroRpc(`Resposta inválida do servidor (HTTP ${resp.status}).`, resp.status)
  }

  if (!resp.ok || corpo?.ok === false) {
    throw new ErroRpc(corpo?.erro ?? `Falha na chamada ${canal}.`, resp.status)
  }
  return corpo.resultado as T
}

/** Abre o seletor de arquivos e devolve o texto do arquivo escolhido. */
function escolherArquivoTexto(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async () => {
      const arquivo = input.files?.[0]
      resolve(arquivo ? await arquivo.text() : null)
    }
    // Se o usuário fechar o seletor sem escolher, `change` nunca dispara —
    // `cancel` (suportado nos navegadores atuais) evita a promise pendurada.
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function baixarArquivo(nome: string, conteudo: string) {
  // BOM para o Excel abrir acentuação corretamente.
  const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}

const INDISPONIVEL_HARDWARE =
  'Periférico indisponível no navegador — use o app desktop para impressora, balança e gaveta.'

export const apiWeb: PdvApi = {
  auth: {
    login: (login, senha) => rpc(IPC.auth.login, login, senha),
    trocarOperador: (pin) => rpc(IPC.auth.trocarOperador, pin),
    autorizarSupervisor: (pin) => rpc(IPC.auth.autorizarSupervisor, pin),
    logout: () => rpc(IPC.auth.logout),
  },

  produtos: {
    listar: (incluirInativos) => rpc(IPC.produtos.listar, incluirInativos),
    buscar: (termo) => rpc(IPC.produtos.buscar, termo),
    obterPorEan: (ean) => rpc(IPC.produtos.obterPorEan, ean),
    salvar: (input) => rpc(IPC.produtos.salvar, input),
    inativar: (id, usuarioId) => rpc(IPC.produtos.inativar, id, usuarioId),
    reativar: (id, usuarioId) => rpc(IPC.produtos.reativar, id, usuarioId),
    excluir: (id, usuarioId) => rpc(IPC.produtos.excluir, id, usuarioId),
    // No desktop o argumento é um caminho; aqui é o conteúdo do arquivo escolhido.
    importarCsv: async () => {
      const conteudo = await escolherArquivoTexto('.csv,text/csv')
      if (conteudo === null) return { importados: 0, erros: [] }
      return rpc(IPC.produtos.importarCsv, conteudo)
    },
    listarGrupos: () => rpc(IPC.produtos.listarGrupos),
  },

  caixa: {
    atual: () => rpc(IPC.caixa.atual),
    abrir: (usuarioId, valorAbertura) => rpc(IPC.caixa.abrir, usuarioId, valorAbertura),
    fechar: (caixaId, usuarioId, valorContado) =>
      rpc(IPC.caixa.fechar, caixaId, usuarioId, valorContado),
    movimentar: (caixaId, tipo, valor, motivo, usuarioId, autorizadoPorId) =>
      rpc(IPC.caixa.movimentar, caixaId, tipo, valor, motivo, usuarioId, autorizadoPorId),
  },

  vendas: {
    finalizar: (input) => rpc(IPC.vendas.finalizar, input),
    cancelar: (vendaId, usuarioId, autorizadoPorId) =>
      rpc(IPC.vendas.cancelar, vendaId, usuarioId, autorizadoPorId),
    salvarEspera: (input) => rpc(IPC.vendas.salvarEspera, input),
    recuperarEspera: () => rpc(IPC.vendas.recuperarEspera),
    removerEspera: (id) => rpc(IPC.vendas.removerEspera, id),
    salvarRascunho: (input) => rpc(IPC.vendas.salvarRascunho, input),
    recuperarRascunho: () => rpc(IPC.vendas.recuperarRascunho),
  },

  estoque: {
    entrada: (produtoId, quantidade, usuarioId, motivo) =>
      rpc(IPC.estoque.entrada, produtoId, quantidade, usuarioId, motivo),
    ajuste: (produtoId, novoSaldo, usuarioId, motivo) =>
      rpc(IPC.estoque.ajuste, produtoId, novoSaldo, usuarioId, motivo),
    alertasMinimo: () => rpc(IPC.estoque.alertasMinimo),
  },

  fiscal: {
    statusServico: () => rpc(IPC.fiscal.statusServico),
    validarCertificado: () => rpc(IPC.fiscal.validarCertificado),
    cancelarNfce: (chave, justificativa) => rpc(IPC.fiscal.cancelarNfce, chave, justificativa),
    inutilizar: (serie, numIni, numFim, justificativa) =>
      rpc(IPC.fiscal.inutilizar, serie, numIni, numFim, justificativa),
    listarDocumentos: (status) => rpc(IPC.fiscal.listarDocumentos, status),
    filaContingencia: () => rpc(IPC.fiscal.filaContingencia),
    reprocessarFila: () => rpc(IPC.fiscal.reprocessarFila),
  },

  relatorios: {
    vendas: (filtro) => rpc(IPC.relatorios.vendas, filtro),
    curvaAbc: (de, ate) => rpc(IPC.relatorios.curvaAbc, de, ate),
    // Não passa pelo servidor: o dado já está na tela, vira download direto.
    exportarCsv: async (dados, nomeArquivo) => {
      baixarArquivo(nomeArquivo, toCsv(dados as Record<string, unknown>[]))
      return { caminho: nomeArquivo }
    },
  },

  hardware: {
    // A tela do caixa já cai para digitação manual do peso quando isto falha (RF-03/05).
    testarImpressora: async () => ({ ok: false, detalhe: INDISPONIVEL_HARDWARE }),
    testarBalanca: async () => ({ ok: false, detalhe: INDISPONIVEL_HARDWARE }),
    abrirGaveta: async () => ({ ok: false, detalhe: INDISPONIVEL_HARDWARE }),
    lerPeso: async () => ({ ok: false, erro: INDISPONIVEL_HARDWARE }),
  },

  config: {
    obter: (chave) => rpc(IPC.config.obter, chave),
    definir: (chave, valor) => rpc(IPC.config.definir, chave, valor),
    todas: () => rpc(IPC.config.todas),
  },

  backup: {
    executarAgora: async () => ({
      caminho: 'backup gerenciado pelo provedor Postgres (Neon/Supabase/Vercel).',
    }),
    exportarPara: async () => ({ caminho: '' }),
  },
}
