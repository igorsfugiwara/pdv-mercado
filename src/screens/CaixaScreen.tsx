import { useEffect, useRef, useState, useCallback } from 'react'
import type { Produto, PagamentoInput, FinalizarVendaInput } from '@shared/types'
import { useCaixaStore } from '../store/caixaStore'
import { useAuthStore } from '../store/authStore'
import { useCarrinhoStore, FORMAS_PAGAMENTO } from '../store/carrinhoStore'
import { formatBRL } from '../lib/money'
import {
  lerEtiquetaBalanca,
  quantidadePorValor,
  quantidadeExibida,
  CONFIG_BALANCA_PADRAO,
  CHAVES_BALANCA,
  type ConfigBalanca,
  type LayoutBalanca,
} from '@shared/eanBalanca'
import {
  exigeAutorizacao,
  descontoParaBps,
  formatarBps,
  LIMITES_PADRAO,
  CHAVES_LIMITE,
  type LimitesDesconto,
} from '@shared/autorizacao'
import { validarCpf } from '../lib/cpf'
import AberturaCaixa from '../components/AberturaCaixa'
import BuscaProdutos from '../components/BuscaProdutos'
import PagamentoPanel from '../components/PagamentoPanel'
import BarraAtalhos from '../components/BarraAtalhos'
import { SeloSimulado, useEstadoFiscal } from '../components/AvisoFiscalSimulado'
import { useDialogos } from '../components/dialogos'
import { dialogoAberto } from '../components/Dialogo'
import Aviso, { useAviso } from '../components/Aviso'

