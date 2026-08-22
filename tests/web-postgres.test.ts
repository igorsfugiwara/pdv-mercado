import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../server/schema.pg'
import { setDbParaTestes } from '../server/db'

/**
 * Exercita a camada web contra Postgres DE VERDADE (PGlite = Postgres em WASM),
 * não contra um mock. É o que prova que o porte de SQLite→Postgres está correto:
 * GROUP BY estrito, casts de sum()/count(), ILIKE, transações e FKs se comportam
 * aqui exatamente como no Neon/Supabase.
 */

// Importados depois de injetar o banco — os repos chamam getDb() no uso, não no import.
let repos: {
  produtosRepo: typeof import('../server/repos/produtos.repo')['produtosRepo']
  caixaRepo: typeof import('../server/repos/caixa.repo')['caixaRepo']
  vendasRepo: typeof import('../server/repos/vendas.repo')['vendasRepo']
  relatoriosRepo: typeof import('../server/repos/relatorios.repo')['relatoriosRepo']
  estoqueRepo: typeof import('../server/repos/estoque.repo')['estoqueRepo']
  usuariosRepo: typeof import('../server/repos/usuarios.repo')['usuariosRepo']
}

let usuarioId: number
let caixaId: number
let arrozId: number
let bananaId: number

const hoje = new Date().toISOString().slice(0, 10)

beforeAll(async () => {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  setDbParaTestes(db)

  const ddl = readFileSync(join(process.cwd(), 'server/migrations/0000_init.sql'), 'utf-8')
  await client.exec(ddl)

  repos = {
    produtosRepo: (await import('../server/repos/produtos.repo')).produtosRepo,
    caixaRepo: (await import('../server/repos/caixa.repo')).caixaRepo,
    vendasRepo: (await import('../server/repos/vendas.repo')).vendasRepo,
    relatoriosRepo: (await import('../server/repos/relatorios.repo')).relatoriosRepo,
    estoqueRepo: (await import('../server/repos/estoque.repo')).estoqueRepo,
    usuariosRepo: (await import('../server/repos/usuarios.repo')).usuariosRepo,
  }

  const { hashSenha, hashPin } = await import('../server/auth')
  const agora = new Date().toISOString()
  const [u] = await db
    .insert(schema.usuarios)
    .values({
      nome: 'Operador Caixa',
      login: 'caixa',
      senhaHash: await hashSenha('caixa123'),
      pinHash: await hashPin('1111'),
      perfil: 'operador',
      ativo: true,
      criadoEm: agora,
    })
    .returning()
  usuarioId = u.id

  const [grupo] = await db.insert(schema.grupos).values({ nome: 'Mercearia' }).returning()

  const fiscal = {
    ncm: '10063021',
    cfop: '5102',
    origem: '0',
    csosn: '102',
    ativo: true,
    criadoEm: agora,
    atualizadoEm: agora,
    grupoId: grupo.id,
  }
  const inseridos = await db
    .insert(schema.produtos)
    .values([
      {
        codigoInterno: '1001',
        ean: '7891000100103',
        descricao: 'Arroz Branco 5kg',
        unidade: 'UN',
        pesavel: false,
        precoCusto: 1800,
        precoVenda: 2790,
        estoqueAtual: 40,
        estoqueMinimo: 10,
        ...fiscal,
      },
      {
        codigoInterno: '2001',
        descricao: 'Banana Prata (kg)',
        unidade: 'KG',
        pesavel: true,
        precoCusto: 300,
        precoVenda: 599,
        estoqueAtual: 25.5,
        estoqueMinimo: 5,
        ...fiscal,
      },
    ])
    .returning()
  arrozId = inseridos[0].id
  bananaId = inseridos[1].id

  const caixa = await repos.caixaRepo.abrir(usuarioId, 10000)
  caixaId = caixa.id
})

describe('auth', () => {
  it('valida senha com scrypt e não devolve os hashes', async () => {
    const u = await repos.usuariosRepo.porLogin('caixa', 'caixa123')
    expect(u?.nome).toBe('Operador Caixa')
    expect(u).not.toHaveProperty('senhaHash')
    expect(u).not.toHaveProperty('pinHash')
    expect(await repos.usuariosRepo.porLogin('caixa', 'errada')).toBeNull()
  })

  it('autoriza supervisor por PIN respeitando o perfil', async () => {
    expect(await repos.usuariosRepo.porPin('1111', ['admin', 'supervisor'])).toBeNull()
    expect(await repos.usuariosRepo.porPin('1111')).not.toBeNull()
  })
})

