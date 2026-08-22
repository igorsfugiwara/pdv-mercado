import { produtosRepo, faltamCamposFiscais } from './repos/produtos.repo'
import { cabecalhoValido, separarLinhas, parseLinhaProduto } from '@shared/csvProdutos'

// Igual ao desktop (RF-15), mas recebe o CONTEÚDO do CSV: no navegador não há
// caminho de arquivo — o adapter lê o File escolhido e manda o texto.
export async function importarProdutosCsvTexto(
  conteudo: string,
): Promise<{ importados: number; erros: string[] }> {
  const linhas = separarLinhas(conteudo)
  const erros: string[] = []
  let importados = 0

  const header = linhas[0]?.split(';').map((c) => c.trim())
  if (!cabecalhoValido(header)) {
    return {
      importados: 0,
      erros: ['Cabeçalho inválido. Use o template em docs/template-produtos.csv.'],
    }
  }

  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(';').map((c) => c.trim())
    const linhaNum = i + 1
    try {
      const input = parseLinhaProduto(cols)
      if (!input.codigoInterno || !input.descricao) {
        erros.push(`Linha ${linhaNum}: codigo_interno e descricao são obrigatórios.`)
        continue
      }
      const faltam = faltamCamposFiscais(input)
      if (faltam.length) {
        erros.push(
          `Linha ${linhaNum}: campos fiscais ausentes (${faltam.join(', ')}) — produto inativo.`,
        )
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
