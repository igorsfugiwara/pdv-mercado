import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  senha: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

// O desktop usa argon2id (RF-20). Na web o hash é scrypt do `node:crypto`:
// argon2 é módulo nativo e não sobrevive ao bundling da serverless function.
// Formato: scrypt$<salt-hex>$<hash-hex>.
const PREFIXO = 'scrypt'
const KEYLEN = 64

export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16)
  const derivado = await scryptAsync(senha, salt, KEYLEN)
  return `${PREFIXO}$${salt.toString('hex')}$${derivado.toString('hex')}`
}

export const hashPin = hashSenha

export async function verificar(hash: string | null, valor: string): Promise<boolean> {
  if (!hash) return false
  const partes = hash.split('$')
  if (partes.length !== 3 || partes[0] !== PREFIXO) return false
  const salt = Buffer.from(partes[1], 'hex')
  const esperado = Buffer.from(partes[2], 'hex')
  try {
    const derivado = await scryptAsync(valor, salt, esperado.length)
    // timingSafeEqual exige mesmo comprimento — já garantido por `esperado.length`.
    return timingSafeEqual(derivado, esperado)
  } catch {
    return false
  }
}

// ---- Sessão por cookie assinado ----
// Sem servidor com estado: o cookie carrega o id do usuário + HMAC-SHA256.

const COOKIE = 'pdv_sessao'
const MAX_IDADE_S = 60 * 60 * 12 // 12h — turno de caixa

function segredo(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET não configurada. Veja .env.example.')
  return s
}

function assinar(payload: string): string {
  return createHmac('sha256', segredo()).update(payload).digest('hex')
}

export function criarCookieSessao(usuarioId: number): string {
  const expiraEm = Date.now() + MAX_IDADE_S * 1000
  const payload = `${usuarioId}.${expiraEm}`
  const valor = `${payload}.${assinar(payload)}`
  return `${COOKIE}=${valor}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${MAX_IDADE_S}`
}

export function limparCookieSessao(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`
}

/** Retorna o id do usuário se o cookie for válido e não expirado; senão null. */
export function lerSessao(cookieHeader: string | undefined): number | null {
  if (!cookieHeader) return null
  const bruto = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
  if (!bruto) return null

  const valor = bruto.slice(COOKIE.length + 1)
  const partes = valor.split('.')
  if (partes.length !== 3) return null
  const [idStr, expiraStr, assinatura] = partes

  const esperada = assinar(`${idStr}.${expiraStr}`)
  const a = Buffer.from(assinatura, 'hex')
  const b = Buffer.from(esperada, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  if (Number(expiraStr) < Date.now()) return null
  const id = Number(idStr)
  return Number.isInteger(id) ? id : null
}
