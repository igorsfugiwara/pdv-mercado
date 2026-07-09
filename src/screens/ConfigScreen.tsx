import { useEffect, useState } from 'react'

// Seção 5: Configurações → Periféricos (teste por dispositivo) + Fiscal + Backup.
export default function ConfigScreen() {
  const [config, setConfig] = useState<Record<string, string>>({})
  const [log, setLog] = useState<string[]>([])

  useEffect(() => { void window.api.config.todas().then(setConfig) }, [])

  function push(msg: string) {
    setLog((l) => [`${new Date().toLocaleTimeString('pt-BR')} — ${msg}`, ...l].slice(0, 12))
  }

  async function salvar(chave: string, valor: string) {
    await window.api.config.definir(chave, valor)
    setConfig((c) => ({ ...c, [chave]: valor }))
  }

  return (
    <div className="p-4">
      <h1 className="mb-4 font-display text-2xl text-primary">Configurações</h1>

      <div className="grid grid-cols-2 gap-4">
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase text-text-muted">Periféricos</h2>
          <div className="space-y-2">
            <button className="btn-ghost w-full" onClick={() => window.api.hardware.testarImpressora().then((r) => push(`Impressora: ${r.detalhe}`))}>
              Testar impressora (página de teste)
            </button>
            <button className="btn-ghost w-full" onClick={() => window.api.hardware.testarBalanca().then((r) => push(`Balança: ${r.detalhe}`))}>
              Ler peso da balança
            </button>
            <button className="btn-ghost w-full" onClick={() => window.api.hardware.abrirGaveta().then((r) => push(`Gaveta: ${r.detalhe}`))}>
              Abrir gaveta
            </button>
          </div>
          {log.length > 0 && (
            <ul className="mt-3 space-y-1 rounded bg-surface-alt p-2 text-xs text-text-muted">
              {log.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase text-text-muted">Fiscal (NFC-e SEFAZ-SP)</h2>
          <div className="space-y-3">
            <CampoConfig chave="fiscal.ambiente" label="Ambiente" config={config} onSalvar={salvar} placeholder="homologacao | producao" />
            <CampoConfig chave="fiscal.libPath" label="Caminho ACBrLib (.dll/.so)" config={config} onSalvar={salvar} />
            <CampoConfig chave="fiscal.certPath" label="Certificado A1 (.pfx)" config={config} onSalvar={salvar} />
            <CampoConfig chave="fiscal.cscId" label="CSC ID" config={config} onSalvar={salvar} />
            <CampoConfig chave="fiscal.cscToken" label="CSC Token" config={config} onSalvar={salvar} />
          </div>
          <p className="mt-2 text-xs text-text-muted">
            A senha do certificado é guardada via safeStorage do SO (nunca em texto).
          </p>
        </section>

        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase text-text-muted">Backup</h2>
          <div className="space-y-2">
            <button className="btn-ghost w-full" onClick={() => window.api.backup.executarAgora().then((r) => push(`Backup: ${r.caminho}`))}>
              Backup agora
            </button>
            <button className="btn-ghost w-full" onClick={() => window.api.backup.exportarPara('').then((r) => push(`Exportado: ${r.caminho || 'cancelado'}`))}>
              Exportar para pendrive…
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function CampoConfig({
  chave, label, config, onSalvar, placeholder,
}: {
  chave: string
  label: string
  config: Record<string, string>
  onSalvar: (chave: string, valor: string) => void
  placeholder?: string
}) {
  const [valor, setValor] = useState('')
  useEffect(() => setValor(config[chave] ?? ''), [config, chave])
  return (
    <div>
      <label className="mb-1 block text-xs uppercase text-text-muted">{label}</label>
      <input
        className="input"
        value={valor}
        placeholder={placeholder}
        onChange={(e) => setValor(e.target.value)}
        onBlur={() => onSalvar(chave, valor)}
      />
    </div>
  )
}
