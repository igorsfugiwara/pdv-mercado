import { createServer, type Server } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'

/**
 * Servidor mínimo para o E2E da web.
 *
 * `server/router.ts` é uma função pura de canal para handler — um HTTP em cima
 * dele é suficiente e roda em qualquer lugar. Nada de exigir Vercel ou Docker
 * para a suíte passar.
 *
 * O Postgres é o PGlite em processo, o mesmo que os testes de repositório já
 * usam: efêmero por execução, sem serviço externo.
 */

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export interface ServidorE2E {
  url: string
  parar(): Promise<void>
}

export async function subirServidorWeb(raiz: string): Promise<ServidorE2E> {
  // Importados aqui e não no topo: carregam PGlite, que é caro, e o projeto
  // desktop do Playwright não deve pagar por isso.
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const schema = await import('../../server/schema.pg')
  const { setDbParaTestes } = await import('../../server/db')
  const { despachar, HttpError } = await import('../../server/router')

  const cliente = new PGlite()
  const migrações = join(raiz, 'server', 'migrations')
  for (const nome of readdirSync(migrações).filter((n) => n.endsWith('.sql')).sort()) {
    await cliente.exec(readFileSync(join(migrações, nome), 'utf-8'))
  }

  // Injeta a conexão efêmera no módulo de banco do servidor, como os testes de
  // repositório já fazem.
  setDbParaTestes(drizzle(cliente, { schema }))

  // Usuários e produtos de demonstração — os mesmos que o deploy cria no
  // primeiro boot. Sem eles não há operador para abrir caixa nem produto para
  // bipar, e a FK de `caixas` recusa a abertura.
  const { seed } = await import('../../server/setup')
  await seed()

  const dist = join(raiz, 'dist')

  const servidor: Server = createServer(async (req, res) => {
    // ---- API
    if (req.url === '/api/rpc' && req.method === 'POST') {
      let corpo = ''
      for await (const pedaço of req) corpo += pedaço
      try {
        const { canal, args } = JSON.parse(corpo || '{}')
        // Sessão fixa: o teste de guarda de sessão é unitário
        // (tests/web-sessao.test.ts); aqui o foco é o fluxo da tela.
        const ctx = { usuarioId: 3 as number | null }
        const resultado = await despachar(canal, args ?? [], ctx)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, resultado }))
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, erro: e instanceof Error ? e.message : String(e) }))
      }
      return
    }

    // ---- SPA estático
    const caminho = (req.url ?? '/').split('?')[0]
    const arquivo = caminho === '/' ? 'index.html' : caminho.slice(1)
    try {
      const conteudo = readFileSync(join(dist, arquivo))
      res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' })
      res.end(conteudo)
    } catch {
      // SPA: qualquer rota desconhecida devolve o index.
      res.writeHead(200, { 'Content-Type': TIPOS['.html'] })
      res.end(readFileSync(join(dist, 'index.html')))
    }
  })

  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto))
  const endereco = servidor.address()
  const porta = typeof endereco === 'object' && endereco ? endereco.port : 0

  return {
    url: `http://127.0.0.1:${porta}`,
    async parar() {
      await new Promise<void>((pronto) => servidor.close(() => pronto()))
      await cliente.close()
    },
  }
}
