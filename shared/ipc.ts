// Contrato de IPC tipado. Renderer nunca acessa DB/FS/hardware/fiscal direto:
// tudo passa por `window.api`, cuja forma é ESTE contrato (seção 2.2 do PRD).
import type {
  Usuario,
  Produto,
  Grupo,
  Caixa,
  MovimentoCaixa,
  DocumentoFiscal,
  ResumoPreFechamento,
  RelatorioFechamento,
  ResultadoFechamento,
  FinalizarVendaInput,
  ResultadoVenda,
  StatusSefaz,
  StatusDocumentoFiscal,
  RelatorioVendas,
  LinhaCurvaAbc,
} from './types'

export interface LoginResult {
  ok: boolean
  usuario?: Usuario
  erro?: string
}

export interface ProdutoInput extends Omit<Produto, 'id' | 'criadoEm' | 'atualizadoEm'> {
  id?: number
}

export interface RelatorioVendasFiltro {
  de: string
  ate: string
  usuarioId?: number
  forma?: string
  grupoId?: number
}

export interface PeripheralTestResult {
  ok: boolean
  detalhe: string
}

/**
 * Superfície de API exposta ao renderer via contextBridge.
 * Cada método corresponde a um handler `ipcMain.handle(canal, ...)`.
 */
export interface PdvApi {
  auth: {
    login(login: string, senha: string): Promise<LoginResult>
    trocarOperador(pin: string): Promise<LoginResult>
    autorizarSupervisor(pin: string): Promise<{ ok: boolean; usuario?: Usuario }>
    logout(): Promise<void>
  }
  produtos: {
    listar(incluirInativos?: boolean): Promise<Produto[]>
    buscar(termo: string): Promise<Produto[]>
    obterPorEan(ean: string): Promise<Produto | null>
    salvar(input: ProdutoInput): Promise<Produto>
    inativar(id: number, usuarioId: number): Promise<void>
    reativar(id: number, usuarioId: number): Promise<void>
    excluir(id: number, usuarioId: number): Promise<{ ok: boolean; motivo?: string }>
    importarCsv(caminho: string): Promise<{ importados: number; erros: string[] }>
    listarGrupos(): Promise<Grupo[]>
  }
  caixa: {
    atual(): Promise<Caixa | null>
    abrir(usuarioId: number, valorAbertura: number): Promise<Caixa>
    /** Resumo sem valores monetários, para a etapa cega da conferência (RF-11). */
    resumoPreFechamento(caixaId: number, usuarioId: number): Promise<ResumoPreFechamento>
    /**
     * Fecha o caixa. Só devolve `fechado` quando não há bloqueio e a diferença
     * está dentro do limite — ou quando vem acompanhada de motivo e autorização.
     */
    fechar(
      caixaId: number,
      usuarioId: number,
      valorContado: number,
      motivo?: string | null,
      autorizadoPorId?: number | null,
    ): Promise<ResultadoFechamento>
    /** Relatório de um caixa já fechado (RF-13) — para reimpressão e consulta. */
    relatorioFechamento(caixaId: number): Promise<RelatorioFechamento>
    imprimirFechamento(caixaId: number): Promise<PeripheralTestResult>
    movimentar(
      caixaId: number,
      tipo: 'sangria' | 'suprimento',
      valor: number,
      motivo: string,
      usuarioId: number,
      autorizadoPorId: number,
    ): Promise<MovimentoCaixa>
  }
  vendas: {
    finalizar(input: FinalizarVendaInput): Promise<ResultadoVenda>
    cancelar(vendaId: number, usuarioId: number, autorizadoPorId: number): Promise<void>
    salvarEspera(input: FinalizarVendaInput): Promise<{ id: string }>
    recuperarEspera(): Promise<Array<{ id: string; input: FinalizarVendaInput }>>
    removerEspera(id: string): Promise<void>
    salvarRascunho(input: FinalizarVendaInput | null): Promise<void>
    recuperarRascunho(): Promise<FinalizarVendaInput | null>
  }
  estoque: {
    entrada(produtoId: number, quantidade: number, usuarioId: number, motivo: string): Promise<void>
    ajuste(produtoId: number, novoSaldo: number, usuarioId: number, motivo: string): Promise<void>
    alertasMinimo(): Promise<Produto[]>
  }
  fiscal: {
    statusServico(): Promise<StatusSefaz>
    validarCertificado(): Promise<{ valido: boolean; expiraEm: string | null }>
    cancelarNfce(chave: string, justificativa: string): Promise<{ ok: boolean; motivo?: string }>
    inutilizar(serie: number, numIni: number, numFim: number, justificativa: string): Promise<void>
    listarDocumentos(status?: StatusDocumentoFiscal): Promise<DocumentoFiscal[]>
    filaContingencia(): Promise<DocumentoFiscal[]>
    reprocessarFila(): Promise<{ processados: number }>
  }
  relatorios: {
    vendas(filtro: RelatorioVendasFiltro): Promise<RelatorioVendas>
    curvaAbc(de: string, ate: string): Promise<LinhaCurvaAbc[]>
    exportarCsv(dados: unknown[], nomeArquivo: string): Promise<{ caminho: string }>
  }
  hardware: {
    testarImpressora(): Promise<PeripheralTestResult>
    testarBalanca(): Promise<PeripheralTestResult & { peso?: number }>
    abrirGaveta(): Promise<PeripheralTestResult>
    lerPeso(): Promise<{ ok: boolean; peso?: number; erro?: string }>
  }
  config: {
    obter(chave: string): Promise<string | null>
    definir(chave: string, valor: string): Promise<void>
    todas(): Promise<Record<string, string>>
  }
  backup: {
    executarAgora(): Promise<{ caminho: string }>
    exportarPara(destino: string): Promise<{ caminho: string }>
  }
}