export default function CaixaScreen() {
  const { caixa, carregar } = useCaixaStore()
  const usuario = useAuthStore((s) => s.usuario)!
  const cart = useCarrinhoStore()
  const capturaRef = useRef<HTMLInputElement>(null)
  const estadoFiscal = useEstadoFiscal()
  const dlg = useDialogos()
  const { aviso, mostrar: avisar, limpar: limparAviso } = useAviso()
  const [limites, setLimites] = useState<LimitesDesconto>(LIMITES_PADRAO)
  const [cfgBalanca, setCfgBalanca] = useState<ConfigBalanca>(CONFIG_BALANCA_PADRAO)

  // Limites de desconto por perfil (RF-05). O main reconfere na autorização —
  // isto aqui decide só se a tela pede PIN.
  useEffect(() => {
    void window.api.config.todas().then((c) => {
      const ler = (chave: string, padrao: number) => {
        const n = Number(c[chave])
        return Number.isFinite(n) && n >= 0 ? n : padrao
      }
      setLimites({
        operador: ler(CHAVES_LIMITE.operador, LIMITES_PADRAO.operador),
        supervisor: ler(CHAVES_LIMITE.supervisor, LIMITES_PADRAO.supervisor),
        admin: ler(CHAVES_LIMITE.admin, LIMITES_PADRAO.admin),
      })

      const layout = c[CHAVES_BALANCA.layout]
      setCfgBalanca({
        prefixo: c[CHAVES_BALANCA.prefixo] || CONFIG_BALANCA_PADRAO.prefixo,
        layout: (layout === 'valor' ? 'valor' : 'peso') as LayoutBalanca,
        digitosCodigo: ler(CHAVES_BALANCA.digitosCodigo, CONFIG_BALANCA_PADRAO.digitosCodigo),
      })
    })
  }, [])
  const [captura, setCaptura] = useState('')
  const [busca, setBusca] = useState(false)
  const [pagamento, setPagamento] = useState(false)
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
        avisar('Venda recuperada após reinício do sistema.')
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
      avisar(`Multiplicador: ${mult[1]}×`)
      return
    }

    // Precedência: EAN cadastrado ganha da interpretação como etiqueta. Um
    // EAN-13 legítimo pode começar com 2 — cadastro errado acontece, e assim o
    // comportamento é previsível e nada que já funcionava quebra.
    const produto = await window.api.produtos.obterPorEan(texto)
    if (produto) {
      adicionar(produto)
      return
    }

    if (await tentarEtiquetaBalanca(texto)) return

    const encontrados = await window.api.produtos.buscar(texto)
    if (encontrados.length === 1) adicionar(encontrados[0])
    else avisar(`Nenhum produto para "${texto}". Use F2 para buscar.`, 'erro')
  }

  /**
   * Etiqueta de balança (RF-03): resolve produto E quantidade numa leitura só.
   * Devolve true quando tratou o código — inclusive quando deu erro, porque aí
   * já avisou e não faz sentido cair na busca por texto.
   */
  async function tentarEtiquetaBalanca(texto: string): Promise<boolean> {
    const leitura = lerEtiquetaBalanca(texto, cfgBalanca)

    if (!leitura.ok) {
      if (leitura.motivo === 'nao-e-etiqueta') return false
      if (leitura.motivo === 'dv-invalido') {
        avisar('Código inválido — dígito verificador não confere. Bipe novamente.', 'erro')
        return true
      }
      avisar('Etiqueta com peso/valor zerado.', 'erro')
      return true
    }

    const { dado } = leitura
    const produto = await window.api.produtos.obterPorCodigoInterno(dado.codigoProduto)
    if (!produto) {
      avisar(`Etiqueta de balança: nenhum produto com código interno ${dado.codigoProduto}.`, 'erro')
      return true
    }

    // Etiqueta de balança em item unitário é erro de cadastro; aceitar mascara.
    if (!produto.pesavel) {
      avisar(`${produto.descricao} não é vendido por peso — confira o cadastro.`, 'erro')
      return true
    }

    if (dado.tipo === 'peso') {
      setSelecionado(cart.adicionarProduto(produto, { peso: dado.peso }))
      avisar(`+ ${produto.descricao} (${dado.peso} kg)`, 'sucesso')
      return true
    }

    // Layout valor: a etiqueta é a fonte da verdade do TOTAL. A quantidade é
    // derivada só para exibição — recalcular o total a partir dela faria o
    // cupom divergir em centavos da etiqueta que o cliente tem na mão.
    const quantidade = quantidadePorValor(dado.valor, produto.precoVenda)
    if (quantidade <= 0) {
      avisar(`${produto.descricao} sem preço cadastrado — não dá para derivar o peso.`, 'erro')
      return true
    }
    // Guarda a razão exata: `round(preço × quantidade)` devolve então o valor
    // impresso na etiqueta, ao centavo. O arredondamento fica só na exibição.
    setSelecionado(cart.adicionarProduto(produto, { peso: quantidade }))
    avisar(
      `+ ${produto.descricao} (${quantidadeExibida(quantidade)} kg · ${formatBRL(dado.valor)})`,
      'sucesso',
    )
    return true
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
    avisar(`+ ${p.descricao}`, 'sucesso')
  }

  async function lerPesoEAdicionar(p: Produto) {
    const r = await window.api.hardware.lerPeso()
    let peso = r.ok ? r.peso : undefined
    if (!peso) {
      // Balança ausente ou sem leitura estável: o operador digita o peso.
      const manual = await dlg.pedirQuantidade({
        titulo: 'Peso do produto',
        descricao: `${p.descricao} — informe o peso em quilos.`,
        casas: 3,
        minimo: 0.001,
      })
      peso = manual ?? undefined
    }
    if (peso && peso > 0) {
      setSelecionado(cart.adicionarProduto(p, { peso }))
      avisar(`+ ${p.descricao} (${peso} kg)`, 'sucesso')
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
    avisar(
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
      // `dialogoAberto()` cobre os diálogos próprios: com um aberto, um bip
      // acidental não pode disparar F10/F12 por trás dele.
      if (busca || pagamento || esperaAberta || dialogoAberto()) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelecionado((i) => Math.min(i + 1, Math.max(0, cart.itens.length - 1)))
      }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelecionado((i) => Math.max(0, i - 1)) }
      else if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); trocarOperador() }
      else if (e.key === 'F2') { e.preventDefault(); setBusca(true) }
      else if (e.key === 'F3') { e.preventDefault(); definirMultiplicador() }
      else if (e.key === 'F4') { e.preventDefault(); void pedirDesconto() }
      else if (e.key === 'F6') { e.preventDefault(); void cancelarItemSelecionado() }
      else if (e.key === 'F7') { e.preventDefault(); void colocarEmEspera() }
      else if (e.key === 'F8') { e.preventDefault(); pedirCpf() }
      else if (e.key === 'F9') { e.preventDefault(); void sangriaSuprimento() }
      else if (e.key === 'F10') { e.preventDefault(); if (cart.itens.length) setPagamento(true) }
      else if (e.key === 'F12') { e.preventDefault(); void cancelarVenda() }
    }
    window.addEventListener('keydown', onKey)
    // Nada de dependência nova aqui: `dialogoAberto()` é lido dentro do handler,
    // no momento da tecla — ver a guarda no início de onKey.

    return () => window.removeEventListener('keydown', onKey)
    // `usuario` nas deps: após Ctrl+L (troca de operador) o handler precisa
    // recapturar o operador atual, senão F7/F9 gravam sob o operador anterior.
  }, [cart, caixa, usuario, busca, pagamento, esperaAberta]) // eslint-disable-line react-hooks/exhaustive-deps

  async function pedirCpf() {
    const cpf = await dlg.pedirTexto({
      titulo: 'CPF na nota',
      placeholder: '000.000.000-00',
      // Valida sem fechar: o operador corrige no mesmo lugar.
      validar: (v) => (validarCpf(v) ? null : 'CPF inválido.'),
    })
    if (!cpf) return
    cart.setCpf(cpf.replace(/\D/g, ''))
    avisar('CPF registrado na nota.', 'sucesso')
  }

  // RF-04: multiplicador de quantidade para o próximo item bipado.
  async function definirMultiplicador() {
    const n = await dlg.pedirQuantidade({
      titulo: 'Quantidade',
      descricao: 'Multiplicador do próximo item bipado.',
      valorInicial: String(cart.multiplicador),
      casas: 0,
      minimo: 1,
    })
    if (!n) return
    cart.setMultiplicador(n)
    avisar(`Multiplicador: ${n}×`, 'sucesso')
  }

  /**
   * Obtém autorização para um desconto acima do limite do operador.
   * Devolve o id de quem autorizou, ou null se não houve (ou foi recusada).
   */
  async function autorizarSeNecessario(bps: number): Promise<number | null | 'recusado'> {
    if (!exigeAutorizacao(usuario.perfil, bps, limites)) return null

    const pin = await dlg.pedirPin({
      titulo: 'Autorização de desconto',
      descricao: `${formatarBps(bps)} passa do limite do seu perfil. PIN do supervisor.`,
    })
    if (!pin) return 'recusado'

    const r = await window.api.auth.autorizarDesconto(pin, bps)
    if (!r.ok || !r.usuario) {
      // Recusa por alçada vem com motivo do main — não adianta pedir outro PIN.
      avisar(r.motivo ?? 'PIN sem permissão.', 'erro')
      return 'recusado'
    }
    return r.usuario.id
  }

  // RF-05: F4 sobre a linha selecionada desconta no item; sem seleção, na venda.
  async function pedirDesconto() {
    const temSelecao = cart.itens.length > 0
    if (temSelecao) {
      const idx = Math.min(selecionado, cart.itens.length - 1)
      await descontarItem(idx)
    } else {
      await descontarVenda()
    }
  }

  async function descontarVenda() {
    const base = cart.subtotal()
    if (base <= 0) {
      avisar('Não há valor para descontar.', 'erro')
      return
    }
    const centavos = await dlg.pedirValor({
      titulo: 'Desconto na venda',
      descricao: `Subtotal ${formatBRL(base)}. Valor em reais a abater.`,
    })
    if (centavos === null) return
    if (centavos > base) {
      avisar('O desconto não pode passar do subtotal.', 'erro')
      return
    }

    const bps = descontoParaBps(centavos, base)
    const autorizador = await autorizarSeNecessario(bps)
    if (autorizador === 'recusado') return

    cart.aplicarDescontoVenda(centavos)
    void window.api.auditoria.registrar('desconto_venda', {
      valor: centavos,
      bps,
      subtotal: base,
      autorizadoPorId: autorizador,
    })
    avisar(
      `Desconto de ${formatBRL(centavos)} (${formatarBps(bps)}) aplicado à venda.`,
      'sucesso',
    )
  }

  async function descontarItem(idx: number) {
    const item = cart.itens[idx]
    if (!item) return
    const totalItem = Math.round(item.precoUnitario * item.quantidade)

    const centavos = await dlg.pedirValor({
      titulo: 'Desconto no item',
      descricao: `${item.descricao} — ${formatBRL(totalItem)}.`,
      valorInicial: item.desconto ? String(item.desconto / 100) : '',
    })
    if (centavos === null) return

    // A finalização já rejeita item negativo; a UI impede antes, com motivo.
    if (centavos >= totalItem) {
      avisar('O desconto não pode zerar nem exceder o item.', 'erro')
      return
    }

    const bps = descontoParaBps(centavos, totalItem)
    const autorizador = await autorizarSeNecessario(bps)
    if (autorizador === 'recusado') return

    cart.aplicarDescontoItem(idx, centavos)
    void window.api.auditoria.registrar('desconto_item', {
      produtoId: item.produtoId,
      descricao: item.descricao,
      valor: centavos,
      bps,
      autorizadoPorId: autorizador,
    })
    avisar(
      `Desconto de ${formatBRL(centavos)} (${formatarBps(bps)}) em ${item.descricao}.`,
      'sucesso',
    )
  }

  // F12: cancelar a venda inteira é destrutivo — confirmação com foco no Voltar.
  async function cancelarVenda() {
    // Carrinho vazio não pede nada: não há o que autorizar nem o que auditar.
    if (cart.itens.length === 0) {
      cart.limpar()
      return
    }

    const total = cart.total()
    const ok = await dlg.confirmar({
      titulo: 'Cancelar a venda?',
      descricao: `${cart.itens.length} item(ns), ${formatBRL(total)}. A ação não pode ser desfeita.`,
      rotuloConfirmar: 'Cancelar venda',
      destrutivo: true,
    })
    if (!ok) return

    const pin = await dlg.pedirPin({
      titulo: 'Autorização do supervisor',
      descricao: `Cancelamento de venda com ${formatBRL(total)} lançados.`,
    })
    if (!pin) return

    const auth = await window.api.auth.autorizarSupervisor(pin)
    if (!auth.ok || !auth.usuario) {
      avisar('PIN sem permissão para cancelar a venda.', 'erro')
      return
    }

    const itens = cart.itens.map((i) => ({
      produtoId: i.produtoId,
      descricao: i.descricao,
      quantidade: i.quantidade,
    }))
    cart.limpar()
    void window.api.auditoria.registrar('venda_cancelar_carrinho', {
      itens,
      total,
      autorizadoPorId: auth.usuario.id,
    })
    avisar('Venda cancelada.', 'info')
  }

  // RF-06: cancela o item selecionado. Antes só dava para remover o último —
  // se o cliente desistisse do terceiro de dez itens, não havia caminho.
  // RF-06/RF-21: cancela o item SELECIONADO (não o último), exige PIN e audita.
  async function cancelarItemSelecionado() {
    if (cart.itens.length === 0) return
    const idx = Math.min(selecionado, cart.itens.length - 1)
    const it = cart.itens[idx]
    const total = Math.round(it.precoUnitario * it.quantidade) - it.desconto

    const pin = await dlg.pedirPin({
      titulo: 'Cancelar item',
      descricao: `${it.descricao} — ${formatBRL(total)}. PIN do supervisor.`,
    })
    if (!pin) return

    const auth = await window.api.auth.autorizarSupervisor(pin)
    if (!auth.ok || !auth.usuario) {
      avisar('PIN sem permissão para cancelar item.', 'erro')
      return
    }

    cart.removerItem(idx)
    setSelecionado((i) => Math.max(0, Math.min(i, cart.itens.length - 2)))

    // A venda ainda não existe no banco: o que se audita é o ato do operador —
    // quem tirou o quê do carrinho, e com autorização de quem.
    void window.api.auditoria.registrar('venda_item_cancelar', {
      produtoId: it.produtoId,
      descricao: it.descricao,
      quantidade: it.quantidade,
      total,
      autorizadoPorId: auth.usuario.id,
    })
    avisar(`Item cancelado: ${it.descricao}`, 'sucesso')
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
    avisar('Venda colocada em espera (F7).')
  }

  // RF-26: retoma uma venda em espera; se houver venda atual, ela é parqueada antes.
  async function retomarEspera(item: { id: string; input: FinalizarVendaInput }) {
    if (cart.itens.length > 0) await colocarEmEspera()
    cart.hidratar(item.input)
    await window.api.vendas.removerEspera(item.id)
    await carregarEspera()
    setEsperaAberta(false)
    avisar('Venda retomada da espera.')
  }

  const totalEmEspera = (input: FinalizarVendaInput) =>
    input.itens.reduce((a, i) => a + Math.round(i.precoUnitario * i.quantidade) - i.desconto, 0) -
    input.descontoVenda

  // RF-12: sangria/suprimento exige autorização de supervisor.
  async function sangriaSuprimento() {
    if (!caixa) return
    const tipo = (await dlg.escolher({
      titulo: 'Movimentação de caixa',
      opcoes: [
        { valor: 'sangria', rotulo: 'Sangria', descricao: 'retirada de numerário' },
        { valor: 'suprimento', rotulo: 'Suprimento', descricao: 'entrada de numerário' },
      ],
    })) as 'sangria' | 'suprimento' | null
    if (!tipo) return

    const rotulo = tipo === 'sangria' ? 'Sangria' : 'Suprimento'
    const valor = await dlg.pedirValor({ titulo: `${rotulo} — valor`, minimo: 1 })
    if (valor === null) return

    const motivo = (await dlg.pedirTexto({ titulo: 'Motivo', descricao: rotulo })) ?? ''

    const pin = await dlg.pedirPin({
      titulo: 'Autorização do supervisor',
      descricao: `${rotulo} de ${formatBRL(valor)}.`,
    })
    if (!pin) return
    const auth = await window.api.auth.autorizarSupervisor(pin)
    if (!auth.ok || !auth.usuario) { avisar('Autorização de supervisor negada.', 'erro'); return }
    await window.api.caixa.movimentar(caixa.id, tipo, valor, motivo, usuario.id, auth.usuario.id)
    // Abre a gaveta para a movimentação física do numerário (best-effort).
    void window.api.hardware.abrirGaveta()
    avisar(`${rotulo} de ${formatBRL(valor)} registrado.`, 'sucesso')
  }

  // Ctrl+L (RF-20): troca rápida de operador por PIN, sem sair do caixa.
  async function trocarOperador() {
    const pin = await dlg.pedirPin({ titulo: 'Trocar operador', descricao: 'PIN do operador.' })
    if (!pin) return
    const ok = await useAuthStore.getState().trocarOperador(pin)
    if (ok) avisar('Operador trocado.', 'sucesso')
    else avisar('PIN inválido.', 'erro')
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
            <button className="btn-ghost w-full" onClick={() => void descontarVenda()}>
              Desconto na venda
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
        <Aviso aviso={aviso} onDispensar={limparAviso} />
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
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
          <SeloSimulado estado={estadoFiscal} />
        </div>
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

      {/* Diálogos do caixa. Renderizam em portal, então a posição aqui não
          importa para o layout — importa para o ciclo de vida. */}
      {dlg.elemento}
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
