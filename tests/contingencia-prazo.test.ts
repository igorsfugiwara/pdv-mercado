import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { initDb, getDb, schema } from '../electron/db/index'
import { fiscalRepo } from '../electron/db/repositories/fiscal.repo'
import {
  classificarContingencia,
  piorClasse,
  formatarHoras,
  PRAZO_CONTINGENCIA_HORAS,
} from '../shared/contingencia'
import { montarAlertas } from '../src/lib/painel'
import type { DocumentoFiscal } from '../shared/types'

/**
 * Fatia 10 — contingência com prazo visível.
 *
 * O prazo de 24 h é legal, não convenção: passado ele, não é aviso amarelo, é
 * problema fiscal com multa.
 */
const MIGRATIONS = join(__dirname, '..', 'electron', 'db', 'migrations')
const AGORA = Date.UTC(2026, 8, 20, 12, 0, 0)
const HORA = 3_600_000

const emitidoHa = (horas: number) => new Date(AGORA - horas * HORA).toISOString()

describe('classificação por idade', () => {
  it('menos de 1 h é normal — a fila ainda está trabalhando', () => {
    expect(classificarContingencia(emitidoHa(0.5), AGORA).classe).toBe('normal')
  })

  it('entre 1 h e 12 h é atenção', () => {
    expect(classificarContingencia(emitidoHa(3), AGORA).classe).toBe('atencao')
  })

  it('entre 12 h e 24 h é urgente', () => {
    expect(classificarContingencia(emitidoHa(13), AGORA).classe).toBe('urgente')
  })

  it('a partir de 24 h está vencido', () => {
    const s = classificarContingencia(emitidoHa(25), AGORA)
    expect(s.classe).toBe('vencido')
    expect(s.mensagem).toMatch(/prazo.*já passou/i)
  })

  it('as bordas caem na faixa de cima — a lei não dá folga', () => {
    // 1 h exata já é atenção; 12 h exatas já são urgentes; 24 h exatas, vencido.
    expect(classificarContingencia(emitidoHa(1), AGORA).classe).toBe('atencao')
    expect(classificarContingencia(emitidoHa(12), AGORA).classe).toBe('urgente')
    expect(classificarContingencia(emitidoHa(24), AGORA).classe).toBe('vencido')
  })

  it('informa quanto falta enquanto não venceu', () => {
    const s = classificarContingencia(emitidoHa(20), AGORA)
    expect(Math.round(s.horasRestantes)).toBe(4)
    expect(s.mensagem).toMatch(/restam/i)
  })

  it('o prazo é configurável e as faixas acompanham', () => {
    // Com prazo de 2 h, um documento de 1,5 h já é urgente.
    expect(classificarContingencia(emitidoHa(1.5), AGORA, 2).classe).toBe('urgente')
    expect(classificarContingencia(emitidoHa(3), AGORA, 2).classe).toBe('vencido')
  })

  it('documento sem data de emissão não vira alarme falso', () => {
    expect(classificarContingencia(null, AGORA).classe).toBe('normal')
    expect(classificarContingencia('data-quebrada', AGORA).classe).toBe('normal')
  })

  it('a idade usa a emissão, não a última tentativa', () => {
    // Reprocessar sem sucesso não reinicia relógio nenhum: o prazo corre desde
    // que a nota foi emitida offline.
    const s = classificarContingencia(emitidoHa(30), AGORA)
    expect(s.classe).toBe('vencido')
    expect(Math.round(s.horas)).toBe(30)
  })
})

describe('pior classe do conjunto', () => {
  it('escolhe a mais grave', () => {
    expect(piorClasse(['normal', 'vencido', 'atencao'])).toBe('vencido')
    expect(piorClasse(['normal', 'atencao'])).toBe('atencao')
    expect(piorClasse([])).toBe('normal')
  })
})

describe('formatação', () => {
  it('escolhe a unidade legível', () => {
    expect(formatarHoras(0.5)).toBe('30 min')
    expect(formatarHoras(3.2)).toBe('3.2 h')
    expect(formatarHoras(72)).toBe('3 dias')
  })
})

