import { defineConfig } from 'drizzle-kit'

// As migrations são versionadas em electron/db/migrations e aplicadas em runtime
// pelo processo main (better-sqlite3). O DB de runtime fica em userData/data/pdv.db.
export default defineConfig({
  dialect: 'sqlite',
  schema: './electron/db/schema.ts',
  out: './electron/db/migrations',
})
