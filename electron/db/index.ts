import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import log from 'electron-log'
import * as schema from './schema'

let _db: BetterSQLite3Database<typeof schema> | null = null
let _sqlite: Database.Database | null = null

/**
 * Abre (ou cria) o banco em `dbPath`, aplica PRAGMAs de resiliência
 * (WAL + foreign_keys, RNF-02) e roda migrations pendentes.
 */
export function initDb(dbPath: string, migrationsDir: string) {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  _sqlite = new Database(dbPath)
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('foreign_keys = ON')
  _sqlite.pragma('synchronous = NORMAL')

  runMigrations(_sqlite, migrationsDir)

  _db = drizzle(_sqlite, { schema })
  log.info(`[db] pronto em ${dbPath}`)
  return _db
}

/** Migrator mínimo: aplica arquivos .sql em ordem alfabética, uma única vez. */
function runMigrations(sqlite: Database.Database, migrationsDir: string) {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (nome TEXT PRIMARY KEY, aplicada_em TEXT NOT NULL)`,
  )
  if (!existsSync(migrationsDir)) {
    log.warn(`[db] diretório de migrations ausente: ${migrationsDir}`)
    return
  }
  const aplicadas = new Set(
    sqlite.prepare('SELECT nome FROM _migrations').all().map((r: any) => r.nome),
  )
  const arquivos = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const insert = sqlite.prepare(
    'INSERT INTO _migrations (nome, aplicada_em) VALUES (?, ?)',
  )
  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue
    const sql = readFileSync(join(migrationsDir, arquivo), 'utf-8')
    const tx = sqlite.transaction(() => {
      sqlite.exec(sql)
      insert.run(arquivo, new Date().toISOString())
    })
    tx()
    log.info(`[db] migration aplicada: ${arquivo}`)
  }
}

export function getDb() {
  if (!_db) throw new Error('DB não inicializado. Chame initDb() no boot do main.')
  return _db
}

/** Acesso ao handle bruto do better-sqlite3 (transações manuais, VACUUM INTO). */
export function getSqlite() {
  if (!_sqlite) throw new Error('SQLite não inicializado.')
  return _sqlite
}

export { schema }
