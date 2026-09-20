import { useCallback, useEffect, useState } from 'react'
import type { VendaResumo, StatusVenda } from '@shared/types'
import { formatBRL } from '../lib/money'
import { useDialogos } from '../components/dialogos'
import Aviso, { useAviso } from '../components/Aviso'

/**
 * Vendas do período (RF-09) — a tela que faltava para chegar até uma venda
 * finalizada e cancelá-la.
 *
 * Venda cancelada continua na lista, riscada: auditoria é histórico, não
 * faxina. Se ela sumisse, ninguém conseguiria explicar o estorno de estoque
 * depois.
 */
const hoje = () => new Date().toISOString().slice(0, 10)

const ROTULO_FISCAL: Record<string, string> = {
  autorizada: 'Autorizada',
  contingencia_pendente: 'Contingência',
  rejeitada: 'Rejeitada',
  cancelada: 'Cancelada',
  pendente: 'Pendente',
  inutilizada: 'Inutilizada',
}

export default function VendasScreen() {
  const [de, setDe] = useState(hoje())
  const [ate, setAte] = useState(hoje())
  const [status, setStatus] = useState<StatusVenda | ''>('')
  const [vendas, setVendas] = useState<VendaResumo[]>([])
  const [carregando, setCarregando] = useState(true)

  const dlg = useDialogos()
  const { aviso, mostrar: avisar, limpar: limparAviso } = useAviso()

  const carregar = useCallback(async () => {
    setCarregando(true)
    setVendas(
      await window.api.vendas.listar({ de, ate, status: status || undefined }),
    )
    setCarregando(false)
  }, [de, ate, status])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function cancelar(v: VendaResumo) {
    if (v.status === 'cancelada') return

    const justificativa = await dlg.pedirTexto({
      titulo: `Cancelar a venda #${v.id}?`,
      descricao: `${formatBRL(v.total)} · ${v.quantidadeItens} item(ns) · ${v.operador}`,
      placeholder: 'Motivo do cancelamento',
      // A SEFAZ exige 15 caracteres no evento; a tela não aceita menos.
      validar: (texto) => {
        const n = texto.trim().length
        return n >= 15 ? null : `Faltam ${15 - n} caracteres (mínimo 15).`
      },
    })
    if (!justificativa) return

    const confirmou = await dlg.confirmar({
      titulo: 'Confirmar cancelamento',
      descricao: `A venda #${v.id} de ${formatBRL(v.total)} será cancelada e o estoque estornado. A ação não pode ser desfeita.`,
      rotuloConfirmar: 'Cancelar venda',
      destrutivo: true,
    })
    if (!confirmou) return

    const pin = await dlg.pedirPin({
      titulo: 'Autorização do supervisor',
      descricao: `Cancelamento da venda #${v.id}.`,
    })
    if (!pin) return

    const auth = await window.api.auth.autorizarSupervisor(pin)
    if (!auth.ok || !auth.usuario) {
      avisar('PIN sem permissão para cancelar venda.', 'erro')
      return
    }

    const r = await window.api.vendas.cancelar(v.id, justificativa, auth.usuario.id)
    if (!r.ok) {
      avisar(r.motivo ?? 'Não foi possível cancelar.', 'erro')
      return
    }

    // O resultado fiscal muda o que o operador precisa fazer em seguida — por
    // isso cada caso tem mensagem própria, e os que exigem ação não somem.
    if (r.fiscal === 'cancelada') {
      avisar(`Venda #${v.id} cancelada e NFC-e cancelada na SEFAZ.`, 'sucesso')
    } else if (r.fiscal === 'fora-do-prazo') {
      avisar(r.detalheFiscal ?? 'Fora do prazo de cancelamento fiscal.', 'erro')
    } else if (r.fiscal === 'falhou') {
      avisar(
        `Venda #${v.id} cancelada, mas a NFC-e não foi cancelada: ${r.detalheFiscal ?? 'SEFAZ indisponível'}. Reprocesse no monitor fiscal.`,
        'erro',
      )
    } else {
      avisar(`Venda #${v.id} cancelada.`, 'sucesso')
    }

    await carregar()
  }

  return (
    <div className="p-4">
      <h1 className="mb-4 font-display text-2xl text-primary">Vendas</h1>

      <div className="mb-4">
        <Aviso aviso={aviso} onDispensar={limparAviso} />
      </div>

      <div className="mb-4 flex items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-text-muted">De</span>
          <input type="date" className="input" value={de} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-text-muted">Até</span>
          <input type="date" className="input" value={ate} onChange={(e) => setAte(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-text-muted">Situação</span>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusVenda | '')}
          >
            <option value="">Todas</option>
            <option value="finalizada">Finalizadas</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </label>
      </div>

      {carregando ? (
        <p className="text-text-muted">Carregando…</p>
      ) : vendas.length === 0 ? (
        <p className="text-text-muted">Nenhuma venda no período.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-text-muted">
              <th className="pb-2">#</th>
              <th className="pb-2">Hora</th>
              <th className="pb-2">Operador</th>
              <th className="pb-2 text-right">Itens</th>
              <th className="pb-2">Pagamento</th>
              <th className="pb-2">NFC-e</th>
              <th className="pb-2 text-right">Total</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {vendas.map((v) => {
              const cancelada = v.status === 'cancelada'
              return (
                <tr
                  key={v.id}
                  className={`border-t border-border ${cancelada ? 'text-text-muted line-through' : ''}`}
                >
                  <td className="py-2 font-mono">{v.id}</td>
                  <td className="py-2">
                    {new Date(v.criadoEm).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="py-2">{v.operador}</td>
                  <td className="py-2 text-right font-mono">{v.quantidadeItens}</td>
                  <td className="py-2 capitalize">{v.formas.join(' + ') || '—'}</td>
                  <td className="py-2">
                    {v.documentoStatus ? ROTULO_FISCAL[v.documentoStatus] : '—'}
                  </td>
                  <td className="py-2 text-right font-mono">{formatBRL(v.total)}</td>
                  <td className="py-2 text-right">
                    {!cancelada && (
                      <button className="btn-ghost text-xs" onClick={() => void cancelar(v)}>
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {dlg.elemento}
    </div>
  )
}
