import { useEffect, useState } from 'react'
import type { DocumentoFiscal, StatusSefaz, StatusDocumentoFiscal } from '@shared/types'
import { FaixaSimulado, useEstadoFiscal } from '../components/AvisoFiscalSimulado'

const STATUS_LABEL: Record<StatusDocumentoFiscal, string> = {
  pendente: 'Pendente',
  autorizada: 'Autorizada',
  contingencia_pendente: 'Contingência',
  rejeitada: 'Rejeitada',
  cancelada: 'Cancelada',
  inutilizada: 'Inutilizada',
}

// RF-30: monitor fiscal.
export default function FiscalScreen() {
  const [status, setStatus] = useState<StatusSefaz | null>(null)
  const [cert, setCert] = useState<{ valido: boolean; expiraEm: string | null } | null>(null)
  const [docs, setDocs] = useState<DocumentoFiscal[]>([])
  const [fila, setFila] = useState<DocumentoFiscal[]>([])
  const [filtro, setFiltro] = useState<StatusDocumentoFiscal | ''>('')
  const estadoFiscal = useEstadoFiscal()

  async function recarregar() {
    setStatus(await window.api.fiscal.statusServico())
    setCert(await window.api.fiscal.validarCertificado())
    setDocs(await window.api.fiscal.listarDocumentos(filtro || undefined))
    setFila(await window.api.fiscal.filaContingencia())
  }
  useEffect(() => { void recarregar() }, [filtro]) // eslint-disable-line react-hooks/exhaustive-deps

  const diasCert =
    cert?.expiraEm ? Math.round((new Date(cert.expiraEm).getTime() - Date.now()) / 86400000) : null

  return (
    <div className="p-4">
      <h1 className="mb-4 font-display text-2xl text-primary">Monitor fiscal</h1>

      <FaixaSimulado estado={estadoFiscal} />

      <div className="mb-4 grid grid-cols-3 gap-4">
        <div className="card">
          <p className="text-xs uppercase text-text-muted">SEFAZ-SP</p>
          <p className={`text-lg ${status?.online ? 'text-success' : 'text-danger'}`}>
            {status?.online ? 'Online' : 'Offline / indisponível'}
          </p>
          <p className="text-xs text-text-muted">Ambiente: {status?.ambiente}</p>
          <p className="mt-1 text-xs text-text-muted">{status?.mensagem}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase text-text-muted">Certificado A1</p>
          <p className={`text-lg ${cert?.valido ? 'text-success' : 'text-danger'}`}>
            {cert?.valido ? 'Válido' : 'Não configurado'}
          </p>
          {diasCert != null && (
            <p className={`text-xs ${diasCert <= 30 ? 'text-warning' : 'text-text-muted'}`}>
              expira em {diasCert} dias
            </p>
          )}
        </div>
        <div className="card">
          <p className="text-xs uppercase text-text-muted">Fila de contingência</p>
          <p className={`text-lg ${fila.length ? 'text-warning' : 'text-success'}`}>{fila.length}</p>
          <button
            className="btn-ghost mt-2 text-xs"
            onClick={() => window.api.fiscal.reprocessarFila().then(recarregar)}
          >
            Reprocessar agora
          </button>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase text-text-muted">Documentos</h2>
        <select
          className="input ml-auto max-w-xs"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as StatusDocumentoFiscal | '')}
        >
          <option value="">Todos</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-text-muted">
          <tr className="border-b border-border">
            <th className="py-2">Núm.</th>
            <th>Série</th>
            <th>Chave</th>
            <th>Status</th>
            <th>Emitida</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="border-b border-border/40">
              <td className="py-2 font-mono">{d.numero}</td>
              <td className="font-mono">{d.serie}</td>
              <td className="font-mono text-xs">{d.chaveAcesso ?? '—'}</td>
              <td>{STATUS_LABEL[d.status]}</td>
              <td className="text-xs text-text-muted">{d.emitidaEm?.slice(0, 19).replace('T', ' ') ?? '—'}</td>
            </tr>
          ))}
          {docs.length === 0 && (
            <tr><td colSpan={5} className="py-6 text-center text-text-muted">Nenhum documento.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
