import { eq, like, or, and, asc } from 'drizzle-orm'
import { getDb } from '../index'
import { produtos, grupos, vendaItens } from '../schema'
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
    const rows = await db
      .select()
      .from(produtos)
      .where(
        and(
          eq(produtos.ativo, true),
          or(
            like(produtos.descricao, t),
            like(produtos.ean, t),
            like(produtos.codigoInterno, t),
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

  async salvar(input: ProdutoInput): Promise<Produto> {
    const db = getDb()
    const agora = new Date().toISOString()
    // Não deixa ativar sem campos fiscais completos (RF-14).
    const ativo = input.ativo && faltamCamposFiscais(input).length === 0
    if (input.id) {
      await db
        .update(produtos)
        .set({ ...input, ativo, atualizadoEm: agora })
        .where(eq(produtos.id, input.id))
      const [row] = await db.select().from(produtos).where(eq(produtos.id, input.id))
      return row as Produto
    }
    const [row] = await db
      .insert(produtos)
      .values({ ...input, ativo, criadoEm: agora, atualizadoEm: agora })
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
