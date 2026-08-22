import { describe, it, expect, beforeAll } from 'vitest'

/**
 * Cookie de sessão e guarda de autenticação do RPC. É a superfície que fica
 * exposta na internet — no desktop nada disso existia (o IPC já era confiável).
 */

beforeAll(() => {
  process.env.SESSION_SECRET = 'segredo-de-teste-0123456789abcdef'
})

describe('cookie de sessão', () => {
  it('ida e volta devolve o usuário assinado', async () => {
    const { criarCookieSessao, lerSessao } = await import('../server/auth')
    const cookie = criarCookieSessao(42)
    const valor = cookie.split(';')[0]
    expect(lerSessao(valor)).toBe(42)
  })

  it('marca HttpOnly e SameSite', async () => {
    const { criarCookieSessao } = await import('../server/auth')
    const cookie = criarCookieSessao(1)
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)
  })

  it('rejeita assinatura adulterada', async () => {
    const { criarCookieSessao, lerSessao } = await import('../server/auth')
    const valor = criarCookieSessao(42).split(';')[0]
    // Troca o id de 42 para 1 mantendo a assinatura original.
    const adulterado = valor.replace('pdv_sessao=42.', 'pdv_sessao=1.')
    expect(lerSessao(adulterado)).toBeNull()
  })

  it('rejeita cookie expirado', async () => {
    const { lerSessao } = await import('../server/auth')
    const { createHmac } = await import('node:crypto')
    const passado = Date.now() - 1000
    const payload = `7.${passado}`
    const assinatura = createHmac('sha256', process.env.SESSION_SECRET!)
      .update(payload)
      .digest('hex')
    expect(lerSessao(`pdv_sessao=${payload}.${assinatura}`)).toBeNull()
  })

  it('ignora ausência de cookie e lixo', async () => {
    const { lerSessao } = await import('../server/auth')
    expect(lerSessao(undefined)).toBeNull()
    expect(lerSessao('outra=coisa')).toBeNull()
    expect(lerSessao('pdv_sessao=nao-e-valido')).toBeNull()
  })

  it('limpar expira o cookie', async () => {
    const { limparCookieSessao } = await import('../server/auth')
    expect(limparCookieSessao()).toMatch(/Max-Age=0/)
  })
})

describe('guarda do RPC', () => {
  it('bloqueia canal protegido sem sessão com 401', async () => {
    const { despachar, HttpError } = await import('../server/router')
    await expect(despachar('produtos:listar', [], { usuarioId: null })).rejects.toThrow(HttpError)
    await expect(despachar('produtos:listar', [], { usuarioId: null })).rejects.toMatchObject({
      status: 401,
    })
  })

  it('recusa canal inexistente com 404', async () => {
    const { despachar } = await import('../server/router')
    await expect(despachar('nao:existe', [], { usuarioId: 1 })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('login é público — não exige sessão prévia', async () => {
    const { despachar } = await import('../server/router')
    // Sem DATABASE_URL a chamada falha no banco, e não na guarda de sessão:
    // é isso que prova que o canal passou pelo filtro.
    await expect(despachar('auth:login', ['x', 'y'], { usuarioId: null })).rejects.toThrow(
      /DATABASE_URL/,
    )
  })
})
