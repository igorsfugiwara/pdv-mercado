import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { initDb, getDb, schema } from '../electron/db/index'
import { configRepo } from '../electron/db/repositories/config.repo'
import { auditoriaRepo } from '../electron/db/repositories/auditoria.repo'
import { verificarRelogio } from '../electron/services/relogioService'
import { _setFiscalParaTestes } from '../electron/fiscal'
import { SimuladoProvider } from '../electron/fiscal/SimuladoProvider'
import {
  compararMonotonico,
  compararComReferencia,
  proximoUltimoVisto,
  descreverDuracao,
  CHAVES_RELOGIO,
  TOLERANCIAS_PADRAO,
} from '../shared/relogio'
import { montarAlertas } from '../src/lib/painel'

/**
 * Fatia 09 — integridade do relógio.
 *
 * O caso que importa é o offline: bateria da placa-mãe acabando faz o relógio
 * voltar no boot, e é isso que a detecção monotônica pega sem rede nenhuma.
 */
const MIGRATIONS = join(__dirname, '..', 'electron', 'db', 'migrations')
const SEGUNDO = 1000
const MINUTO = 60 * SEGUNDO

describe('detecção monotônica (funciona offline)', () => {
  const agora = Date.UTC(2026, 8, 20, 12, 0, 0)

  it('primeiro boot não alerta — não há com o que comparar', () => {
    expect(compararMonotonico(agora, null).gravidade).toBe('ok')
  })

  it('relógio avançando normalmente é ok', () => {
    expect(compararMonotonico(agora, agora - 10 * MINUTO).gravidade).toBe('ok')
  })

  it('recuo dentro da tolerância não alerta', () => {
    // 60 s de recuo com tolerância de 120 s: ruído, não defeito.
    expect(compararMonotonico(agora - 60 * SEGUNDO, agora).gravidade).toBe('ok')
  })

  it('recuo de 10 minutos alerta', () => {
    const v = compararMonotonico(agora - 10 * MINUTO, agora)
    expect(v.gravidade).toBe('alerta')
    expect(v.desvioSegundos).toBe(-600)
    expect(v.fonte).toBe('monotonica')
    expect(v.mensagem).toMatch(/bateria/i)
  })

  it('recuo de 2 horas exige ciência do operador', () => {
    const v = compararMonotonico(agora - 120 * MINUTO, agora)
    expect(v.gravidade).toBe('bloqueio')
  })

  it('a borda do bloqueio (60 min) já bloqueia', () => {
    const v = compararMonotonico(agora - 60 * MINUTO, agora)
    expect(v.gravidade).toBe('bloqueio')
  })

  it('não detecta relógio adiantado — para frente é indistinguível do tempo passando', () => {
    expect(compararMonotonico(agora + 5 * 3600 * SEGUNDO, agora).gravidade).toBe('ok')
  })

  it('último visto inválido é tratado como ausente', () => {
    expect(compararMonotonico(agora, Number.NaN).gravidade).toBe('ok')
  })
})

describe('comparação com referência de rede', () => {
  const agora = Date.UTC(2026, 8, 20, 12, 0, 0)

  it('dentro da tolerância é ok', () => {
    expect(compararComReferencia(agora, agora - 30 * SEGUNDO, 'sefaz').gravidade).toBe('ok')
  })

  it('adiantado 10 min alerta e diz o sentido', () => {
    const v = compararComReferencia(agora + 10 * MINUTO, agora, 'sefaz')
    expect(v.gravidade).toBe('alerta')
    expect(v.desvioSegundos).toBe(600)
    expect(v.mensagem).toMatch(/adiantado/)
  })

  it('atrasado 10 min também alerta', () => {
    const v = compararComReferencia(agora - 10 * MINUTO, agora, 'sefaz')
    expect(v.desvioSegundos).toBe(-600)
    expect(v.mensagem).toMatch(/atrasado/)
  })

  it('desvio grande bloqueia', () => {
    expect(compararComReferencia(agora + 3 * 3600 * SEGUNDO, agora, 'sefaz').gravidade).toBe(
      'bloqueio',
    )
  })

  it('a tolerância é configurável', () => {
    const tol = { toleranciaSegundos: 5, bloqueioMinutos: 1 }
    expect(compararComReferencia(agora + 10 * SEGUNDO, agora, 'sefaz', tol).gravidade).toBe(
      'alerta',
    )
  })
})

