import type { ProdutoInput } from './ipc'

// RF-15: parsing puro do CSV de produtos, compartilhado entre o app desktop
// (lê do disco) e a versão web (recebe o conteúdo do upload).
// Template em docs/template-produtos.csv. Separador ';'.
export const COLUNAS = [
  'codigo_interno',
  'ean',
  'descricao',
  'unidade',
  'pesavel',
  'preco_custo',
  'preco_venda',
  'estoque_atual',
  'estoque_minimo',
  'ncm',
  'cest',
  'cfop',
  'origem',
  'csosn',
  'cst_pis',
  'aliq_pis',
  'cst_cofins',
  'aliq_cofins',
] as const

export function cabecalhoValido(header: string[] | undefined): boolean {
  return !!header && !COLUNAS.some((c, i) => header[i] !== c)
}

export function separarLinhas(conteudo: string): string[] {
  return conteudo.split(/\r?\n/).filter((l) => l.trim())
}

/** Converte uma linha já separada por ';' em ProdutoInput. Lança em valor inválido. */
export function parseLinhaProduto(cols: string[]): ProdutoInput {
  const centavos = (v: string) => Math.round(parseFloat(v.replace(',', '.')) * 100)
  return {
    codigoInterno: cols[0],
    ean: cols[1] || null,
    descricao: cols[2],
    unidade: (cols[3] === 'KG' ? 'KG' : 'UN') as ProdutoInput['unidade'],
    pesavel: cols[4] === '1' || cols[4]?.toLowerCase() === 'sim',
    precoCusto: centavos(cols[5] || '0'),
    precoVenda: centavos(cols[6] || '0'),
    estoqueAtual: parseFloat((cols[7] || '0').replace(',', '.')),
    estoqueMinimo: parseFloat((cols[8] || '0').replace(',', '.')),
    grupoId: null,
    imagemPath: null,
    ativo: true,
    ncm: cols[9] || null,
    cest: cols[10] || null,
    cfop: cols[11] || null,
    origem: cols[12] || null,
    csosn: cols[13] || null,
    cstPis: cols[14] || null,
    aliqPis: cols[15] ? parseInt(cols[15], 10) : null,
    cstCofins: cols[16] || null,
    aliqCofins: cols[17] ? parseInt(cols[17], 10) : null,
  }
}
