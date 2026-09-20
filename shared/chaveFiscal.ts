/**
 * Chave de acesso da NFC-e — layout da NT 2015/002.
 *
 * Um só gerador no repositório: usado pelo provider simulado do desktop
 * (`electron/fiscal/SimuladoProvider.ts`) e pelo da web (`server/fiscal.web.ts`).
 * A emissão real não passa por aqui — quem monta a chave é a ACBrLib.
 *
 * Posições (44 dígitos):
 *   cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) cNF(8) cDV(1)
 */

/** Modelo fiscal da NFC-e. NF-e é 55; aqui é sempre 65. */
export const MODELO_NFCE = '65'

/** Forma de emissão: 1 = normal, 9 = contingência offline. */
export type TipoEmissao = 1 | 9

export interface DadosChave {
  /** Código da UF na tabela do IBGE — 35 = São Paulo. */
  uf: string
  /** CNPJ do emitente, só dígitos. */
  cnpj: string
  /** Número sequencial da nota (nNF). */
  numero: number
  /** Série do documento. */
  serie: number
  tpEmis?: TipoEmissao
  /** Código numérico aleatório (cNF). Injetável para o teste ser determinístico. */
  cNF?: string
  /** Data de emissão; o layout usa ano e mês. Injetável pelo mesmo motivo. */
  emitidaEm?: Date
}

/**
 * Dígito verificador da chave: módulo 11 com pesos 2..9 cíclicos, da direita
 * para a esquerda. Resto 0 ou 1 resulta em DV 0 — é a regra da NT, não um
 * arredondamento nosso.
 */
export function dvModulo11(base: string): string {
  let soma = 0
  let peso = 2
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  return String(resto === 0 || resto === 1 ? 0 : 11 - resto)
}

function soDigitos(v: string, tamanho: number): string {
  return v.replace(/\D/g, '').padStart(tamanho, '0').slice(0, tamanho)
}

/** Monta os 44 dígitos da chave, já com o DV. */
export function montarChaveNfce(dados: DadosChave): string {
  const agora = dados.emitidaEm ?? new Date()
  const aamm =
    String(agora.getFullYear()).slice(2) + String(agora.getMonth() + 1).padStart(2, '0')
  const cNF = dados.cNF
    ? soDigitos(dados.cNF, 8)
    : String(Math.floor(Math.random() * 1e8)).padStart(8, '0')

  const base =
    soDigitos(dados.uf, 2) +
    aamm +
    soDigitos(dados.cnpj, 14) +
    MODELO_NFCE +
    String(dados.serie).padStart(3, '0') +
    String(dados.numero).padStart(9, '0') +
    String(dados.tpEmis ?? 1) +
    cNF

  return base + dvModulo11(base)
}

/** Confere tamanho e DV. Usado nos testes e na validação de entrada. */
export function chaveValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false
  return dvModulo11(chave.slice(0, 43)) === chave[43]
}

/** Quebra a chave nos campos do layout — para exibir e para testar posição. */
export function lerChave(chave: string) {
  return {
    uf: chave.slice(0, 2),
    aamm: chave.slice(2, 6),
    cnpj: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: chave.slice(22, 25),
    numero: chave.slice(25, 34),
    tpEmis: chave.slice(34, 35),
    cNF: chave.slice(35, 43),
    dv: chave.slice(43, 44),
  }
}
