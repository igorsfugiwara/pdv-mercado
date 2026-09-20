import { useCallback, useState, type ReactNode } from 'react'
import Dialogo from './Dialogo'
import { formatBRL, parseBRL } from '../lib/money'

/**
 * Variantes de diálogo e o hook que as expõe como promise.
 *
 * O padrão aqui é guardar o `resolve` da promise em estado — é intencional, e é
 * o que deixa o chamador legível:
 *
 *   const cpf = await pedirTexto({ titulo: 'CPF na nota' })
 *   if (!cpf) return            // Esc ou Cancelar
 */

interface BasePedido {
  titulo: string
  descricao?: string
  valorInicial?: string
  rotuloConfirmar?: string
}

export interface PedidoTexto extends BasePedido {
  /** Erro a exibir, ou null se válido. Roda a cada confirmação, sem fechar. */
  validar?: (valor: string) => string | null
  /** Se true, o campo não ecoa o que é digitado (PIN). */
  secreto?: boolean
  placeholder?: string
}

export interface PedidoValor extends BasePedido {
  /** Valor mínimo em centavos. */
  minimo?: number
}

export interface PedidoQuantidade extends BasePedido {
  /** Casas decimais aceitas — peso usa 3, multiplicador usa 0. */
  casas?: number
  minimo?: number
}

export interface Opcao {
  valor: string
  rotulo: string
  descricao?: string
}

type Pedido =
  | { tipo: 'texto'; pedido: PedidoTexto; resolve: (v: string | null) => void }
  | { tipo: 'valor'; pedido: PedidoValor; resolve: (v: number | null) => void }
  | { tipo: 'quantidade'; pedido: PedidoQuantidade; resolve: (v: number | null) => void }
  | { tipo: 'confirmar'; pedido: BasePedido & { destrutivo?: boolean }; resolve: (v: boolean) => void }
  | { tipo: 'escolher'; pedido: BasePedido & { opcoes: Opcao[] }; resolve: (v: string | null) => void }

export function useDialogos() {
  const [atual, setAtual] = useState<Pedido | null>(null)

  const pedirTexto = useCallback(
    (pedido: PedidoTexto) =>
      new Promise<string | null>((resolve) => setAtual({ tipo: 'texto', pedido, resolve })),
    [],
  )
  const pedirPin = useCallback(
    (pedido: Omit<PedidoTexto, 'secreto'>) =>
      new Promise<string | null>((resolve) =>
        setAtual({ tipo: 'texto', pedido: { ...pedido, secreto: true }, resolve }),
      ),
    [],
  )
  const pedirValor = useCallback(
    (pedido: PedidoValor) =>
      new Promise<number | null>((resolve) => setAtual({ tipo: 'valor', pedido, resolve })),
    [],
  )
  const pedirQuantidade = useCallback(
    (pedido: PedidoQuantidade) =>
      new Promise<number | null>((resolve) => setAtual({ tipo: 'quantidade', pedido, resolve })),
    [],
  )
  const confirmar = useCallback(
    (pedido: BasePedido & { destrutivo?: boolean }) =>
      new Promise<boolean>((resolve) => setAtual({ tipo: 'confirmar', pedido, resolve })),
    [],
  )
  const escolher = useCallback(
    (pedido: BasePedido & { opcoes: Opcao[] }) =>
      new Promise<string | null>((resolve) => setAtual({ tipo: 'escolher', pedido, resolve })),
    [],
  )

  const fechar = useCallback(() => setAtual(null), [])

  const elemento: ReactNode = atual ? (
    <RenderPedido key={atual.tipo + atual.pedido.titulo} pedido={atual} fechar={fechar} />
  ) : null

  return { elemento, pedirTexto, pedirPin, pedirValor, pedirQuantidade, confirmar, escolher }
}

function RenderPedido({ pedido, fechar }: { pedido: Pedido; fechar: () => void }) {
  switch (pedido.tipo) {
    case 'texto':
      return <DialogoTexto {...pedido} fechar={fechar} />
    case 'valor':
      return <DialogoValor {...pedido} fechar={fechar} />
    case 'quantidade':
      return <DialogoQuantidade {...pedido} fechar={fechar} />
    case 'confirmar':
      return <DialogoConfirmar {...pedido} fechar={fechar} />
    case 'escolher':
      return <DialogoEscolher {...pedido} fechar={fechar} />
  }
}

// ---------------------------------------------------------------- texto / PIN
function DialogoTexto({
  pedido,
  resolve,
  fechar,
}: {
  pedido: PedidoTexto
  resolve: (v: string | null) => void
  fechar: () => void
}) {
  const [valor, setValor] = useState(pedido.valorInicial ?? '')
  const [erro, setErro] = useState<string | null>(null)

  function confirmar() {
    const problema = pedido.validar?.(valor) ?? null
    if (problema) {
      setErro(problema) // não fecha: o operador corrige no lugar
      return
    }
    resolve(valor)
    fechar()
  }

  return (
    <Dialogo
      titulo={pedido.titulo}
      descricao={pedido.descricao}
      erro={erro}
      rotuloConfirmar={pedido.rotuloConfirmar}
      onConfirmar={confirmar}
      onCancelar={() => { resolve(null); fechar() }}
    >
      <input
        className="input w-full"
        type={pedido.secreto ? 'password' : 'text'}
        autoComplete="off"
        aria-label={pedido.titulo}
        placeholder={pedido.placeholder}
        value={valor}
        onChange={(e) => { setValor(e.target.value); setErro(null) }}
      />
    </Dialogo>
  )
}

