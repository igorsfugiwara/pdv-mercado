/**
 * Etiqueta de balança — EAN-13 de uso interno (RF-03).
 *
 * A balança do hortifrúti imprime um código de barras que **não é o EAN do
 * produto**: ele carrega o código interno e o peso (ou o valor). Bipar essa
 * etiqueta procurando pelo EAN completo nunca acha nada — era exatamente o
 * defeito que esta fatia corrige.
 *
 * O parsing é puro e mora em `shared/` porque os dois lados precisam dele: o
 * renderer decide o fluxo do caixa, e o módulo de hardware reaproveita.
 */

export type LayoutBalanca = 'peso' | 'valor'

export interface ConfigBalanca {
  /** Prefixo reservado para uso interno. Padrão `2` (GS1). */
  prefixo: string
  layout: LayoutBalanca
  /**
   * Dígitos do código interno. Varia por fabricante de balança: Toledo e
   * Filizola imprimem layouts diferentes, e é por isso que isto é configurável
   * em vez de constante.
   */
  digitosCodigo: number
}

export const CONFIG_BALANCA_PADRAO: ConfigBalanca = {
  prefixo: '2',
  layout: 'peso',
  digitosCodigo: 5,
}

export const CHAVES_BALANCA = {
  prefixo: 'balanca.ean.prefixo',
  layout: 'balanca.ean.layout',
  digitosCodigo: 'balanca.ean.digitosCodigo',
} as const

/**
 * Dígito verificador do EAN-13: pesos 1 e 3 alternados da esquerda para a
 * direita sobre os 12 primeiros dígitos.
 */
export function dvEan13(base12: string): number {
  let soma = 0
  for (let i = 0; i < 12; i++) {
    soma += Number(base12[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return (10 - (soma % 10)) % 10
}

export function eanValido(ean: string): boolean {
  if (!/^\d{13}$/.test(ean)) return false
  return dvEan13(ean.slice(0, 12)) === Number(ean[12])
}

export type ResultadoEtiqueta =
  | { tipo: 'peso'; codigoProduto: string; peso: number }
  | { tipo: 'valor'; codigoProduto: string; valor: number }

export type FalhaEtiqueta =
  | 'nao-e-etiqueta' // não tem a cara de etiqueta de balança; siga o fluxo normal
  | 'dv-invalido'
  | 'quantidade-zero'

/**
 * Interpreta uma etiqueta de balança.
 *
 * Devolve `null` quando o código simplesmente não é uma etiqueta — isso não é
 * erro, é o sinal para o chamador seguir tentando EAN comum e busca por texto.
 * Erro de verdade (DV quebrado, peso zero) vem com motivo.
 */
export function lerEtiquetaBalanca(
  codigo: string,
  config: ConfigBalanca = CONFIG_BALANCA_PADRAO,
): { ok: true; dado: ResultadoEtiqueta } | { ok: false; motivo: FalhaEtiqueta } {
  const limpo = codigo.trim()

  if (!/^\d{13}$/.test(limpo)) return { ok: false, motivo: 'nao-e-etiqueta' }
  if (!limpo.startsWith(config.prefixo)) return { ok: false, motivo: 'nao-e-etiqueta' }

  // Etiqueta amassada ou leitura parcial vira erro claro, nunca item errado
  // no carrinho.
  if (!eanValido(limpo)) return { ok: false, motivo: 'dv-invalido' }

  const inicioCodigo = config.prefixo.length
  const fimCodigo = inicioCodigo + config.digitosCodigo
  const codigoProduto = limpo.slice(inicioCodigo, fimCodigo)
  const dados = limpo.slice(fimCodigo, 12) // até o DV
  const numero = Number(dados)

  if (!Number.isFinite(numero) || numero <= 0) {
    return { ok: false, motivo: 'quantidade-zero' }
  }

  if (config.layout === 'peso') {
    // Gramas → quilos.
    return { ok: true, dado: { tipo: 'peso', codigoProduto, peso: numero / 1000 } }
  }
  return { ok: true, dado: { tipo: 'valor', codigoProduto, valor: numero } }
}

/**
 * Quantidade a partir do valor da etiqueta.
 *
 * Devolve a razão **exata**, sem arredondar, e isso é deliberado. O total do
 * item é calculado como `round(preço × quantidade)` em todo o sistema; com a
 * razão exata isso dá `round(valor)` — ou seja, exatamente o valor impresso na
 * etiqueta, por construção.
 *
 * Arredondar a quantidade para 3 casas aqui faria o cupom divergir da etiqueta
 * que o cliente tem na mão: com produto a R$ 59,99/kg a diferença chega a 3
 * centavos. É o tipo de erro que só aparece com o cliente reclamando no caixa.
 * Por isso a precisão fica no armazenamento e o arredondamento na **exibição**
 * — ver `quantidadeExibida`.
 */
export function quantidadePorValor(valorCentavos: number, precoVenda: number): number {
  if (precoVenda <= 0) return 0
  return valorCentavos / precoVenda
}

/** O peso como o operador e o cupom mostram: 3 casas, como a balança imprime. */
export function quantidadeExibida(quantidade: number): number {
  return Number(quantidade.toFixed(3))
}

/** Monta uma etiqueta válida — usado nos testes e para gerar exemplos. */
export function montarEtiqueta(
  codigoProduto: string,
  quantidade: number,
  config: ConfigBalanca = CONFIG_BALANCA_PADRAO,
): string {
  const digitosDados = 12 - config.prefixo.length - config.digitosCodigo
  const codigo = codigoProduto.padStart(config.digitosCodigo, '0').slice(-config.digitosCodigo)
  const bruto = config.layout === 'peso' ? Math.round(quantidade * 1000) : Math.round(quantidade)
  const dados = String(bruto).padStart(digitosDados, '0').slice(-digitosDados)
  const base = config.prefixo + codigo + dados
  return base + dvEan13(base)
}
