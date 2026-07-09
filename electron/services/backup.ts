import { join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync } from 'node:fs'
import log from 'electron-log'
import { getSqlite } from '../db/index'

// RNF-05: backup diário via VACUUM INTO, retenção 30 dias; export manual para pendrive.
const RETENCAO = 30

export function backupAgora(backupsDir: string): { caminho: string } {
  if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destino = join(backupsDir, `pdv-${stamp}.db`)
  // VACUUM INTO gera cópia consistente mesmo com WAL ativo.
  getSqlite().exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`)
  aplicarRetencao(backupsDir)
  log.info(`[backup] gerado ${destino}`)
  return { caminho: destino }
}

export function exportarPara(backupsDir: string, destinoDir: string): { caminho: string } {
  const { caminho } = backupAgora(backupsDir)
  if (!existsSync(destinoDir)) mkdirSync(destinoDir, { recursive: true })
  const destino = join(destinoDir, caminho.split(/[/\\]/).pop()!)
  copyFileSync(caminho, destino)
  return { caminho: destino }
}

function aplicarRetencao(dir: string) {
  const arquivos = readdirSync(dir)
    .filter((f) => f.startsWith('pdv-') && f.endsWith('.db'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
  for (const { f } of arquivos.slice(RETENCAO)) {
    try {
      unlinkSync(join(dir, f))
    } catch (e) {
      log.warn('[backup] falha ao remover antigo', f, e)
    }
  }
}
