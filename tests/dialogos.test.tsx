// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, act, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import Dialogo, { dialogoAberto } from '../src/components/Dialogo'
import { useDialogos } from '../src/components/dialogos'
import Aviso, { useAviso } from '../src/components/Aviso'
import BuscaProdutos, { ATRASO_BUSCA_MS } from '../src/components/BuscaProdutos'

/**
 * Fatia 02 — os diálogos existem para resolver um problema de operação:
 * o leitor de código de barras é um teclado, e o diálogo nativo aceitava bip.
 * Por isso os testes aqui são quase todos sobre teclado e foco.
 */
afterEach(cleanup)

// ------------------------------------------------------------ 2.1 primitiva
describe('Dialogo', () => {
  function Palco({ onFechar = () => {} }: { onFechar?: () => void }) {
    const [aberto, setAberto] = useState(false)
    return (
      <div>
        {/* No caixa o diálogo abre por atalho com o foco no campo de captura —
            abrir por clique moveria o foco para o botão e testaria outra coisa. */}
        <input
          data-testid="captura"
          aria-label="captura"
          onKeyDown={(e) => { if (e.key === 'F4') setAberto(true) }}
        />
        <button onClick={() => setAberto(true)}>abrir</button>
        {aberto && (
          <Dialogo
            titulo="Teste"
            onConfirmar={() => { setAberto(false); onFechar() }}
            onCancelar={() => { setAberto(false); onFechar() }}
          >
            <input aria-label="campo" />
          </Dialogo>
        )}
      </div>
    )
  }

  it('prende o foco dentro e devolve ao fechar', async () => {
    const u = userEvent.setup()
    render(<Palco />)

    const captura = screen.getByTestId('captura')
    captura.focus()
    expect(document.activeElement).toBe(captura)

    await u.keyboard('{F4}')
    // O foco foi para dentro do diálogo…
    await waitFor(() => expect(screen.getByLabelText('campo')).toHaveFocus())

    await u.keyboard('{Escape}')
    // …e voltou para o campo de captura, que é o que mantém o ritmo do caixa.
    await waitFor(() => expect(document.activeElement).toBe(captura))
  })

  it('Tab circula apenas dentro do diálogo', async () => {
    const u = userEvent.setup()
    render(<Palco />)
    screen.getByTestId('captura').focus()
    await u.keyboard('{F4}')

    const dentro = () => screen.getByRole('dialog').contains(document.activeElement)
    for (let i = 0; i < 6; i++) {
      await u.tab()
      expect(dentro()).toBe(true)
    }
  })

  it('Esc cancela e Enter confirma', async () => {
    const u = userEvent.setup()
    const onConfirmar = vi.fn()
    const onCancelar = vi.fn()

    const { unmount } = render(
      <Dialogo titulo="T" onConfirmar={onConfirmar} onCancelar={onCancelar}>
        <input aria-label="campo" />
      </Dialogo>,
    )
    await u.keyboard('{Escape}')
    expect(onCancelar).toHaveBeenCalledOnce()

    await u.keyboard('{Enter}')
    expect(onConfirmar).toHaveBeenCalledOnce()
    unmount()
  })

  it('sinaliza que há diálogo aberto, para suspender os atalhos globais', async () => {
    expect(dialogoAberto()).toBe(false)
    const { unmount } = render(
      <Dialogo titulo="T" onConfirmar={() => {}} onCancelar={() => {}} />,
    )
    await waitFor(() => expect(dialogoAberto()).toBe(true))
    unmount()
    await waitFor(() => expect(dialogoAberto()).toBe(false))
  })

  it('ação destrutiva começa com o foco no cancelar', async () => {
    render(
      <Dialogo titulo="Apagar?" destrutivo onConfirmar={() => {}} onCancelar={() => {}} />,
    )
    await waitFor(() =>
      expect(document.querySelector('[data-acao="cancelar"]')).toHaveFocus(),
    )
  })
})

