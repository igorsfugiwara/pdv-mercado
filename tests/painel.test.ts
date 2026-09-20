import { describe, it, expect } from 'vitest'
import {
  montarAlertas,
  estimarDiasRestantes,
  ticketMedio,
  horasAberto,
  rotaInicial,
  HORAS_TURNO_LONGO,
} from '../src/lib/painel'
import type { Caixa, Produto, DocumentoFiscal, MediaDiariaProduto } from '../shared/types'

/**
 * Fatia 06 — a lógica do painel é pura de propósito: o que é alerta, qual a
 * gravidade e quantos dias o estoque cobre são regras de negócio, não
 * apresentação, e é assim que dá para testá-las sem montar React.
 */
const produto = (over: Partial<Produto> = {}): Produto =>
  ({
    id: 1,
    codigoInterno: '1',
    ean: '789',
    descricao: 'Arroz',
    unidade: 'UN',
    pesavel: false,
    precoCusto: 1000,
    precoVenda: 2000,
    estoqueAtual: 8,
    estoqueMinimo: 10,
    grupoId: null,
    imagemPath: null,
    ativo: true,
    ncm: '19059090',
    cest: null,
    cfop: '5102',
    origem: '0',
    csosn: '102',
    cstPis: null,
    aliqPis: null,
    cstCofins: null,
    aliqCofins: null,
    criadoEm: '',
    atualizadoEm: '',
    ...over,
  }) as Produto

const caixaAberto = (horasAtras: number): Caixa => ({
  id: 1,
  usuarioAberturaId: 1,
  valorAbertura: 20000,
  abertoEm: new Date(Date.now() - horasAtras * 3_600_000).toISOString(),
  usuarioFechamentoId: null,
  fechadoEm: null,
  status: 'aberto',
})

const doc = (id: number): DocumentoFiscal => ({ id }) as DocumentoFiscal

const vazio = {
  contingencia: [],
  rejeitados: [],
  estoqueMinimo: [],
  inativosPorFiscal: [],
  caixa: null,
  emEspera: [],
}

describe('alertas', () => {
  it('sem pendência, não há alerta — o bloco some em vez de mostrar 0', () => {
    expect(montarAlertas(vazio)).toEqual([])
  })

  it('contingência leva ao fiscal, com gravidade pela idade (fatia 10)', () => {
    // Documento sem data de emissão não dá para classificar, e chutar urgência
    // seria alarme falso: fica em média. A escala por idade é testada em
    // tests/contingencia-prazo.test.ts.
    const [a] = montarAlertas({ ...vazio, contingencia: [doc(1), doc(2)] })
    expect(a.gravidade).toBe('media')
    expect(a.rota).toBe('/fiscal')
    expect(a.quantidade).toBe(2)
  })

  it('estoque mínimo é média e leva ao estoque', () => {
    const [a] = montarAlertas({ ...vazio, estoqueMinimo: [produto()] })
    expect(a.gravidade).toBe('media')
    expect(a.rota).toBe('/estoque')
  })

  it('caixa aberto há mais de 12 h dispara alerta de turno esquecido', () => {
    const alertas = montarAlertas({ ...vazio, caixa: caixaAberto(HORAS_TURNO_LONGO + 1) })
    const turno = alertas.find((a) => a.id === 'turno-longo')
    expect(turno).toBeDefined()
    expect(turno?.rota).toBe('/fechamento')
  })

  it('caixa recém-aberto não dispara nada', () => {
    expect(montarAlertas({ ...vazio, caixa: caixaAberto(2) })).toEqual([])
  })

  it('na borda exata de 12 h já alerta', () => {
    const alertas = montarAlertas({ ...vazio, caixa: caixaAberto(HORAS_TURNO_LONGO) })
    expect(alertas.some((a) => a.id === 'turno-longo')).toBe(true)
  })

  it('ordena por gravidade: alta antes de média, média antes de baixa', () => {
    const alertas = montarAlertas({
      contingencia: [],
      rejeitados: [doc(1)], // rejeitado é sempre alta
      estoqueMinimo: [produto()],
      inativosPorFiscal: [],
      caixa: null,
      emEspera: [{}],
    })
    expect(alertas.map((a) => a.gravidade)).toEqual(['alta', 'media', 'baixa'])
  })

  it('cada alerta aponta para a tela onde se resolve', () => {
    const alertas = montarAlertas({
      contingencia: [doc(1)],
      rejeitados: [doc(2)],
      estoqueMinimo: [produto()],
      inativosPorFiscal: [produto({ ativo: false, ncm: null })],
      caixa: caixaAberto(20),
      emEspera: [{}],
    })
    // Alerta que não leva à ação é ruído — nenhum pode ficar sem rota.
    expect(alertas.every((a) => a.rota.startsWith('/'))).toBe(true)
    expect(alertas).toHaveLength(6)
  })
})

describe('dias restantes de estoque', () => {
  const medias: MediaDiariaProduto[] = [{ produtoId: 1, mediaDiaria: 4 }]

  it('saldo ÷ média diária, arredondado para baixo', () => {
    // 8 em estoque, 4/dia → 2 dias.
    const [linha] = estimarDiasRestantes([produto({ id: 1, estoqueAtual: 8 })], medias)
    expect(linha.diasRestantes).toBe(2)
  })

  it('arredonda para baixo, nunca para cima', () => {
    // 9 ÷ 4 = 2,25 → 2 dias. Otimismo aqui faz o produto faltar.
    const [linha] = estimarDiasRestantes([produto({ id: 1, estoqueAtual: 9 })], medias)
    expect(linha.diasRestantes).toBe(2)
  })

  it('produto sem venda no período fica sem estimativa, não em zero', () => {
    // O caso que dividiria por zero.
    const [linha] = estimarDiasRestantes([produto({ id: 99 })], medias)
    expect(linha.diasRestantes).toBeNull()
  })

  it('média zero também é tratada como sem histórico', () => {
    const [linha] = estimarDiasRestantes(
      [produto({ id: 1 })],
      [{ produtoId: 1, mediaDiaria: 0 }],
    )
    expect(linha.diasRestantes).toBeNull()
  })

  it('estoque zerado com venda dá zero dias', () => {
    const [linha] = estimarDiasRestantes([produto({ id: 1, estoqueAtual: 0 })], medias)
    expect(linha.diasRestantes).toBe(0)
  })
})

describe('ticket médio', () => {
  it('total ÷ vendas, em centavos', () => {
    expect(ticketMedio(30000, 10)).toBe(3000)
  })

  it('arredonda para o centavo', () => {
    expect(ticketMedio(1000, 3)).toBe(333)
  })

  it('sem venda devolve zero em vez de dividir por zero', () => {
    expect(ticketMedio(0, 0)).toBe(0)
    expect(ticketMedio(5000, 0)).toBe(0)
  })
})

describe('rota inicial por perfil', () => {
  it('operador vai para o caixa — ele abre o sistema para trabalhar nele', () => {
    expect(rotaInicial('operador')).toBe('/caixa')
  })

  it('supervisor e admin vão para o painel', () => {
    expect(rotaInicial('supervisor')).toBe('/painel')
    expect(rotaInicial('admin')).toBe('/painel')
  })
})

describe('horas de caixa aberto', () => {
  it('conta a partir da abertura', () => {
    expect(Math.round(horasAberto(caixaAberto(5)))).toBe(5)
  })
})
