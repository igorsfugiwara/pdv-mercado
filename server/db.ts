import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.pg'

export type Db = PostgresJsDatabase<typeof schema>

// Em serverless cada invocação pode reusar o mesmo processo: guardamos o cliente
// no globalThis para não abrir uma conexão nova por request (e estourar o limite
// do Postgres). `max: 1` porque cada instância da function é single-flight —
// o pooling de verdade é do lado do provedor (use a connection string *pooled*).
declare global {
  var __pdvSql: ReturnType<typeof postgres> | undefined
  var __pdvDb: Db | undefined
}

function connectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL não configurada. Veja .env.example e o guia em docs/DEPLOY_VERCEL.md.',
    )
  }
  return url
}

/**
 * Injeta um banco alternativo. Usado pelos testes, que rodam contra PGlite
 * (Postgres de verdade em WASM) em vez de abrir conexão de rede.
 */
export function setDbParaTestes(db: unknown | null) {
  globalThis.__pdvDb = (db as Db) ?? undefined
}

export function getDb(): Db {
  if (globalThis.__pdvDb) return globalThis.__pdvDb
  const sql = globalThis.__pdvSql ?? postgres(connectionString(), { max: 1, prepare: false })
  globalThis.__pdvSql = sql
  const db = drizzle(sql, { schema })
  globalThis.__pdvDb = db
  return db
}

/** Cliente cru — usado pelo setup/seed para rodar DDL. */
export function getSql() {
  const sql = globalThis.__pdvSql ?? postgres(connectionString(), { max: 1, prepare: false })
  globalThis.__pdvSql = sql
  return sql
}

export { schema }