// ---------------------------------------------------------------- valor (R$)
function DialogoValor({
  pedido,
  resolve,
  fechar,
}: {
  pedido: PedidoValor
  resolve: (v: number | null) => void
  fechar: () => void
}) {
  const [texto, setTexto] = useState(pedido.valorInicial ?? '')
  const [erro, setErro] = useState<string | null>(null)

  // Dinheiro é inteiro em centavos (invariante 4) — a conversão acontece aqui,
  // uma vez, em vez de espalhar parseBRL por cada chamador.
  const centavos = parseBRL(texto)
  const vazio = texto.trim() === ''

  function confirmar() {
    if (vazio || !/\d/.test(texto)) {
      setErro('Informe um valor.')
      return
    }
    if (centavos < (pedido.minimo ?? 0)) {
      setErro(`Valor mínimo: ${formatBRL(pedido.minimo ?? 0)}.`)
      return
    }
    resolve(centavos)
    fechar()
  }

  return (
    <Dialogo
      titulo={pedido.titulo}
      descricao={pedido.descricao}
      erro={erro}
      rotuloConfirmar={pedido.rotuloConfirmar}
      onConfirmar={confirmar}
      onCancelar={() => { resolve(null); fechar() }}
    >
      <input
        className="input w-full text-right font-mono text-lg"
        inputMode="decimal"
        aria-label={pedido.titulo}
        placeholder="0,00"
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setErro(null) }}
      />
      <p className="text-right text-xs text-text-muted">
        {vazio ? '—' : formatBRL(centavos)}
      </p>
    </Dialogo>
  )
}

// ------------------------------------------------------------- quantidade/peso
function DialogoQuantidade({
  pedido,
  resolve,
  fechar,
}: {
  pedido: PedidoQuantidade
  resolve: (v: number | null) => void
  fechar: () => void
}) {
  const [texto, setTexto] = useState(pedido.valorInicial ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const casas = pedido.casas ?? 3

  // Vírgula é o separador decimal em pt-BR; o operador digita 1,5.
  const numero = Number(texto.replace(',', '.'))
  const valido = texto.trim() !== '' && Number.isFinite(numero)

  function confirmar() {
    if (!valido) {
      setErro('Informe um número.')
      return
    }
    if (numero < (pedido.minimo ?? 0)) {
      setErro(`Mínimo: ${pedido.minimo}.`)
      return
    }
    resolve(casas === 0 ? Math.round(numero) : Number(numero.toFixed(casas)))
    fechar()
  }

  return (
    <Dialogo
      titulo={pedido.titulo}
      descricao={pedido.descricao}
      erro={erro}
      rotuloConfirmar={pedido.rotuloConfirmar}
      onConfirmar={confirmar}
      onCancelar={() => { resolve(null); fechar() }}
    >
      <input
        className="input w-full text-right font-mono text-lg"
        inputMode="decimal"
        aria-label={pedido.titulo}
        placeholder={casas === 0 ? '1' : '0,000'}
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setErro(null) }}
      />
    </Dialogo>
  )
}

// ---------------------------------------------------------------- confirmação
function DialogoConfirmar({
  pedido,
  resolve,
  fechar,
}: {
  pedido: BasePedido & { destrutivo?: boolean }
  resolve: (v: boolean) => void
  fechar: () => void
}) {
  return (
    <Dialogo
      titulo={pedido.titulo}
      descricao={pedido.descricao}
      destrutivo={pedido.destrutivo}
      rotuloConfirmar={pedido.rotuloConfirmar ?? 'Confirmar'}
      rotuloCancelar="Voltar"
      onConfirmar={() => { resolve(true); fechar() }}
      onCancelar={() => { resolve(false); fechar() }}
    />
  )
}

// ---------------------------------------------------------------- escolha
function DialogoEscolher({
  pedido,
  resolve,
  fechar,
}: {
  pedido: BasePedido & { opcoes: Opcao[] }
  resolve: (v: string | null) => void
  fechar: () => void
}) {
  const [indice, setIndice] = useState(0)

  function aoTeclar(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndice((i) => (i + 1) % pedido.opcoes.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndice((i) => (i - 1 + pedido.opcoes.length) % pedido.opcoes.length)
      return
    }
    // Atalho numérico: 1, 2, 3… escolhe e confirma de uma vez.
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= pedido.opcoes.length) {
      e.preventDefault()
      e.stopPropagation()
      resolve(pedido.opcoes[n - 1].valor)
      fechar()
    }
  }

  return (
    <Dialogo
      titulo={pedido.titulo}
      descricao={pedido.descricao}
      onConfirmar={() => { resolve(pedido.opcoes[indice].valor); fechar() }}
      onCancelar={() => { resolve(null); fechar() }}
    >
      {/* O handler fica DENTRO do diálogo de propósito: o Dialogo chama
          stopPropagation no overlay, então um wrapper por fora nunca receberia
          a tecla — o evento para antes de chegar lá. */}
      <div onKeyDown={aoTeclar}>
        <ul className="space-y-1" role="listbox" aria-label={pedido.titulo}>
          {pedido.opcoes.map((o, i) => (
            <li key={o.valor}>
              <button
                role="option"
                aria-selected={i === indice}
                className={`flex w-full items-baseline gap-2 rounded border px-3 py-2 text-left ${
                  i === indice
                    ? 'border-primary bg-surface-alt text-text'
                    : 'border-border text-text-muted'
                }`}
                onClick={() => { resolve(o.valor); fechar() }}
                onFocus={() => setIndice(i)}
              >
                <span className="font-mono text-xs text-primary">{i + 1}</span>
                <span>{o.rotulo}</span>
                {o.descricao && <span className="text-xs text-text-muted">{o.descricao}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialogo>
  )
}
