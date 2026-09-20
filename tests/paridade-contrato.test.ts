import { describe, it, expect } from 'vitest'
import { IPC } from '../shared/ipc'
import { apiWeb } from '../src/web/apiWeb'
import { handlersParaTeste } from '../server/router'

/**
 * Fatia 11 — paridade entre os dois alvos.
 *
 * O backend web é um espelho do desktop: `server/repos/` reimplementa os
 * repositórios e `server/router.ts` reimplementa os handlers. Dois caminhos
 * para a mesma regra.
 *
 * O typecheck cobra quando o tipo é exigido. Este teste pega o que ele não
 * pega: canal declarado no contrato e esquecido num dos lados. É barato, e é a
 * classe de erro mais provável deste projeto — nesta rodada sozinha, seis
 * canais novos precisaram ser replicados à mão.
 */

/** Todos os nomes de canal declarados em `shared/ipc.ts`. */
function canaisDoContrato(): string[] {
  const nomes: string[] = []
  for (const grupo of Object.values(IPC)) {
    for (const canal of Object.values(grupo as Record<string, string>)) {
      nomes.push(canal)
    }
  }
  return nomes.sort()
}

/** Métodos que o adapter web expõe, no formato `grupo:metodo` do contrato. */
function canaisDoAdapterWeb(): string[] {
  const nomes: string[] = []
  for (const [grupo, metodos] of Object.entries(IPC)) {
    const impl = (apiWeb as unknown as Record<string, Record<string, unknown>>)[grupo]
    if (!impl) continue
    for (const metodo of Object.keys(metodos as Record<string, string>)) {
      if (typeof impl[metodo] === 'function') {
        nomes.push((metodos as Record<string, string>)[metodo])
      }
    }
  }
  return nomes.sort()
}

/**
 * Canais que a web resolve no próprio navegador, sem ida ao servidor — e por
 * isso não precisam de handler no router. Cada um tem um motivo físico, não de
 * conveniência: não existe porta serial nem impressora térmica num navegador, o
 * download do CSV é do lado do cliente, o dump do banco é do provedor Postgres,
 * e o provider fiscal da web é simulado por definição.
 *
 * Lista explícita de propósito: quem acrescentar canal novo precisa decidir
 * conscientemente de que lado ele mora, em vez de o teste passar em silêncio.
 */
const RESOLVIDOS_NO_CLIENTE = [
  'caixa:imprimirFechamento',
  'fiscal:estado',
  'fiscal:definirProvider',
  'fiscal:definirModoFalha',
  'relatorios:exportarCsv',
  'hardware:testarImpressora',
  'hardware:testarBalanca',
  'hardware:abrirGaveta',
  'hardware:lerPeso',
  'backup:executarAgora',
  'backup:exportarPara',
]

describe('paridade de contrato entre desktop e web', () => {
  it('o adapter web implementa todos os canais do contrato', () => {
    const contrato = canaisDoContrato()
    const web = canaisDoAdapterWeb()
    const faltando = contrato.filter((c) => !web.includes(c))

    expect(faltando).toEqual([])
  })

  it('o router web atende todos os canais do contrato', () => {
    const contrato = canaisDoContrato()
    const atendidos = Object.keys(handlersParaTeste)

    // O que o router não atende, o navegador não consegue chamar — mesmo que o
    // adapter tenha o método.
    const faltando = contrato
      .filter((c) => !atendidos.includes(c))
      .filter((c) => !RESOLVIDOS_NO_CLIENTE.includes(c))

    expect(faltando).toEqual([])
  })

  it('todo canal resolvido no cliente é mesmo implementado pelo adapter', () => {
    // Senão a lista de exceções vira desculpa para canal que não existe em
    // lugar nenhum.
    const web = canaisDoAdapterWeb()
    expect(RESOLVIDOS_NO_CLIENTE.filter((c) => !web.includes(c))).toEqual([])
  })

  it('o router não atende canal que não existe no contrato', () => {
    // Canal órfão é rota viva sem tipo: ninguém chama, e ninguém remove.
    const contrato = canaisDoContrato()
    const orfaos = Object.keys(handlersParaTeste).filter((c) => !contrato.includes(c))
    expect(orfaos).toEqual([])
  })

  it('o teste falha de verdade quando um canal some', () => {
    // Um teste de paridade que nunca falha não protege nada. Aqui a prova de
    // que ele detecta a ausência.
    const contrato = [...canaisDoContrato(), 'inventado:canal']
    const web = canaisDoAdapterWeb()
    expect(contrato.filter((c) => !web.includes(c))).toEqual(['inventado:canal'])
  })
})
