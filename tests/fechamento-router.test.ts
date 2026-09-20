import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { eq } from 'drizzle-orm'
import * as schema from '../server/schema.pg'
import { setDbParaTestes } from '../server/db'
import type { ResultadoFechamento } from '../shared/types'

/**
 * Orquestração do fechamento (RF-11) exercitada pelo router, contra Postgres de
 * verdade. É aqui que moram o limite de diferença, a exigência de justificativa
 * e a auditoria — nada disso está no repositório.
 */
let despachar: typeof import('../server/router')['despachar']
let db: ReturnType<typeof drizzle<typeof schema>>

let operadorId: number
let supervisorId: number
let produtoId: number

async function abrirCaixa(valor = 10000): Promise<number> {
  const caixa = (await despachar('caixa:abrir', [operadorId, valor], {
    usuarioId: operadorId,
  })) as { id: number }
  return caixa.id
}

async function vender(caixaId: number, forma: 'dinheiro' | 'debito', pago: number) {
  await despachar(
    'vendas:finalizar',
    [
      {
        caixaId,
        usuarioId: operadorId,
        clienteCpf: null,
        itens: [
          {
            produtoId,
            descricao: 'Arroz',
            quantidade: 1,
            peso: null,
            precoUnitario: 2000,
            desconto: 0,
          },
        ],
        descontoVenda: 0,
        pagamentos: [{ forma, valor: pago }],
        emitirNfce: false,
      },
    ],
    { usuarioId: operadorId },
  )
}

const fechar = (caixaId: number, contado: number, motivo?: string, autorizadoPorId?: number) =>
  despachar('caixa:fechar', [caixaId, operadorId, contado, motivo, autorizadoPorId], {
    usuarioId: operadorId,
  }) as Promise<ResultadoFechamento>

beforeAll(async () => {
  const client = new PGlite()
  db = drizzle(client, { schema })
  setDbParaTestes(db)
  await client.exec(readFileSync(join(process.cwd(), 'server/migrations/0000_init.sql'), 'utf-8'))

  despachar = (await import('../server/router')).despachar

  const { hashSenha, hashPin } = await import('../server/auth')
  const agora = new Date().toISOString()
  const usuarios = await db
    .insert(schema.usuarios)
    .values([
      {
        nome: 'Op',
        login: 'op',
        senhaHash: await hashSenha('x'),
        pinHash: await hashPin('1111'),
        perfil: 'operador',
        ativo: true,
        criadoEm: agora,
      },
      {
        nome: 'Sup',
        login: 'sup',
        senhaHash: await hashSenha('x'),
        pinHash: await hashPin('2222'),
        perfil: 'supervisor',
        ativo: true,
        criadoEm: agora,
      },
    ])
    .returning()
  operadorId = usuarios[0].id
  supervisorId = usuarios[1].id

  const [p] = await db
    .insert(schema.produtos)
    .values({
      codigoInterno: '1',
      ean: '789',
      descricao: 'Arroz',
      unidade: 'UN',
      pesavel: false,
      precoCusto: 1000,
      precoVenda: 2000,
      estoqueAtual: 1000,
      estoqueMinimo: 2,
      ativo: true,
      ncm: '1',
      cfop: '5102',
      origem: '0',
      csosn: '102',
      criadoEm: agora,
      atualizadoEm: agora,
    })
    .returning()
  produtoId = p.id
})