// Nomes de canais IPC — fonte única para main e preload.
export const IPC = {
  auth: {
    login: 'auth:login',
    trocarOperador: 'auth:trocarOperador',
    autorizarSupervisor: 'auth:autorizarSupervisor',
    logout: 'auth:logout',
  },
  produtos: {
    listar: 'produtos:listar',
    buscar: 'produtos:buscar',
    obterPorEan: 'produtos:obterPorEan',
    salvar: 'produtos:salvar',
    inativar: 'produtos:inativar',
    reativar: 'produtos:reativar',
    excluir: 'produtos:excluir',
    importarCsv: 'produtos:importarCsv',
    listarGrupos: 'produtos:listarGrupos',
  },
  caixa: {
    atual: 'caixa:atual',
    abrir: 'caixa:abrir',
    resumoPreFechamento: 'caixa:resumoPreFechamento',
    fechar: 'caixa:fechar',
    relatorioFechamento: 'caixa:relatorioFechamento',
    imprimirFechamento: 'caixa:imprimirFechamento',
    movimentar: 'caixa:movimentar',
  },
  vendas: {
    finalizar: 'vendas:finalizar',
    cancelar: 'vendas:cancelar',
    salvarEspera: 'vendas:salvarEspera',
    recuperarEspera: 'vendas:recuperarEspera',
    removerEspera: 'vendas:removerEspera',
    salvarRascunho: 'vendas:salvarRascunho',
    recuperarRascunho: 'vendas:recuperarRascunho',
  },
  estoque: {
    entrada: 'estoque:entrada',
    ajuste: 'estoque:ajuste',
    alertasMinimo: 'estoque:alertasMinimo',
  },
  fiscal: {
    statusServico: 'fiscal:statusServico',
    validarCertificado: 'fiscal:validarCertificado',
    cancelarNfce: 'fiscal:cancelarNfce',
    inutilizar: 'fiscal:inutilizar',
    listarDocumentos: 'fiscal:listarDocumentos',
    filaContingencia: 'fiscal:filaContingencia',
    reprocessarFila: 'fiscal:reprocessarFila',
  },
  relatorios: {
    vendas: 'relatorios:vendas',
    curvaAbc: 'relatorios:curvaAbc',
    exportarCsv: 'relatorios:exportarCsv',
  },
  hardware: {
    testarImpressora: 'hardware:testarImpressora',
    testarBalanca: 'hardware:testarBalanca',
    abrirGaveta: 'hardware:abrirGaveta',
    lerPeso: 'hardware:lerPeso',
  },
  config: {
    obter: 'config:obter',
    definir: 'config:definir',
    todas: 'config:todas',
  },
  backup: {
    executarAgora: 'backup:executarAgora',
    exportarPara: 'backup:exportarPara',
  },
} as const
