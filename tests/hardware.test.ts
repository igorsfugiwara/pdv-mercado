import { describe, it, expect } from 'vitest'
import { parsePeso } from '../electron/hardware/balanca'
import { montarDanfeNfce } from '../electron/hardware/printer'
import type { DanfeNfceDados } from '../shared/types'

describe('parsePeso — frames de balança (RF-03)', () => {
  it('lê inteiro em gramas (Toledo) — caso que o parser antigo quebrava', () => {
    expect(parsePeso('\x02001500\x03', 'toledo')).toBe(1.5)
  })
  it('lê decimal com vírgula (Filizola)', () => {
    expect(parsePeso('2,340', 'filizola')).toBe(2.34)
  })
  it('lê decimal com ponto e framing CR/LF', () => {
    expect(parsePeso('\x021.500\r\n', 'toledo')).toBe(1.5)
  })
  it('aceita Buffer', () => {
    expect(parsePeso(Buffer.from('000750'), 'toledo')).toBe(0.75)
  })
  it('rejeita peso zero', () => {
    expect(parsePeso('\x02000000\x03', 'toledo')).toBeNull()
  })
  it('rejeita instável (flag I) e negativo', () => {
    expect(parsePeso('I001500', 'toledo')).toBeNull()
    expect(parsePeso('-1.000', 'filizola')).toBeNull()
  })
  it('rejeita leitura ilegível', () => {
    expect(parsePeso('---', 'toledo')).toBeNull()
  })
})

describe('montarDanfeNfce — DANFE NFC-e (RF-26)', () => {
  const dados: DanfeNfceDados = {
    emitenteNome: 'MERCADO CASA O LTDA',
    emitenteCnpj: '12.345.678/0001-99',
    itens: [
      { descricao: 'Arroz 5kg', quantidade: 2, valorUnitario: 2500, total: 5000 },
      { descricao: 'Banana kg', quantidade: 1.5, valorUnitario: 600, total: 900 },
    ],
    total: 5900,
    desconto: 0,
    pagamentos: [{ forma: 'dinheiro', valor: 6000 }],
    troco: 100,
    chave: '35240100000000000165550010000000011000000010',
    protocolo: '135240000000001',
    qrCode: 'https://www.nfce.fazenda.sp.gov.br/qrcode?p=x',
    emitidaEm: new Date('2026-07-12T10:00:00').toISOString(),
    consumidorCpf: null,
    contingencia: false,
  }

  it('inclui emitente, total, troco e itens', () => {
    const txt = montarDanfeNfce(dados, 48).join('\n')
    expect(txt).toContain('MERCADO CASA O LTDA')
    expect(txt).toContain('VALOR TOTAL R$')
    expect(txt).toContain('59,00')
    expect(txt).toContain('Arroz 5kg')
    expect(txt).toContain('Troco R$')
    expect(txt).toContain('1,500 x') // peso fracionário formatado
  })

  it('agrupa a chave de acesso em blocos de 4', () => {
    const txt = montarDanfeNfce(dados).join('\n')
    expect(txt).toContain('3524 0100 0000 0000 0165')
  })

  it('marca consumidor não identificado e contingência', () => {
    const txt = montarDanfeNfce({ ...dados, contingencia: true }).join('\n')
    expect(txt).toContain('CONSUMIDOR NAO IDENTIFICADO')
    expect(txt).toContain('EMITIDA EM CONTINGENCIA')
  })

  it('formata CPF do consumidor quando informado', () => {
    const txt = montarDanfeNfce({ ...dados, consumidorCpf: '52998224725' }).join('\n')
    expect(txt).toContain('529.982.247-25')
  })
})
