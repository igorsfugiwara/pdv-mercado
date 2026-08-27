import argon2 from 'argon2'
import log from 'electron-log'

// RF-20: senha via argon2id; PIN de troca rápida também hasheado (argon2id).
const OPTS: argon2.Options = { type: argon2.argon2id }

export function hashSenha(senha: string): Promise<string> {
  return argon2.hash(senha, OPTS)
}

export function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, OPTS)
}

export async function verificar(hash: string | null, valor: string): Promise<boolean> {
  if (!hash) return false
  try {
    return await argon2.verify(hash, valor)
  } catch (e) {
    // Senha errada NÃO cai aqui — argon2.verify devolve false. Chegar no catch
    // significa hash corrompido ou módulo nativo quebrado (ABI do Electron), e
    // engolir isso em silêncio faz uma falha de instalação parecer senha inválida.
    log.error('[auth] argon2.verify falhou — hash inválido ou módulo nativo incompatível', e)
    return false
  }
}
