import { describe, it, expect } from 'vitest'
import {
  lerEtiquetaBalanca,
  quantidadePorValor,
  quantidadeExibida,
  montarEtiqueta,
  eanValido,
  dvEan13,
  CONFIG_BALANCA_PADRAO,
  type ConfigBalanca,
} from '../shared/eanBalanca'

/**
 * Fatia 05 — etiqueta de balança.
 *
 * O cenário do PRD: "Banana Prata (kg)", código interno 2001, R$ 5,99/kg.
 */
const PESO: ConfigBalanca = { prefixo: '2', layout: 'peso', digitosCodigo: 5 }
const VALOR: ConfigBalanca = { prefixo: '2', layout: 'valor', digitosCodigo: 5 }
const PRECO_BANANA = 599

describe('dígito verificador do EAN-13', () => {
  it('calcula o DV com pesos 1 e 3 alternados', () => {
    expect(dvEan13('789100010010')).toBe(3) // EAN real conhecido
  })

  it('aceita EAN válido e recusa adulterado', () => {
    expect(eanValido('7891000100103')).toBe(true)
    expect(eanValido('7891000100104')).toBe(false)
  })

  it('recusa o que não tem 13 dígitos', () => {
    expect(eanValido('789100010010')).toBe(false)
    expect(eanValido('abcdefghijklm')).toBe(false)
  })
})

describe('layout peso', () => {
  it('extrai código interno e peso em quilos', () => {
    const etiqueta = montarEtiqueta('02001', 1.5, PESO)
    const r = lerEtiquetaBalanca(etiqueta, PESO)

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dado).toEqual({ tipo: 'peso', codigoProduto: '02001', peso: 1.5 })
  })

  it('o total do item sai do peso × preço', () => {
    const etiqueta = montarEtiqueta('02001', 1.5, PESO)
    const r = lerEtiquetaBalanca(etiqueta, PESO)
    if (!r.ok || r.dado.tipo !== 'peso') throw new Error('esperava peso')

    // 1,5 kg × R$ 5,99 = R$ 8,985 → R$ 8,99, como o critério 1 do PRD.
    expect(Math.round(PRECO_BANANA * r.dado.peso)).toBe(899)
  })
})

describe('layout valor', () => {
  it('extrai código interno e valor em centavos', () => {
    const etiqueta = montarEtiqueta('02001', 1290, VALOR)
    const r = lerEtiquetaBalanca(etiqueta, VALOR)

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dado).toEqual({ tipo: 'valor', codigoProduto: '02001', valor: 1290 })
  })

  it('a quantidade exibida tem 3 casas', () => {
    const q = quantidadePorValor(1290, PRECO_BANANA)
    expect(quantidadeExibida(q)).toBe(2.154) // critério 2 do PRD
  })

  it('o total do item bate EXATAMENTE com a etiqueta', () => {
    // O ponto central da fatia: a etiqueta é a fonte da verdade do valor.
    const q = quantidadePorValor(1290, PRECO_BANANA)
    expect(Math.round(PRECO_BANANA * q)).toBe(1290)
  })

  it('bate exatamente num caso em que arredondar a 3 casas erraria', () => {
    // R$ 10,01/kg com etiqueta de R$ 15,01: a razão exata é 1,4995 kg. Exibida
    // como 1,500 kg, o total viraria R$ 15,02 — um centavo a mais do que o
    // papel na mão do cliente. É o caso que justifica guardar a razão exata.
    const preco = 1001
    const valor = 1501

    const exato = quantidadePorValor(valor, preco)
    expect(Math.round(preco * exato)).toBe(valor)

    const arredondado = quantidadeExibida(exato)
    expect(arredondado).toBe(1.5)
    expect(Math.round(preco * arredondado)).toBe(1502) // a divergência é real
  })

  it('preço zerado não derruba, devolve 0', () => {
    expect(quantidadePorValor(1290, 0)).toBe(0)
  })
})

describe('validação', () => {
  it('DV errado é rejeitado — etiqueta amassada não vira item errado', () => {
    const boa = montarEtiqueta('02001', 1.5, PESO)
    const ruim = boa.slice(0, 12) + String((Number(boa[12]) + 1) % 10)

    expect(lerEtiquetaBalanca(ruim, PESO)).toEqual({ ok: false, motivo: 'dv-invalido' })
  })

  it('peso zerado é rejeitado', () => {
    const etiqueta = montarEtiqueta('02001', 0, PESO)
    expect(lerEtiquetaBalanca(etiqueta, PESO)).toEqual({ ok: false, motivo: 'quantidade-zero' })
  })

  it('código que não é etiqueta devolve `nao-e-etiqueta`, não erro', () => {
    // Não é falha: é o sinal para o caixa seguir tentando EAN e busca.
    expect(lerEtiquetaBalanca('7891000100103', PESO)).toEqual({
      ok: false,
      motivo: 'nao-e-etiqueta',
    })
    expect(lerEtiquetaBalanca('123', PESO)).toEqual({ ok: false, motivo: 'nao-e-etiqueta' })
    expect(lerEtiquetaBalanca('', PESO)).toEqual({ ok: false, motivo: 'nao-e-etiqueta' })
  })
})

describe('configuração', () => {
  it('o prefixo é configurável', () => {
    const cfg: ConfigBalanca = { ...PESO, prefixo: '7' }
    const etiqueta = montarEtiqueta('02001', 1.5, cfg)

    expect(etiqueta[0]).toBe('7')
    expect(lerEtiquetaBalanca(etiqueta, cfg).ok).toBe(true)
    // Com o prefixo padrão, a mesma etiqueta não é reconhecida.
    expect(lerEtiquetaBalanca(etiqueta, PESO)).toEqual({ ok: false, motivo: 'nao-e-etiqueta' })
  })

  it('o tamanho do código interno é configurável (fabricantes divergem)', () => {
    const seis: ConfigBalanca = { prefixo: '2', layout: 'peso', digitosCodigo: 6 }
    const etiqueta = montarEtiqueta('002001', 1.5, seis)
    const r = lerEtiquetaBalanca(etiqueta, seis)

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dado.codigoProduto).toBe('002001')
    expect(r.dado.tipo === 'peso' && r.dado.peso).toBe(1.5)
  })

  it('o padrão é prefixo 2, layout peso, 5 dígitos', () => {
    expect(CONFIG_BALANCA_PADRAO).toEqual({ prefixo: '2', layout: 'peso', digitosCodigo: 5 })
  })
})