// ------------------------------------------------------------- 2.2 variantes
describe('variantes', () => {
  function Palco({ aoResolver }: { aoResolver: (v: unknown) => void }) {
    const dlg = useDialogos()
    return (
      <div>
        <button onClick={() => void dlg.pedirValor({ titulo: 'Valor' }).then(aoResolver)}>valor</button>
        <button onClick={() => void dlg.pedirQuantidade({ titulo: 'Peso', casas: 3 }).then(aoResolver)}>peso</button>
        <button onClick={() => void dlg.pedirQuantidade({ titulo: 'Qtd', casas: 0 }).then(aoResolver)}>qtd</button>
        <button onClick={() => void dlg.pedirPin({ titulo: 'PIN' }).then(aoResolver)}>pin</button>
        <button
          onClick={() =>
            void dlg
              .pedirTexto({ titulo: 'CPF', validar: (v) => (v === 'ok' ? null : 'inválido') })
              .then(aoResolver)
          }
        >
          texto
        </button>
        <button
          onClick={() =>
            void dlg
              .escolher({
                titulo: 'Tipo',
                opcoes: [
                  { valor: 'sangria', rotulo: 'Sangria' },
                  { valor: 'suprimento', rotulo: 'Suprimento' },
                ],
              })
              .then(aoResolver)
          }
        >
          escolher
        </button>
        {dlg.elemento}
      </div>
    )
  }

  it('pedirValor converte 12,90 em 1290 centavos', async () => {
    const u = userEvent.setup()
    const resolveu = vi.fn()
    render(<Palco aoResolver={resolveu} />)

    await u.click(screen.getByText('valor'))
    await u.type(within(screen.getByRole('dialog')).getByRole('textbox'), '12,90')
    await u.keyboard('{Enter}')

    await waitFor(() => expect(resolveu).toHaveBeenCalledWith(1290))
  })

  it('pedirValor recusa entrada não numérica sem fechar', async () => {
    const u = userEvent.setup()
    const resolveu = vi.fn()
    render(<Palco aoResolver={resolveu} />)

    await u.click(screen.getByText('valor'))
    await u.type(within(screen.getByRole('dialog')).getByRole('textbox'), 'abc')
    await u.keyboard('{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(/informe um valor/i)
    expect(screen.getByRole('dialog')).toBeInTheDocument() // continua aberto
    expect(resolveu).not.toHaveBeenCalled()
  })

  it('pedirQuantidade aceita 1,5 como 1.5', async () => {
    const u = userEvent.setup()
    const resolveu = vi.fn()
    render(<Palco aoResolver={resolveu} />)

    await u.click(screen.getByText('peso'))
    await u.type(within(screen.getByRole('dialog')).getByRole('textbox'), '1,5')
    await u.keyboard('{Enter}')

    await waitFor(() => expect(resolveu).toHaveBeenCalledWith(1.5))
  })

  it('multiplicador (0 casas) arredonda para inteiro', async () => {
    const u = userEvent.setup()
    const resolveu = vi.fn()
    render(<Palco aoResolver={resolveu} />)

    await u.click(screen.getByText('qtd'))
    await u.type(within(screen.getByRole('dialog')).getByRole('textbox'), '3')
    await u.keyboard('{Enter}')

    await waitFor(() => expect(resolveu).toHaveBeenCalledWith(3))
  })

  it('pedirPin não ecoa o que é digitado', async () => {
    const u = userEvent.setup()
    render(<Palco aoResolver={() => {}} />)

    await u.click(screen.getByText('pin'))
    // Campo de senha não tem papel ARIA — busca pelo tipo, dentro do diálogo.
    const campo = screen.getByRole('dialog').querySelector('input[type="password"]') as HTMLInputElement
    expect(campo.type).toBe('password')

    await u.type(campo, '1234')
    expect(campo.value).toBe('1234')      // o valor existe…
    expect(campo.type).toBe('password')   // …mas a tela não mostra
  })

  it('validação exibe erro inline e só fecha quando corrigido', async () => {
    const u = userEvent.setup()
    const resolveu = vi.fn()
    render(<Palco aoResolver={resolveu} />)

    await u.click(screen.getByText('texto'))
    await u.type(within(screen.getByRole('dialog')).getByRole('textbox'), 'xx')
    await u.keyboard('{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('inválido')
    expect(resolveu).not.toHaveBeenCalled()

    await u.clear(within(screen.getByRole('dialog')).getByRole('textbox'))
    await u.type(within(screen.getByRole('dialog')).getByRole('textbox'), 'ok')
    await u.keyboard('{Enter}')
    await waitFor(() => expect(resolveu).toHaveBeenCalledWith('ok'))
  })

  it('escolher aceita atalho numérico', async () => {
    const u = userEvent.setup()
    const resolveu = vi.fn()
    render(<Palco aoResolver={resolveu} />)

    await u.click(screen.getByText('escolher'))
    await u.keyboard('2')

    await waitFor(() => expect(resolveu).toHaveBeenCalledWith('suprimento'))
  })

  it('Esc resolve com null', async () => {
    const u = userEvent.setup()
    const resolveu = vi.fn()
    render(<Palco aoResolver={resolveu} />)

    await u.click(screen.getByText('valor'))
    await u.keyboard('{Escape}')

    await waitFor(() => expect(resolveu).toHaveBeenCalledWith(null))
  })
})

// ---------------------------------------------------------------- 2.3 avisos
describe('Aviso', () => {
  function Palco() {
    const { aviso, mostrar, limpar } = useAviso()
    return (
      <div>
        <button onClick={() => mostrar('deu certo', 'sucesso')}>sucesso</button>
        <button onClick={() => mostrar('PIN inválido', 'erro')}>erro</button>
        <Aviso aviso={aviso} onDispensar={limpar} />
      </div>
    )
  }

  it('aviso de sucesso some sozinho', async () => {
    vi.useFakeTimers()
    try {
      render(<Palco />)
      // fireEvent em vez de userEvent: aquele espera timers internamente, e com
      // temporizador falso a espera nunca termina.
      fireEvent.click(screen.getByText('sucesso'))
      expect(screen.getByText('deu certo')).toBeInTheDocument()

      await act(async () => { vi.advanceTimersByTime(4500) })
      expect(screen.queryByText('deu certo')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('aviso de erro fica até dispensar', async () => {
    vi.useFakeTimers()
    try {
      render(<Palco />)
      fireEvent.click(screen.getByText('erro'))

      await act(async () => { vi.advanceTimersByTime(10_000) })
      expect(screen.getByText('PIN inválido')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Dispensar'))
      expect(screen.queryByText('PIN inválido')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ------------------------------------------------------------- 2.5 debounce
describe('BuscaProdutos', () => {
  it('dispara uma consulta só para várias teclas seguidas', async () => {
    const buscar = vi.fn().mockResolvedValue([])
    // @ts-expect-error — window.api é injetado pelo preload em runtime
    window.api = { produtos: { buscar } }

    vi.useFakeTimers()
    try {
      render(<BuscaProdutos onSelecionar={() => {}} onFechar={() => {}} />)

      const campo = screen.getByPlaceholderText(/buscar produto/i)
      // Cinco teclas dentro da janela do debounce: uma consulta só deve sair.
      for (const termo of ['a', 'ar', 'arr', 'arro', 'arroz']) {
        fireEvent.change(campo, { target: { value: termo } })
        await act(async () => { vi.advanceTimersByTime(20) })
      }
      expect(buscar).not.toHaveBeenCalled() // ainda dentro da janela

      await act(async () => { vi.advanceTimersByTime(ATRASO_BUSCA_MS + 20) })
      expect(buscar).toHaveBeenCalledTimes(1)
      expect(buscar).toHaveBeenCalledWith('arroz')
    } finally {
      vi.useRealTimers()
    }
  })
})
