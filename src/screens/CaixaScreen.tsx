import { useEffect, useRef, useState, useCallback } from 'react'
import type { Produto, PagamentoInput } from '@shared/types'
import { useCaixaStore } from '../store/caixaStore'
import { useAuthStore } from '../store/authStore'
import { useCarrinhoStore, FORMAS_PAGAMENTO } from '../store/carrinhoStore'
import { formatBRL, parseBRL } from '../lib/money'
import { validarCpf } from '../lib/cpf'
import AberturaCaixa from '../components/AberturaCaixa'
import BuscaProdutos from '../components/BuscaProdutos'
import PagamentoPanel from '../components/PagamentoPanel'

export default function CaixaScreen() {
  const { caixa, carregar } = useCaixaStore()
  const usuario = useAuthStore((s) => s.usuario)!
  const cart = useCarrinhoStore()
  const capturaRef = useRef<HTMLInputElement>(null)
  const [captura, setCaptura] = useState('')
  const [busca, setBusca] = useState(false)
  const [pagamento, setPagamento] = useState(false)
  const [mensagem, setMensagem] = useState<string | null>(null)

  useEffect(() => {
    void carregar()
  }, [carregar])

  const focarCaptura = useCallback(() => {
    if (!busca && !pagamento) capturaRef.current?.focus()
  }, [busca, pagamento])

  useEffect(() => {
    focarCaptura()
  }, [focarCaptura, cart.itens.length])

  // RF-01: processa o "bip" (EAN + Enter) e multiplicador (RF-04: "3 *").
  async function processarCaptura() {
    const texto = captura.trim()
    setCaptura('')
    if (!texto) return

    const mult = texto.match(/^(\d+)\s*\*$/)
    if (mult) {
      cart.setMultiplicador(parseInt(mult[1], 10))
      setMensagem(`Multiplicador: ${mult[1]}×`)
      return
    }

    const produto = await window.api.produtos.obterPorEan(texto)
    if (produto) {
      adicionar(produto)
    } else {
      const encontrados = await window.api.produtos.buscar(texto)
      if (encontrados.length === 1) adicionar(encontrados[0])
      else setMensagem(`Nenhum produto para "${texto}". Use F2 para buscar.`)
    }
  }

  function adicionar(p: Produto) {
    if (p.pesavel) {
      // RF-03/05: pesável exige peso da balança ou entrada manual.
      void lerPesoEAdicionar(p)
      return
    }
    cart.adicionarProduto(p)
    setMensagem(`+ ${p.descricao}`)
  }

  async function lerPesoEAdicionar(p: Produto) {
    const r = await window.api.hardware.lerPeso()
    let peso = r.ok ? r.peso : undefined
    if (!peso) {
      const manual = prompt(`Peso (kg) para ${p.descricao}:`)
      peso = manual ? parseFloat(manual.replace(',', '.')) : undefined
    }
    if (peso && peso > 0) {
      cart.adicionarProduto(p, { peso })
      setMensagem(`+ ${p.descricao} (${peso} kg)`)
    }
  }

  async function finalizar(pagamentos: PagamentoInput[], emitirNfce: boolean) {
    if (!caixa) return
    const r = await window.api.vendas.finalizar({
      caixaId: caixa.id,
      usuarioId: usuario.id,
      clienteCpf: cart.clienteCpf,
      itens: cart.itens,
      descontoVenda: cart.descontoVenda,
      pagamentos,
      emitirNfce,
    })
    cart.limpar()
    setPagamento(false)
    const doc = r.documentoFiscal
    setMensagem(
      `Venda #${r.venda.id} finalizada. Troco ${formatBRL(r.troco)}.` +
        (doc ? ` NFC-e: ${doc.status}.` : ''),
    )
  }

  // RF-10: operação 100% por teclado.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F2') { e.preventDefault(); setBusca(true) }
      else if (e.key === 'F8') { e.preventDefault(); pedirCpf() }
      else if (e.key === 'F10') { e.preventDefault(); if (cart.itens.length) setPagamento(true) }
      else if (e.key === 'F12') { e.preventDefault(); if (confirm('Cancelar venda?')) cart.limpar() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cart])

  function pedirCpf() {
    const cpf = prompt('CPF na nota:')
    if (!cpf) return
    if (validarCpf(cpf)) cart.setCpf(cpf.replace(/\D/g, ''))
    else setMensagem('CPF inválido.')
  }

  if (!caixa) return <AberturaCaixa />

  return (
    <div className="flex h-full flex-col p-4">
      <header className="mb-3 flex items-center gap-3">
        <input
          ref={capturaRef}
          className="input flex-1 font-mono text-lg"
          placeholder="Bipe o código de barras ou digite…  (F2 buscar · F10 pagar)"
          value={captura}
          onChange={(e) => setCaptura(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && processarCaptura()}
          onBlur={focarCaptura}
        />
        {cart.multiplicador > 1 && (
          <span className="rounded bg-primary px-3 py-2 font-mono text-text-inverse">
            {cart.multiplicador}×
          </span>
        )}
      </header>

      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Itens */}
        <div className="card flex flex-1 flex-col overflow-hidden">
          <div className="mb-2 grid grid-cols-12 border-b border-border pb-2 text-xs uppercase text-text-muted">
            <span className="col-span-6">Item</span>
            <span className="col-span-2 text-right">Qtd</span>
            <span className="col-span-2 text-right">Unit.</span>
            <span className="col-span-2 text-right">Total</span>
          </div>
          <ul className="flex-1 overflow-auto">
            {cart.itens.map((it, i) => (
              <li key={i} className="grid grid-cols-12 items-center border-b border-border/50 py-2 text-sm">
                <span className="col-span-6 truncate">{it.descricao}</span>
                <span className="col-span-2 text-right font-mono">
                  {it.peso ? `${it.peso} kg` : it.quantidade}
                </span>
                <span className="col-span-2 text-right font-mono">{formatBRL(it.precoUnitario)}</span>
                <span className="col-span-2 text-right font-mono">
                  {formatBRL(Math.round(it.precoUnitario * it.quantidade) - it.desconto)}
                </span>
                <button
                  className="col-span-12 text-right text-xs text-danger"
                  onClick={() => cart.removerItem(i)}
                >
                  remover (F6)
                </button>
              </li>
            ))}
            {cart.itens.length === 0 && (
              <li className="py-8 text-center text-text-muted">Nenhum item. Bipe um produto.</li>
            )}
          </ul>
        </div>

        {/* Totais */}
        <div className="card flex w-80 flex-col">
          <div className="flex-1 space-y-2">
            <Linha label="Subtotal" valor={cart.subtotal()} />
            <Linha label="Desconto" valor={-cart.descontoVenda} />
            {cart.clienteCpf && (
              <p className="text-xs text-text-muted">CPF: {cart.clienteCpf}</p>
            )}
            <div className="border-t border-border pt-3">
              <p className="text-sm text-text-muted">TOTAL</p>
              <p className="font-mono text-4xl text-primary">{formatBRL(cart.total())}</p>
            </div>
          </div>
          <div className="space-y-2">
            <button
              className="btn-ghost w-full"
              onClick={() => {
                const v = prompt('Desconto na venda (R$):')
                if (v) cart.aplicarDescontoVenda(parseBRL(v))
              }}
            >
              Desconto na venda (F4)
            </button>
            <button
              className="btn-primary w-full py-4 text-lg"
              disabled={cart.itens.length === 0}
              onClick={() => setPagamento(true)}
            >
              Pagamento (F10)
            </button>
          </div>
        </div>
      </div>

      {mensagem && (
        <div className="mt-2 rounded-md bg-surface-alt px-3 py-2 text-sm text-text-muted">
          {mensagem}
        </div>
      )}

      {busca && (
        <BuscaProdutos
          onSelecionar={(p) => { adicionar(p); setBusca(false) }}
          onFechar={() => setBusca(false)}
        />
      )}
      {pagamento && (
        <PagamentoPanel
          total={cart.total()}
          formas={FORMAS_PAGAMENTO}
          onConfirmar={finalizar}
          onFechar={() => setPagamento(false)}
        />
      )}
    </div>
  )
}

function Linha({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono">{formatBRL(valor)}</span>
    </div>
  )
}
