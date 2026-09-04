import { useEffect, useRef, useState, useCallback } from 'react'
import type { Produto, PagamentoInput, FinalizarVendaInput } from '@shared/types'
import { useCaixaStore } from '../store/caixaStore'
import { useAuthStore } from '../store/authStore'
import { useCarrinhoStore, FORMAS_PAGAMENTO } from '../store/carrinhoStore'
import { formatBRL, parseBRL } from '../lib/money'
import { validarCpf } from '../lib/cpf'
import AberturaCaixa from '../components/AberturaCaixa'
import BuscaProdutos from '../components/BuscaProdutos'
import PagamentoPanel from '../components/PagamentoPanel'
import BarraAtalhos from '../components/BarraAtalhos'

export default function CaixaScreen() {
  const { caixa, carregar } = useCaixaStore()
  const usuario = useAuthStore((s) => s.usuario)!
  const cart = useCarrinhoStore()
  const capturaRef = useRef<HTMLInputElement>(null)
  const [captura, setCaptura] = useState('')
  const [busca, setBusca] = useState(false)
  const [pagamento, setPagamento] = useState(false)
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [esperaAberta, setEsperaAberta] = useState(false)
  // Linha corrente da lista: é o que F6 cancela e o que o desconto por item usará.
  const [selecionado, setSelecionado] = useState(0)
  const [emEspera, setEmEspera] = useState<Array<{ id: string; input: FinalizarVendaInput }>>([])
  const recuperado = useRef(false)

  useEffect(() => {
    void carregar()
  }, [carregar])

  const carregarEspera = useCallback(async () => {
    setEmEspera(await window.api.vendas.recuperarEspera())
  }, [])

  // Invariante 4: recupera o rascunho persistido após uma queda; carrega a fila de espera.
  useEffect(() => {
    if (recuperado.current) return
    recuperado.current = true
    void (async () => {
      const rascunho = await window.api.vendas.recuperarRascunho()
      if (rascunho && rascunho.itens.length > 0 && useCarrinhoStore.getState().itens.length === 0) {
        cart.hidratar(rascunho)
        setMensagem('Venda recuperada após reinício do sistema.')
      }
      await carregarEspera()
    })()
  }, [cart, carregarEspera])

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
    // O índice vem do store: com empilhamento, a linha afetada pode ser uma já
    // existente, e `cart.itens.length` leria o estado anterior ao set.
    setSelecionado(cart.adicionarProduto(p))
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
      setSelecionado(cart.adicionarProduto(p, { peso }))
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
      // Overlay aberto captura o teclado. Sem esta guarda, um F10 por baixo da
      // busca abre o pagamento escondido, e as setas mexem na lista de itens em
      // vez de navegar o resultado da busca.
      if (busca || pagamento || esperaAberta) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelecionado((i) => Math.min(i + 1, Math.max(0, cart.itens.length - 1)))
      }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelecionado((i) => Math.max(0, i - 1)) }
      else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); trocarOperador() }
      else if (e.key === 'F2') { e.preventDefault(); setBusca(true) }
      else if (e.key === 'F3') { e.preventDefault(); definirMultiplicador() }
      else if (e.key === 'F4') { e.preventDefault(); pedirDescontoVenda() }
      else if (e.key === 'F6') { e.preventDefault(); cancelarItemSelecionado() }
      else if (e.key === 'F7') { e.preventDefault(); void colocarEmEspera() }
      else if (e.key === 'F8') { e.preventDefault(); pedirCpf() }
      else if (e.key === 'F9') { e.preventDefault(); void sangriaSuprimento() }
      else if (e.key === 'F10') { e.preventDefault(); if (cart.itens.length) setPagamento(true) }
      else if (e.key === 'F12') { e.preventDefault(); if (confirm('Cancelar venda?')) cart.limpar() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // `usuario` nas deps: após Ctrl+L (troca de operador) o handler precisa
    // recapturar o operador atual, senão F7/F9 gravam sob o operador anterior.
  }, [cart, caixa, usuario, busca, pagamento, esperaAberta]) // eslint-disable-line react-hooks/exhaustive-deps

  function pedirCpf() {
    const cpf = prompt('CPF na nota:')
    if (!cpf) return
    if (validarCpf(cpf)) cart.setCpf(cpf.replace(/\D/g, ''))
    else setMensagem('CPF inválido.')
  }

  // RF-04: multiplicador de quantidade para o próximo item bipado.
  function definirMultiplicador() {
    const v = prompt('Quantidade (multiplicador do próximo item):', String(cart.multiplicador))
    if (!v) return
    const n = parseInt(v.replace(/\D/g, ''), 10)
    if (n > 0) { cart.setMultiplicador(n); setMensagem(`Multiplicador: ${n}×`) }
  }

  function pedirDescontoVenda() {
    const v = prompt('Desconto na venda (R$):')
    if (v) cart.aplicarDescontoVenda(parseBRL(v))
  }

  // RF-06: cancela o item selecionado. Antes só dava para remover o último —
  // se o cliente desistisse do terceiro de dez itens, não havia caminho.
  function cancelarItemSelecionado() {
    if (cart.itens.length === 0) return
    const idx = Math.min(selecionado, cart.itens.length - 1)
    const it = cart.itens[idx]
    cart.removerItem(idx)
    setSelecionado((i) => Math.max(0, Math.min(i, cart.itens.length - 2)))
    setMensagem(`Item cancelado: ${it.descricao}`)
  }

  // RF-26/27: coloca a venda em espera para atender outra e retomar depois.
  async function colocarEmEspera() {
    if (!caixa || cart.itens.length === 0) return
    await window.api.vendas.salvarEspera({
      caixaId: caixa.id,
      usuarioId: usuario.id,
      clienteCpf: cart.clienteCpf,
      itens: cart.itens,
      descontoVenda: cart.descontoVenda,
      pagamentos: [],
      emitirNfce: true,
    })
    cart.limpar()
    await carregarEspera()
    setMensagem('Venda colocada em espera (F7).')
  }

  // RF-26: retoma uma venda em espera; se houver venda atual, ela é parqueada antes.
  async function retomarEspera(item: { id: string; input: FinalizarVendaInput }) {
    if (cart.itens.length > 0) await colocarEmEspera()
    cart.hidratar(item.input)
    await window.api.vendas.removerEspera(item.id)
    await carregarEspera()
    setEsperaAberta(false)
    setMensagem('Venda retomada da espera.')
  }

  const totalEmEspera = (input: FinalizarVendaInput) =>
    input.itens.reduce((a, i) => a + Math.round(i.precoUnitario * i.quantidade) - i.desconto, 0) -
    input.descontoVenda

  // RF-12: sangria/suprimento exige autorização de supervisor.
  async function sangriaSuprimento() {
    if (!caixa) return
    const escolha = prompt('Movimentação de caixa — 1 = Sangria (retirada) · 2 = Suprimento (entrada):')
    if (!escolha) return
    const tipo = escolha.trim() === '2' ? 'suprimento' : escolha.trim() === '1' ? 'sangria' : null
    if (!tipo) { setMensagem('Movimentação cancelada.'); return }
    const valorRaw = prompt(`${tipo === 'sangria' ? 'Sangria' : 'Suprimento'} — valor (R$):`)
    if (!valorRaw) return
    const valor = parseBRL(valorRaw)
    if (valor <= 0) { setMensagem('Valor inválido.'); return }
    const motivo = prompt('Motivo:') ?? ''
    const pin = prompt('PIN do supervisor para autorizar:')
    if (!pin) return
    const auth = await window.api.auth.autorizarSupervisor(pin)
    if (!auth.ok || !auth.usuario) { setMensagem('Autorização de supervisor negada.'); return }
    await window.api.caixa.movimentar(caixa.id, tipo, valor, motivo, usuario.id, auth.usuario.id)
    // Abre a gaveta para a movimentação física do numerário (best-effort).
    void window.api.hardware.abrirGaveta()
    setMensagem(`${tipo === 'sangria' ? 'Sangria' : 'Suprimento'} de ${formatBRL(valor)} registrado.`)
  }

  // Ctrl+L (RF-20): troca rápida de operador por PIN, sem sair do caixa.
  async function trocarOperador() {
    const pin = prompt('PIN do operador:')
    if (!pin) return
    const ok = await useAuthStore.getState().trocarOperador(pin)
    setMensagem(ok ? 'Operador trocado.' : 'PIN inválido.')
  }

  if (!caixa) return <AberturaCaixa />

  return (
    <div className="flex h-full flex-col p-4">
      <header className="mb-3 flex items-center gap-3">
        <input
          ref={capturaRef}
          className="input flex-1 font-mono text-lg"
          placeholder="Bipe o código de barras ou digite o código…"
          aria-label="Captura de código de barras"
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
            {cart.itens.map((it, i) => {
              const corrente = i === Math.min(selecionado, cart.itens.length - 1)
              return (
                <li
                  key={i}
                  onClick={() => setSelecionado(i)}
                  aria-current={corrente ? 'true' : undefined}
                  className={`grid cursor-default grid-cols-12 items-center border-l-2 py-1.5 pr-1 text-sm ${
                    corrente
                      ? 'border-l-primary bg-primary/10 font-medium text-text'
                      : 'border-l-transparent border-b border-b-border text-text'
                  }`}
                >
                  <span className="col-span-6 truncate pl-2">{it.descricao}</span>
                  <span className="col-span-2 text-right font-mono">
                    {it.peso ? `${it.peso} kg` : it.quantidade}
                  </span>
                  <span className="col-span-2 text-right font-mono text-text-muted">
                    {formatBRL(it.precoUnitario)}
                  </span>
                  <span className="col-span-2 text-right font-mono">
                    {formatBRL(Math.round(it.precoUnitario * it.quantidade) - it.desconto)}
                  </span>
                </li>
              )
            })}
            {cart.itens.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-text-muted">
                Bipe o código de barras do produto para começar.
                <br />
                <span className="text-xs">
                  Sem leitor? Digite o código e pressione Enter, ou use <kbd className="kbd">F2</kbd>{' '}
                  para buscar pelo nome.
                </span>
              </li>
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
            <button className="btn-ghost w-full" onClick={pedirDescontoVenda}>
              Desconto na venda (F4)
            </button>
            {emEspera.length > 0 && (
              <button className="btn-ghost w-full" onClick={() => setEsperaAberta(true)}>
                Em espera ({emEspera.length})
              </button>
            )}
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

      <div className="mt-3 space-y-2">
        {mensagem && (
          <div className="rounded-md border-l-2 border-l-primary bg-surface-alt px-3 py-2 text-sm text-text">
            {mensagem}
          </div>
        )}
        <BarraAtalhos
          atalhos={[
            { tecla: 'F2', rotulo: 'Buscar' },
            { tecla: 'F3', rotulo: 'Quantidade' },
            { tecla: 'F4', rotulo: 'Desconto' },
            { tecla: '↑↓', rotulo: 'Selecionar item', ativo: cart.itens.length > 1 },
            { tecla: 'F6', rotulo: 'Cancelar item', ativo: cart.itens.length > 0 },
            { tecla: 'F7', rotulo: 'Espera', ativo: cart.itens.length > 0 },
            { tecla: 'F8', rotulo: 'CPF na nota' },
            { tecla: 'F9', rotulo: 'Sangria/suprimento' },
            { tecla: 'F10', rotulo: 'Pagamento', ativo: cart.itens.length > 0 },
            { tecla: 'F12', rotulo: 'Cancelar venda', ativo: cart.itens.length > 0 },
            { tecla: 'Ctrl+L', rotulo: 'Trocar operador' },
          ]}
        />
      </div>

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
      {esperaAberta && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/60"
          onClick={() => setEsperaAberta(false)}
        >
          <div className="card w-[520px] space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-2xl text-primary">Vendas em espera</h2>
            {emEspera.length === 0 && (
              <p className="py-6 text-center text-text-muted">Nenhuma venda em espera.</p>
            )}
            <ul className="max-h-80 space-y-2 overflow-auto">
              {emEspera.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded-md bg-surface-alt p-3"
                >
                  <span className="text-sm">
                    {item.input.itens.length} {item.input.itens.length === 1 ? 'item' : 'itens'}
                    <span className="ml-2 font-mono text-text-muted">
                      {formatBRL(totalEmEspera(item.input))}
                    </span>
                  </span>
                  <button className="btn-primary px-4 py-1" onClick={() => void retomarEspera(item)}>
                    Retomar
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn-ghost w-full" onClick={() => setEsperaAberta(false)}>
              Fechar
            </button>
          </div>
        </div>
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