describe('painel', () => {
  const vazio = {
    rejeitados: [],
    estoqueMinimo: [],
    inativosPorFiscal: [],
    caixa: null,
    emEspera: [],
  }
  const doc = (horas: number, erro?: string): DocumentoFiscal =>
    ({ id: 1, emitidaEm: emitidoHa(horas), ultimoErro: erro ?? null }) as DocumentoFiscal

  it('contingência recente é média, não alta — a fila está trabalhando', () => {
    const [a] = montarAlertas({
      ...vazio,
      contingencia: [doc(0.2)],
      agora: new Date(AGORA),
    })
    expect(a.gravidade).toBe('media')
  })

  it('contingência de 13 h vira alta', () => {
    const [a] = montarAlertas({
      ...vazio,
      contingencia: [doc(13)],
      agora: new Date(AGORA),
    })
    expect(a.gravidade).toBe('alta')
  })

  it('vencida muda o título', () => {
    const [a] = montarAlertas({
      ...vazio,
      contingencia: [doc(30)],
      agora: new Date(AGORA),
    })
    expect(a.titulo).toMatch(/VENCIDA/)
  })

  it('a idade considerada é a do documento mais antigo', () => {
    const [a] = montarAlertas({
      ...vazio,
      contingencia: [doc(0.5), doc(30)],
      agora: new Date(AGORA),
    })
    expect(a.titulo).toMatch(/VENCIDA/)
    expect(a.quantidade).toBe(2)
  })

  it('mostra o motivo da falha quando há', () => {
    const [a] = montarAlertas({
      ...vazio,
      contingencia: [doc(5)],
      motivoContingencia: 'SEFAZ indisponível',
      agora: new Date(AGORA),
    })
    expect(a.detalhe).toContain('SEFAZ indisponível')
  })

  it('respeita o prazo configurado', () => {
    const [a] = montarAlertas({
      ...vazio,
      contingencia: [doc(3)],
      prazoContingenciaHoras: 2,
      agora: new Date(AGORA),
    })
    expect(a.titulo).toMatch(/VENCIDA/)
  })
})

describe('persistência do diagnóstico', () => {
  beforeEach(() => {
    initDb(':memory:', MIGRATIONS)
    const agora = new Date().toISOString()
    const db = getDb()
    db.insert(schema.usuarios)
      .values({ nome: 'Op', login: 'op', senhaHash: 'x', perfil: 'operador', ativo: true, criadoEm: agora })
      .run()
    db.insert(schema.caixas)
      .values({ usuarioAberturaId: 1, valorAbertura: 0, abertoEm: agora, status: 'aberto' })
      .run()
    db.insert(schema.vendas)
      .values({
        caixaId: 1, usuarioId: 1, clienteCpf: null, subtotal: 100, desconto: 0,
        total: 100, status: 'finalizada', criadoEm: agora,
      })
      .run()
    db.insert(schema.documentosFiscais)
      .values({
        vendaId: 1, modelo: 65, serie: 1, numero: 1,
        status: 'contingencia_pendente', emitidaEm: agora,
      })
      .run()
  })

  it('a migração criou as colunas de diagnóstico', async () => {
    const doc = (await fiscalRepo.listar())[0]
    expect(doc.tentativas).toBe(0)
    expect(doc.ultimoErro ?? null).toBeNull()
  })

  it('grava motivo, horário e contagem de tentativas', async () => {
    const doc = (await fiscalRepo.listar())[0]
    await fiscalRepo.atualizarStatus(doc.id, {
      ultimoErro: 'SEFAZ indisponível',
      ultimaTentativaEm: new Date().toISOString(),
      tentativas: 3,
    })

    const depois = (await fiscalRepo.listar())[0]
    expect(depois.ultimoErro).toBe('SEFAZ indisponível')
    expect(depois.tentativas).toBe(3)
    expect(depois.ultimaTentativaEm).toBeTruthy()
  })

  it('sucesso limpa o erro anterior', async () => {
    const doc = (await fiscalRepo.listar())[0]
    await fiscalRepo.atualizarStatus(doc.id, { ultimoErro: 'falhou', tentativas: 1 })
    await fiscalRepo.atualizarStatus(doc.id, { status: 'autorizada', ultimoErro: null })

    const depois = (await fiscalRepo.listar())[0]
    expect(depois.status).toBe('autorizada')
    expect(depois.ultimoErro).toBeNull()
  })
})

void PRAZO_CONTINGENCIA_HORAS
