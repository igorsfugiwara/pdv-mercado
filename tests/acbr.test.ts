import { describe, it, expect } from 'vitest'
import { montarIniNfce, parseRetornoEnvio, valorIni } from '../electron/fiscal/AcbrNfceProvider'
import type { AcbrConfig } from '../electron/fiscal/AcbrNfceProvider'
import type { VendaFiscal } from '../shared/types'

const config: AcbrConfig = {
  libPath: '', ambiente: 'homologacao', certPath: '', certSenha: '', cscId: '1', cscToken: 'x',
}

const venda: VendaFiscal = {
  vendaId: 1,
  clienteCpf: '52998224725',
  total: 5900,
  pagamentos: [
    { forma: 'dinheiro', valor: 4000 },
    { forma: 'pix', valor: 1900 },
  ],
  itens: [
    { descricao: 'Arroz 5kg', ncm: '10063021', cfop: '5102', csosn: '102', quantidade: 2, unidade: 'UN', valorUnitario: 2500, ean: '7890000000017' },
    { descricao: 'Banana kg', ncm: '08039000', cfop: '5102', csosn: '102', quantidade: 1.5, unidade: 'KG', valorUnitario: 600, ean: null },
  ],
}

describe('valorIni', () => {
  it('lê chave=valor case-insensitive', () => {
    expect(valorIni('CSTAT=100\ncStat=107', 'cstat')).toBe('100')
  })
  it('retorna null quando ausente', () => {
    expect(valorIni('xMotivo=ok', 'nProt')).toBeNull()
  })
})

describe('parseRetornoEnvio', () => {
  it('mapeia cStat 100 para autorizada com chave/protocolo/qr', () => {
    const resp = [
      'cStat=100',
      'xMotivo=Autorizado o uso da NF-e',
      'chNFe=35240100000000000165550010000000011000000010',
      'nProt=135240000000001',
      'qrCode=https://www.nfce.fazenda.sp.gov.br/qrcode?p=abc',
    ].join('\r\n')
    const r = parseRetornoEnvio(resp)
    expect(r.status).toBe('autorizada')
    if (r.status === 'autorizada') {
      expect(r.chave).toBe('35240100000000000165550010000000011000000010')
      expect(r.protocolo).toBe('135240000000001')
      expect(r.qrCode).toContain('nfce.fazenda.sp.gov.br')
    }
  })

  it('mapeia rejeição para rejeitada com código e motivo', () => {
    const r = parseRetornoEnvio('cStat=539\nxMotivo=Duplicidade de NF-e')
    expect(r.status).toBe('rejeitada')
    if (r.status === 'rejeitada') {
      expect(r.codigo).toBe('539')
      expect(r.motivo).toMatch(/Duplicidade/)
    }
  })
})

describe('montarIniNfce', () => {
  const ini = montarIniNfce(venda, config)

  it('gera cabeçalho NFC-e modelo 65 em homologação', () => {
    expect(ini).toContain('mod=65')
    expect(ini).toContain('tpAmb=2')
  })

  it('inclui destinatário quando há CPF', () => {
    expect(ini).toContain('[Destinatario]')
    expect(ini).toContain('CNPJCPF=52998224725')
  })

  it('emite item com CSOSN e valores formatados', () => {
    expect(ini).toContain('xProd=Arroz 5kg')
    expect(ini).toContain('CSOSN=102')
    expect(ini).toContain('vUnCom=25.00')
    expect(ini).toContain('cEAN=SEM GTIN') // banana sem GTIN
  })

  it('mapeia formas de pagamento para tPag (dinheiro=01, pix=17)', () => {
    expect(ini).toContain('tPag=01')
    expect(ini).toContain('tPag=17')
    expect(ini).toContain('vPag=40.00')
  })
})
