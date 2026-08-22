import type { VercelRequest, VercelResponse } from '@vercel/node'
import { despachar, HttpError, type Contexto } from '../server/router'
import { lerSessao, criarCookieSessao, limparCookieSessao } from '../server/auth'

/**
 * Endpoint único do PDV web. Espelha o `ipcMain.handle` do desktop: o corpo traz
 * o mesmo nome de canal de `shared/ipc.ts` mais os argumentos posicionais.
 *
 *   POST /api/rpc  { "canal": "produtos:buscar", "args": ["arroz"] }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ erro: 'Use POST.' })
  }

  const { canal, args } = (req.body ?? {}) as { canal?: string; args?: unknown[] }
  if (typeof canal !== 'string') {
    return res.status(400).json({ erro: 'Campo "canal" obrigatório.' })
  }

  const ctx: Contexto = { usuarioId: lerSessao(req.headers.cookie) }

  try {
    const resultado = await despachar(canal, Array.isArray(args) ? args : [], ctx)

    if (ctx.efeito?.tipo === 'entrar') {
      res.setHeader('Set-Cookie', criarCookieSessao(ctx.efeito.usuarioId))
    } else if (ctx.efeito?.tipo === 'sair') {
      res.setHeader('Set-Cookie', limparCookieSessao())
    }

    // `undefined` não é JSON válido — handlers sem retorno viram null.
    return res.status(200).json({ ok: true, resultado: resultado ?? null })
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 400
    const mensagem = e instanceof Error ? e.message : 'Erro inesperado.'
    // Erro de regra de negócio é esperado (ex.: "Pagamento insuficiente") e a UI
    // mostra a mensagem ao operador; 5xx fica só para falha real de infra.
    if (status >= 500) console.error('[rpc]', canal, e)
    return res.status(status).json({ ok: false, erro: mensagem })
  }
}
