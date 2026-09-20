import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { initDb, getDb, schema } from '../electron/db/index'
import { auditoriaRepo } from '../electron/db/repositories/auditoria.repo'
import { IPC } from '../shared/ipc'
import {
  exigeAutorizacao,
  limiteDoPerfil,
  podeAutorizar,
  descontoParaBps,
  bpsParaCentavos,
  formatarBps,
  LIMITES_PADRAO,
} from '../shared/autorizacao'

/**
 * Fatia 03 — a regra de autorização é pura de propósito: vale na UI e no main,
 * e é aqui que ela é provada. Os limites usados são os padrão (5% / 15% / 100%).
 */
const MIGRATIONS = join(__dirname, '..', 'electron', 'db', 'migrations')

describe('limites por perfil', () => {
  it('cada perfil tem o próprio teto', () => {
    expect(limiteDoPerfil('operador', LIMITES_PADRAO)).toBe(500)
    expect(limiteDoPerfil('supervisor', LIMITES_PADRAO)).toBe(1500)
    expect(limiteDoPerfil('admin', LIMITES_PADRAO)).toBe(10000)
  })

  it('perfil desconhecido cai no mais restritivo — falha segura', () => {
    // Se a regra não sabe quem é, ela nega mais, não menos.
    expect(limiteDoPerfil('faxineiro', LIMITES_PADRAO)).toBe(500)
    expect(limiteDoPerfil('', LIMITES_PADRAO)).toBe(500)
  })
})

describe('exigeAutorizacao', () => {
  it('no limite exato NÃO exige — a comparação é >, não >=', () => {
    // A borda que toda implementação erra: 5% com teto de 5% passa direto.
    expect(exigeAutorizacao('operador', 500, LIMITES_PADRAO)).toBe(false)
  })

  it('um basis point acima já exige', () => {
    expect(exigeAutorizacao('operador', 501, LIMITES_PADRAO)).toBe(true)
  })

  it('abaixo do limite não exige', () => {
    expect(exigeAutorizacao('operador', 300, LIMITES_PADRAO)).toBe(false)
  })

  it('admin não é barrado até 100%', () => {
    expect(exigeAutorizacao('admin', 10000, LIMITES_PADRAO)).toBe(false)
  })

  it('perfil desconhecido é tratado como o mais restritivo', () => {
    expect(exigeAutorizacao('qualquer', 600, LIMITES_PADRAO)).toBe(true)
  })
})

describe('podeAutorizar', () => {
  it('supervisor autoriza dentro do próprio teto', () => {
    expect(podeAutorizar('supervisor', 1200, LIMITES_PADRAO)).toEqual({ ok: true })
  })

  it('supervisor NÃO autoriza acima do próprio teto, e diz o porquê', () => {
    // Critério 4 do PRD: recusa com motivo, sem pedir outro PIN.
    const r = podeAutorizar('supervisor', 5000, LIMITES_PADRAO)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.motivo).toContain('50,00%')
      expect(r.motivo).toContain('15,00%')
    }
  })

  it('admin autoriza até 100%', () => {
    expect(podeAutorizar('admin', 10000, LIMITES_PADRAO)).toEqual({ ok: true })
  })

  it('no teto exato autoriza', () => {
    expect(podeAutorizar('supervisor', 1500, LIMITES_PADRAO)).toEqual({ ok: true })
  })
})

describe('conversões', () => {
  it('desconto em centavos vira basis points sobre a base', () => {
    expect(descontoParaBps(1000, 10000)).toBe(1000) // R$10 de R$100 = 10,00%
    expect(descontoParaBps(500, 10000)).toBe(500) // 5,00%
  })

  it('base zero devolve 0 em vez de estourar', () => {
    expect(descontoParaBps(100, 0)).toBe(0)
  })

  it('basis points viram centavos, arredondando uma vez só', () => {
    expect(bpsParaCentavos(1000, 10000)).toBe(1000)
    // 3,33% de R$ 19,99: arredonda no fim, não acumulado
    expect(bpsParaCentavos(333, 1999)).toBe(67)
  })

  it('formata basis points como percentual pt-BR', () => {
    expect(formatarBps(500)).toBe('5,00%')
    expect(formatarBps(1250)).toBe('12,50%')
    expect(formatarBps(10000)).toBe('100,00%')
  })
})

// ------------------------------------------------------ auditoria append-only
describe('auditoria (RF-21)', () => {
  beforeEach(() => {
    initDb(':memory:', MIGRATIONS)
    const agora = new Date().toISOString()
    getDb()
      .insert(schema.usuarios)
      .values({ nome: 'Op', login: 'op', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora })
      .run()
  })
  afterEach(() => {})

  it('o contrato expõe registrar, e não listar nem apagar', () => {
    // O renderer registra ação; ler e apagar não existem no canal de propósito.
    expect(IPC.auditoria).toHaveProperty('registrar')
    expect(Object.keys(IPC.auditoria)).toEqual(['registrar'])
  })

  it('registra o ato com autor e autorizador distintos', async () => {
    await auditoriaRepo.registrar(1, 'venda_item_cancelar', {
      produtoId: 7,
      descricao: 'Arroz',
      quantidade: 2,
      total: 4000,
      autorizadoPorId: 3,
    })

    const linhas = await auditoriaRepo.listar()
    expect(linhas).toHaveLength(1)
    expect(linhas[0].acao).toBe('venda_item_cancelar')
    expect(linhas[0].usuarioId).toBe(1)

    const detalhe = JSON.parse(linhas[0].detalheJson ?? '{}')
    expect(detalhe.autorizadoPorId).toBe(3)
    // Critério 8: quem fez e quem autorizou nunca são o mesmo quando houve
    // autorização — é o que dá sentido ao registro.
    expect(detalhe.autorizadoPorId).not.toBe(linhas[0].usuarioId)
  })

  it('registros se acumulam, nunca se sobrescrevem', async () => {
    await auditoriaRepo.registrar(1, 'desconto_item', { bps: 800 })
    await auditoriaRepo.registrar(1, 'desconto_venda', { bps: 300 })
    await auditoriaRepo.registrar(1, 'venda_cancelar_carrinho', { total: 1000 })

    const linhas = await auditoriaRepo.listar()
    expect(linhas).toHaveLength(3)
    expect(linhas.map((l) => l.acao).sort()).toEqual([
      'desconto_item',
      'desconto_venda',
      'venda_cancelar_carrinho',
    ])
  })
})