describe('produtos', () => {
  // Regressão do porte: no Postgres LIKE é case-sensitive, então `like` faria
  // a busca do caixa falhar em qualquer termo fora da capitalização exata.
  it('busca é case-insensitive', async () => {
    const r = await repos.produtosRepo.buscar('arroz')
    expect(r.map((p) => p.descricao)).toContain('Arroz Branco 5kg')
  })

  it('acha por EAN e por código interno', async () => {
    expect((await repos.produtosRepo.porEan('7891000100103'))?.id).toBe(arrozId)
    expect((await repos.produtosRepo.buscar('2001')).map((p) => p.id)).toContain(bananaId)
  })

  it('não ativa produto sem os campos fiscais (RF-14)', async () => {
    const p = await repos.produtosRepo.salvar({
      codigoInterno: '9999',
      ean: null,
      descricao: 'Sem fiscal',
      unidade: 'UN',
      pesavel: false,
      precoCusto: 100,
      precoVenda: 200,
      estoqueAtual: 1,
      estoqueMinimo: 0,
      grupoId: null,
      imagemPath: null,
      ativo: true,
      ncm: null,
      cest: null,
      cfop: null,
      origem: null,
      csosn: null,
      cstPis: null,
      aliqPis: null,
      cstCofins: null,
      aliqCofins: null,
    })
    expect(p.ativo).toBe(false)
  })

  it('preserva fracionário de KG (double precision, não real)', async () => {
    const banana = (await repos.produtosRepo.listar()).find((p) => p.id === bananaId)!
    expect(banana.estoqueAtual).toBe(25.5)
  })
})

describe('venda — transação única (invariante 1)', () => {
  it('grava venda, baixa estoque, calcula troco e reserva número fiscal', async () => {
    const { venda, documento } = await repos.vendasRepo.finalizar({
      caixaId,
      usuarioId,
      clienteCpf: null,
      itens: [
        {
          produtoId: arrozId,
          descricao: 'Arroz Branco 5kg',
          quantidade: 2,
          peso: null,
          precoUnitario: 2790,
          desconto: 0,
        },
        {
          produtoId: bananaId,
          descricao: 'Banana Prata (kg)',
          quantidade: 1.5,
          peso: 1.5,
          precoUnitario: 599,
          desconto: 0,
        },
      ],
      descontoVenda: 0,
      pagamentos: [{ forma: 'dinheiro', valor: 8000 }],
      emitirNfce: true,
    })

    // 2×2790 + round(599×1.5)=899 → 6479
    expect(venda.total).toBe(6479)
    expect(documento?.numero).toBe(1)
    expect(documento?.status).toBe('pendente')

    const arroz = (await repos.produtosRepo.listar()).find((p) => p.id === arrozId)!
    expect(arroz.estoqueAtual).toBe(38)
    const banana = (await repos.produtosRepo.listar()).find((p) => p.id === bananaId)!
    expect(banana.estoqueAtual).toBe(24)
  })

  it('numeração fiscal é sequencial e não reutiliza (invariante 2)', async () => {
    const { documento } = await repos.vendasRepo.finalizar({
      caixaId,
      usuarioId,
      clienteCpf: null,
      itens: [
        {
          produtoId: arrozId,
          descricao: 'Arroz Branco 5kg',
          quantidade: 1,
          peso: null,
          precoUnitario: 2790,
          desconto: 0,
        },
      ],
      descontoVenda: 0,
      pagamentos: [{ forma: 'pix', valor: 2790 }],
      emitirNfce: true,
    })
    expect(documento?.numero).toBe(2)
  })

  it('recusa pagamento insuficiente sem deixar resíduo no banco', async () => {
    const antes = (await repos.produtosRepo.listar()).find((p) => p.id === arrozId)!.estoqueAtual
    await expect(
      repos.vendasRepo.finalizar({
        caixaId,
        usuarioId,
        clienteCpf: null,
        itens: [
          {
            produtoId: arrozId,
            descricao: 'Arroz Branco 5kg',
            quantidade: 1,
            peso: null,
            precoUnitario: 2790,
            desconto: 0,
          },
        ],
        descontoVenda: 0,
        pagamentos: [{ forma: 'dinheiro', valor: 100 }],
        emitirNfce: false,
      }),
    ).rejects.toThrow(/insuficiente/i)
    const depois = (await repos.produtosRepo.listar()).find((p) => p.id === arrozId)!.estoqueAtual
    expect(depois).toBe(antes)
  })

  it('cancelamento estorna estoque e é idempotente', async () => {
    const { venda } = await repos.vendasRepo.finalizar({
      caixaId,
      usuarioId,
      clienteCpf: null,
      itens: [
        {
          produtoId: arrozId,
          descricao: 'Arroz Branco 5kg',
          quantidade: 3,
          peso: null,
          precoUnitario: 2790,
          desconto: 0,
        },
      ],
      descontoVenda: 0,
      pagamentos: [{ forma: 'debito', valor: 8370 }],
      emitirNfce: false,
    })
    const aposVenda = (await repos.produtosRepo.listar()).find((p) => p.id === arrozId)!.estoqueAtual

    await repos.vendasRepo.cancelar(venda.id, usuarioId)
    const aposCancelar = (await repos.produtosRepo.listar()).find(
      (p) => p.id === arrozId,
    )!.estoqueAtual
    expect(aposCancelar).toBe(aposVenda + 3)

    // Segundo cancelamento não pode estornar de novo.
    await expect(repos.vendasRepo.cancelar(venda.id, usuarioId)).rejects.toThrow()
    const final = (await repos.produtosRepo.listar()).find((p) => p.id === arrozId)!.estoqueAtual
    expect(final).toBe(aposCancelar)
  })
})

