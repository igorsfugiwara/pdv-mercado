import { eq, ilike, or, and, asc } from 'drizzle-orm'
import { getDb } from '../db'
import { produtos, grupos, vendaItens } from '../schema.pg'
import type { Produto, Grupo } from '@shared/types'
import type { ProdutoInput } from '@shared/ipc'

// Campos fiscais obrigatórios para ativar um produto (RF-14).
const CAMPOS_FISCAIS: Array<keyof Produto> = ['ncm', 'cfop', 'origem', 'csosn']

export function faltamCamposFiscais(p: Partial<Produto>): string[] {
  return CAMPOS_FISCAIS.filter((c) => !p[c]).map(String)
}

export const produtosRepo = {
  async listar(incluirInativos = false): Promise<Produto[]> {
    const db = getDb()
    const rows = incluirInativos
      ? await db.select().from(produtos).orderBy(asc(produtos.descricao))
      : await db
          .select()
          .from(produtos)
          .where(eq(produtos.ativo, true))
          .orderBy(asc(produtos.descricao))
    return rows as Produto[]
  },

  async buscar(termo: string): Promise<Produto[]> {
    const db = getDb()
    const t = `%${termo}%`
    // `ilike`, não `like`: o LIKE do SQLite é case-insensitive para ASCII e o do
    // Postgres não é — com `like` a busca do caixa deixaria de achar "arroz".
    const rows = await db
      .select()
      .from(produtos)
      .where(
        and(
          eq(produtos.ativo, true),
          or(
            ilike(produtos.descricao, t),
            ilike(produtos.ean, t),
            ilike(produtos.codigoInterno, t),
          ),
        ),
      )
      .limit(50)
    return rows as Produto[]
  },

  async porEan(ean: string): Promise<Produto | null> {
    const db = getDb()
    const [row] = await db
      .select()
      .from(produtos)
      .where(and(eq(produtos.ean, ean), eq(produtos.ativo, true)))
    return (row as Produto) ?? null
  },

  /** Espelho de `porCodigoInterno` do desktop — mesma etiqueta, mesmo contrato. */
  async porCodigoInterno(codigo: string): Promise<Produto | null> {
    const db = getDb()
    const [row] = await db.select().from(produtos).where(eq(produtos.codigoInterno, codigo))
    return (row as Produto) ?? null
  },

  async salvar(input: ProdutoInput): Promise<Produto> {
    const db = getDb()
    const agora = new Date().toISOString()
    // Não deixa ativar sem campos fiscais completos (RF-14).
    const ativo = input.ativo && faltamCamposFiscais(input).length === 0
    if (input.id) {
      const { id, ...campos } = input
      await db
        .update(produtos)
        .set({ ...campos, ativo, atualizadoEm: agora })
        .where(eq(produtos.id, id))
      const [row] = await db.select().from(produtos).where(eq(produtos.id, id))
      return row as Produto
    }
    const { id: _ignorado, ...campos } = input
    const [row] = await db
      .insert(produtos)
      .values({ ...campos, ativo, criadoEm: agora, atualizadoEm: agora })
      .returning()
    return row as Produto
  },

  async temHistoricoVenda(id: number): Promise<boolean> {
    const db = getDb()
    const [row] = await db
      .select({ id: vendaItens.id })
      .from(vendaItens)
      .where(eq(vendaItens.produtoId, id))
      .limit(1)
    return !!row
  },

  async setAtivo(id: number, ativo: boolean) {
    const db = getDb()
    await db
      .update(produtos)
      .set({ ativo, atualizadoEm: new Date().toISOString() })
      .where(eq(produtos.id, id))
  },

  async excluir(id: number) {
    const db = getDb()
    await db.delete(produtos).where(eq(produtos.id, id))
  },

  async listarGrupos(): Promise<Grupo[]> {
    const db = getDb()
    return (await db.select().from(grupos).orderBy(asc(grupos.nome))) as Grupo[]
  },
}
