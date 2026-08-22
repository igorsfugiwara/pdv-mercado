import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSql } from '../server/db'

/**
 * Diagnóstico de configuração — abra /api/health depois do deploy para saber
 * se as variáveis de ambiente e o banco estão de pé antes de tentar o login.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const checagens: Record<string, string> = {
    DATABASE_URL: process.env.DATABASE_URL ? 'definida' : 'AUSENTE',
    SESSION_SECRET: process.env.SESSION_SECRET ? 'definida' : 'AUSENTE',
  }

  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ ok: false, checagens, dica: 'Configure DATABASE_URL na Vercel.' })
  }

  try {
    const sql = getSql()
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from usuarios`
    checagens.banco = 'conectado'
    checagens.usuarios = String(n)
    const pronto = n > 0
    return res.status(pronto ? 200 : 503).json({
      ok: pronto,
      checagens,
      dica: pronto ? undefined : 'Banco vazio — rode `npm run db:setup` com a DATABASE_URL.',
    })
  } catch (e) {
    checagens.banco = 'ERRO'
    return res.status(503).json({
      ok: false,
      checagens,
      erro: e instanceof Error ? e.message : String(e),
      dica: 'Tabelas ausentes? Rode `npm run db:setup` com a DATABASE_URL.',
    })
  }
}
