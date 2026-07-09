import { readFileSync } from 'node:fs'
import { produtosRepo, faltamCamposFiscais } from '../db/repositories/produtos.repo'
import type { ProdutoInput } from '@shared/ipc'

// RF-15: importação de produtos via CSV com validação linha a linha.
// Template em docs/template-produtos.csv. Separador ';'.
const COLUNAS = [
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

export async function importarProdutosCsv(
  caminho: string,
): Promise<{ importados: number; erros: string[] }> {
  const conteudo = readFileSync(caminho, 'utf-8')
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim())
  const erros: string[] = []
  let importados = 0

  const header = linhas[0]?.split(';').map((c) => c.trim())
  if (!header || COLUNAS.some((c, i) => header[i] !== c)) {
    return { importados: 0, erros: ['Cabeçalho inválido. Use o template em docs/template-produtos.csv.'] }
  }

  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(';').map((c) => c.trim())
    const linhaNum = i + 1
    try {
      const centavos = (v: string) => Math.round(parseFloat(v.replace(',', '.')) * 100)
      const input: ProdutoInput = {
        codigoInterno: cols[0],
        ean: cols[1] || null,
        descricao: cols[2],
        unidade: (cols[3] === 'KG' ? 'KG' : 'UN') as ProdutoInput['unidade'],
        pesavel: cols[4] === '1' || cols[4].toLowerCase() === 'sim',
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
      if (!input.codigoInterno || !input.descricao) {
        erros.push(`Linha ${linhaNum}: codigo_interno e descricao são obrigatórios.`)
        continue
      }
      const faltam = faltamCamposFiscais(input)
      if (faltam.length) {
        erros.push(`Linha ${linhaNum}: campos fiscais ausentes (${faltam.join(', ')}) — produto inativo.`)
        input.ativo = false
      }
      await produtosRepo.salvar(input)
      importados++
    } catch (e) {
      erros.push(`Linha ${linhaNum}: ${String(e)}`)
    }
  }
  return { importados, erros }
}
