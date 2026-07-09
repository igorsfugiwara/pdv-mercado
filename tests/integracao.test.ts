import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import * as schema from '../electron/db/schema'

// Integração com SQLite in-memory (PRD 9.1). Reproduz a transação de venda
// diretamente sobre o schema, validando invariante 1, baixa de estoque e agregações.
type Db = ReturnType<typeof drizzle<typeof schema>>
let db: Db
let sqlite: Database.Database

const MIGRATION = readFileSync(
  join(__dirname, '..', 'electron', 'db', 'migrations', '0000_init.sql'),
  'utf-8',
)

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(MIGRATION)
  db = drizzle(sqlite, { schema })
  semear()
})

function semear() {
  const agora = new Date().toISOString()
  db.insert(schema.usuarios)
    .values({ nome: 'Op', login: 'op', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora })
    .run()
  db.insert(schema.produtos)
    .values({
      codigoInterno: '1', ean: '789', descricao: 'Arroz', unidade: 'UN', pesavel: false,
      precoCusto: 1000, precoVenda: 2000, estoqueAtual: 10, estoqueMinimo: 2, ativo: true,
      ncm: '1', cfop: '5102', origem: '0', csosn: '102', criadoEm: agora, atualizadoEm: agora,
    })
    .run()
  db.insert(schema.caixas)
    .values({ usuarioAberturaId: 1, valorAbertura: 10000, abertoEm: agora, status: 'aberto' })
    .run()
  db.insert(schema.movimentosCaixa)
    .values({ caixaId: 1, tipo: 'abertura', valor: 10000, usuarioId: 1, criadoEm: agora })
    .run()
}

// Reproduz o núcleo de vendasRepo.finalizar para 1 item pago em dinheiro com troco.
function venderArrozDinheiro(quantidade: number, valorPago: number) {
  const agora = new Date().toISOString()
  const total = 2000 * quantidade
  db.transaction((tx) => {
    const [venda] = tx.insert(schema.vendas)
      .values({ caixaId: 1, usuarioId: 1, clienteCpf: null, subtotal: total, desconto: 0, total, status: 'finalizada', criadoEm: agora })
      .returning().all()
    tx.insert(schema.vendaItens)
      .values({ vendaId: venda.id, produtoId: 1, descricao: 'Arroz', quantidade, peso: null, precoUnitario: 2000, desconto: 0, total })
      .run()
    // baixa de estoque
    const prod = tx.select().from(schema.produtos).where(eq(schema.produtos.id, 1)).all()[0]
    tx.update(schema.produtos).set({ estoqueAtual: prod.estoqueAtual - quantidade }).where(eq(schema.produtos.id, 1)).run()
    const troco = Math.max(0, valorPago - total)
    tx.insert(schema.vendaPagamentos)
      .values({ vendaId: venda.id, forma: 'dinheiro', valor: valorPago, troco })
      .run()
  })
}

describe('transação de venda (invariante 1 / RF-16)', () => {
  it('baixa o estoque na venda', () => {
    venderArrozDinheiro(3, 6000)
    const [p] = db.select().from(schema.produtos).where(eq(schema.produtos.id, 1)).all()
    expect(p.estoqueAtual).toBe(7)
  })

  it('registra o troco na linha de pagamento em dinheiro', () => {
    venderArrozDinheiro(1, 5000) // total 2000, troco 3000
    const [pag] = db.select().from(schema.vendaPagamentos).all()
    expect(pag.troco).toBe(3000)
  })
})

describe('saldo esperado do caixa (RF-11)', () => {
  it('abertura + vendas em dinheiro - troco', () => {
    venderArrozDinheiro(1, 5000) // recebido 5000, troco 3000 → líquido 2000
    const pagamentos = db.select().from(schema.vendaPagamentos).all()
    const recebido = pagamentos.reduce((a, p) => a + p.valor, 0)
    const troco = pagamentos.reduce((a, p) => a + p.troco, 0)
    const esperado = 10000 + recebido - troco
    expect(esperado).toBe(12000)
  })
})