describe('limite de diferença', () => {
  it('diferença dentro do limite fecha direto', async () => {
    const caixaId = await abrirCaixa(10000)
    await vender(caixaId, 'dinheiro', 2000) // esperado 12000
    const r = await fechar(caixaId, 11500) // falta 500, limite padrão 1000
    expect(r.status).toBe('fechado')
    if (r.status === 'fechado') expect(r.relatorio.conferencia.diferenca).toBe(-500)
  })

  it('no limite exato ainda fecha — a borda que sempre erra', async () => {
    const caixaId = await abrirCaixa(10000)
    const r = await fechar(caixaId, 9000) // falta exatamente 1000
    expect(r.status).toBe('fechado')
  })

  it('acima do limite exige justificativa e mantém o caixa aberto', async () => {
    const caixaId = await abrirCaixa(10000)
    const r = await fechar(caixaId, 8000) // falta 2000 > 1000
    expect(r.status).toBe('requer_justificativa')
    if (r.status === 'requer_justificativa') {
      expect(r.diferenca).toBe(-2000)
      expect(r.limite).toBe(1000)
    }
    const [caixa] = await db.select().from(schema.caixas).where(eq(schema.caixas.id, caixaId))
    expect(caixa.status).toBe('aberto')
  })

  it('com motivo e autorizador, fecha e guarda a justificativa', async () => {
    const caixaId = await abrirCaixa(10000)
    const r = await fechar(caixaId, 8000, 'nota rasgada', supervisorId)
    expect(r.status).toBe('fechado')
    if (r.status === 'fechado') {
      expect(r.relatorio.conferencia.motivo).toBe('nota rasgada')
      expect(r.relatorio.conferencia.diferenca).toBe(-2000)
    }
  })

  it('motivo sem autorizador não basta', async () => {
    const caixaId = await abrirCaixa(10000)
    const r = await fechar(caixaId, 8000, 'só o motivo')
    expect(r.status).toBe('requer_justificativa')
  })

  it('sobra acima do limite também exige justificativa', async () => {
    const caixaId = await abrirCaixa(10000)
    const r = await fechar(caixaId, 15000) // sobra 5000
    expect(r.status).toBe('requer_justificativa')
    if (r.status === 'requer_justificativa') expect(r.diferenca).toBe(5000)
  })

  it('respeita o limite configurado em vez do padrão', async () => {
    await despachar('config:definir', ['caixa.diferenca.limite', '5000'], {
      usuarioId: operadorId,
    })
    const caixaId = await abrirCaixa(10000)
    const r = await fechar(caixaId, 6000) // falta 4000, agora dentro do limite
    expect(r.status).toBe('fechado')
    await despachar('config:definir', ['caixa.diferenca.limite', '1000'], {
      usuarioId: operadorId,
    })
  })
})

describe('auditoria da conferência', () => {
  it('registra toda tentativa, inclusive a recusada por falta de justificativa', async () => {
    const caixaId = await abrirCaixa(10000)
    await fechar(caixaId, 3000) // recusada
    await fechar(caixaId, 4000) // recusada de novo
    await fechar(caixaId, 5000, 'contagem final', supervisorId) // aceita

    const registros = await db
      .select()
      .from(schema.auditoria)
      .where(eq(schema.auditoria.acao, 'caixa_conferencia'))
    const desteCaixa = registros.filter((r) =>
      (r.detalheJson ?? '').includes(`"caixaId":${caixaId}`),
    )
    // Sem esse rastro dá para tentar valores até a diferença zerar e a
    // conferência cega vira teatro.
    expect(desteCaixa.length).toBe(3)
    expect(desteCaixa.map((r) => JSON.parse(r.detalheJson!).contado)).toEqual([3000, 4000, 5000])
  })

  it('o fechamento efetivo gera registro próprio com o autorizador', async () => {
    const caixaId = await abrirCaixa(10000)
    await fechar(caixaId, 5000, 'quebra', supervisorId)
    const registros = await db
      .select()
      .from(schema.auditoria)
      .where(eq(schema.auditoria.acao, 'caixa_fechar'))
    // Filtra pelo caixa deste teste: outros testes da suíte também fecham caixa.
    const [registro] = registros.filter((r) =>
      (r.detalheJson ?? '').includes(`"caixaId":${caixaId}`),
    )
    expect(registro).toBeDefined()
    const detalhe = JSON.parse(registro.detalheJson!)
    expect(detalhe.autorizadoPorId).toBe(supervisorId)
    expect(detalhe.motivo).toBe('quebra')
  })
})

describe('bloqueios pelo router', () => {
  it('venda em espera bloqueia e o caixa continua aberto', async () => {
    const caixaId = await abrirCaixa(10000)
    await db.insert(schema.vendasEspera).values({
      id: `espera-${caixaId}`,
      payloadJson: '{}',
      criadoEm: new Date().toISOString(),
    })

    const r = await fechar(caixaId, 10000)
    expect(r.status).toBe('bloqueado')
    if (r.status === 'bloqueado') expect(r.bloqueios.join(' ')).toMatch(/espera/i)

    const [caixa] = await db.select().from(schema.caixas).where(eq(schema.caixas.id, caixaId))
    expect(caixa.status).toBe('aberto')

    await db.delete(schema.vendasEspera).where(eq(schema.vendasEspera.id, `espera-${caixaId}`))
    expect((await fechar(caixaId, 10000)).status).toBe('fechado')
  })

  it('resumo pré-fechamento não carrega valor monetário', async () => {
    const caixaId = await abrirCaixa(10000)
    await vender(caixaId, 'dinheiro', 2000)
    const resumo = await despachar('caixa:resumoPreFechamento', [caixaId, operadorId], {
      usuarioId: operadorId,
    })
    expect(JSON.stringify(resumo)).not.toContain('10000')
    await fechar(caixaId, 12000)
  })
})