describe('marco do último visto', () => {
  it('nunca recua — senão um relógio errado normalizaria o histórico', () => {
    expect(proximoUltimoVisto(1000, 5000)).toBe(5000)
    expect(proximoUltimoVisto(9000, 5000)).toBe(9000)
    expect(proximoUltimoVisto(1000, null)).toBe(1000)
  })
})

describe('descrição de duração', () => {
  it('escolhe a unidade legível', () => {
    expect(descreverDuracao(45)).toBe('45 s')
    expect(descreverDuracao(600)).toBe('10 min')
    expect(descreverDuracao(7200)).toBe('2 h')
    expect(descreverDuracao(60 * 60 * 72)).toBe('3 dias')
  })
})

describe('serviço, contra o banco', () => {
  beforeEach(() => {
    initDb(':memory:', MIGRATIONS)
    _setFiscalParaTestes(new SimuladoProvider())
  })

  it('primeiro boot grava o marco e não alerta', async () => {
    const v = await verificarRelogio()
    expect(v.gravidade).toBe('ok')

    const marco = await configRepo.obter(CHAVES_RELOGIO.ultimoVisto)
    expect(Number(marco)).toBeGreaterThan(0)
  })

  it('relógio que voltou dispara alerta e auditoria', async () => {
    // Simula um marco no futuro — é o que a máquina veria depois de a bateria
    // morrer e o relógio voltar.
    await configRepo.definir(CHAVES_RELOGIO.ultimoVisto, String(Date.now() + 30 * MINUTO))

    const v = await verificarRelogio()
    expect(v.gravidade).toBe('alerta')

    const linhas = await auditoriaRepo.listar()
    const registro = linhas.find((l) => l.acao === 'relogio_desvio')
    expect(registro).toBeDefined()
    const detalhe = JSON.parse(registro!.detalheJson ?? '{}')
    expect(detalhe.fonte).toBe('monotonica')
    expect(detalhe.desvioSegundos).toBeLessThan(0)
  })

  it('o marco não recua depois de um desvio', async () => {
    const futuro = Date.now() + 30 * MINUTO
    await configRepo.definir(CHAVES_RELOGIO.ultimoVisto, String(futuro))
    await verificarRelogio()

    const marco = Number(await configRepo.obter(CHAVES_RELOGIO.ultimoVisto))
    expect(marco).toBe(futuro)
  })

  it('tolerância configurada é respeitada', async () => {
    await configRepo.definir(CHAVES_RELOGIO.toleranciaSegundos, '3600')
    await configRepo.definir(CHAVES_RELOGIO.ultimoVisto, String(Date.now() + 30 * MINUTO))

    // 30 min de recuo com tolerância de 1 h: silêncio.
    expect((await verificarRelogio()).gravidade).toBe('ok')
  })

  it('nunca lança — verificar a hora não pode impedir a loja de vender', async () => {
    _setFiscalParaTestes(null) // getFiscalProvider() vai estourar
    await expect(verificarRelogio()).resolves.toBeDefined()
  })
})

describe('integração com o painel', () => {
  const vazio = {
    contingencia: [],
    rejeitados: [],
    estoqueMinimo: [],
    inativosPorFiscal: [],
    caixa: null,
    emEspera: [],
  }

  it('relógio ok não vira alerta', () => {
    const alertas = montarAlertas({
      ...vazio,
      relogio: { gravidade: 'ok', desvioSegundos: 0, fonte: 'monotonica', mensagem: '' },
    })
    expect(alertas).toEqual([])
  })

  it('relógio desviado entra como gravidade alta e leva à configuração', () => {
    const alertas = montarAlertas({
      ...vazio,
      relogio: {
        gravidade: 'alerta',
        desvioSegundos: -600,
        fonte: 'monotonica',
        mensagem: 'O relógio voltou 10 min.',
      },
    })
    expect(alertas).toHaveLength(1)
    expect(alertas[0].gravidade).toBe('alta')
    expect(alertas[0].rota).toBe('/config')
  })

  it('vem antes da contingência: é causa, não sintoma', () => {
    const alertas = montarAlertas({
      ...vazio,
      contingencia: [{ id: 1 } as never],
      relogio: {
        gravidade: 'alerta',
        desvioSegundos: -600,
        fonte: 'monotonica',
        mensagem: 'x',
      },
    })
    expect(alertas[0].id).toBe('relogio')
  })
})

// Mantém a referência usada no describe acima sem exportar nada extra.
void TOLERANCIAS_PADRAO
void schema
void getDb