describe('caixa', () => {
  it('saldo esperado soma abertura e dinheiro líquido de troco', async () => {
    const saldo = await repos.caixaRepo.saldoEsperado(caixaId)
    // abertura 10000 + (recebido 8000 - troco 1521) da 1ª venda = 16479
    expect(saldo).toBe(16479)
  })

  it('rejeita sangria com valor não positivo', async () => {
    await expect(
      repos.caixaRepo.movimentar(caixaId, 'sangria', 0, 'teste', usuarioId, usuarioId),
    ).rejects.toThrow(/positivo/i)
  })
})

describe('relatórios — agregações portadas', () => {
  // Regressão do porte: sem os casts, sum()/count() voltam como STRING do driver
  // e o ticket médio vira concatenação em vez de aritmética.
  it('devolve números, não strings, e calcula ticket médio', async () => {
    const rel = await repos.relatoriosRepo.vendas({ de: hoje, ate: hoje })
    expect(typeof rel.resumo.total).toBe('number')
    expect(typeof rel.resumo.quantidadeVendas).toBe('number')
    expect(rel.resumo.quantidadeVendas).toBeGreaterThan(0)
    expect(rel.resumo.ticketMedio).toBe(
      Math.round(rel.resumo.total / rel.resumo.quantidadeVendas),
    )
  })

  // Regressão do porte: GROUP BY do Postgres é estrito — estas três agregações
  // selecionam colunas fora do GROUP BY e quebrariam sem o ajuste.
  it('agrupa por operador, produto e grupo sem violar o GROUP BY', async () => {
    const rel = await repos.relatoriosRepo.vendas({ de: hoje, ate: hoje })
    expect(rel.porOperador[0].nome).toBe('Operador Caixa')
    expect(rel.porProduto.length).toBeGreaterThan(0)
    expect(rel.porProduto.every((l) => typeof l.descricao === 'string')).toBe(true)
    expect(rel.porGrupo[0].nome).toBe('Mercearia')
  })

  it('por forma desconta o troco para bater com o faturamento', async () => {
    const rel = await repos.relatoriosRepo.vendas({ de: hoje, ate: hoje })
    const somaFormas = rel.porForma.reduce((a, f) => a + f.valor, 0)
    expect(somaFormas).toBe(rel.resumo.total)
  })

  it('curva ABC classifica e acumula até 100%', async () => {
    const abc = await repos.relatoriosRepo.curvaAbc(hoje, hoje)
    expect(abc.length).toBeGreaterThan(0)
    expect(abc[0].classe).toBe('A')
    expect(abc[abc.length - 1].percentualAcumulado).toBeCloseTo(100, 5)
  })
})

describe('estoque', () => {
  it('entrada soma e ajuste grava o delta correto', async () => {
    await repos.estoqueRepo.entrada(arrozId, 10, usuarioId, 'NF 123')
    const apos = (await repos.produtosRepo.listar()).find((p) => p.id === arrozId)!.estoqueAtual

    await repos.estoqueRepo.ajuste(arrozId, 5, usuarioId)
    const final = (await repos.produtosRepo.listar()).find((p) => p.id === arrozId)!.estoqueAtual
    expect(final).toBe(5)
    expect(apos).toBeGreaterThan(5)
  })

  it('alerta de estoque mínimo pega o produto abaixo do piso', async () => {
    const alertas = await repos.estoqueRepo.alertasMinimo()
    expect(alertas.map((p) => p.id)).toContain(arrozId)
  })
})
