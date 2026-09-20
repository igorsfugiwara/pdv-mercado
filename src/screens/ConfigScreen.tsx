import { useEffect, useState } from 'react'
import type { EstadoFiscal, ProviderFiscal, ModoFalhaFiscal } from '@shared/types'
import { FaixaSimulado } from '../components/AvisoFiscalSimulado'
import { useAuthStore } from '../store/authStore'

// Seção 5: Configurações → Periféricos (teste por dispositivo) + Fiscal + Backup.
export default function ConfigScreen() {
  const [config, setConfig] = useState<Record<string, string>>({})
  const [log, setLog] = useState<string[]>([])
  const [estadoFiscal, setEstadoFiscal] = useState<EstadoFiscal | null>(null)
  const [provider, setProvider] = useState<ProviderFiscal>('simulado')
  const ehAdmin = useAuthStore((s) => s.usuario?.perfil) === 'admin'

  useEffect(() => { void window.api.config.todas().then(setConfig) }, [])
  useEffect(() => {
    void window.api.fiscal.estado().then((e) => {
      setEstadoFiscal(e)
      // O select mostra o que está PEDIDO na configuração, não o que subiu:
      // se o acbr caiu para simulado, o admin precisa ver que pediu acbr.
      setProvider(e.motivoFallback ? 'acbr' : e.provider)
    })
  }, [])

  async function trocarProvider(novo: ProviderFiscal) {
    setProvider(novo)
    try {
      setEstadoFiscal(await window.api.fiscal.definirProvider(novo))
      push(`Provider fiscal: ${novo}. Vale no próximo início do app.`)
    } catch (e) {
      push(`Não foi possível trocar: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function trocarModoFalha(modo: ModoFalhaFiscal) {
    try {
      setEstadoFiscal(await window.api.fiscal.definirModoFalha(modo))
      push(`Falha simulada: ${modo}.`)
    } catch (e) {
      push(`Não foi possível trocar: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

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
          <h2 className="mb-3 text-sm font-semibold uppercase text-text-muted">Emitente</h2>
          <div className="space-y-3">
            <CampoConfig chave="emitente.nome" label="Nome da loja" config={config} onSalvar={salvar} placeholder="Mercado do Bairro Ltda" />
            <CampoConfig chave="emitente.cnpj" label="CNPJ" config={config} onSalvar={salvar} placeholder="00000000000000" />
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Aparecem no cabeçalho do DANFE e do cupom de fechamento.
          </p>
        </section>

        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase text-text-muted">Caixa</h2>
          <div className="space-y-3">
            <CampoConfig chave="caixa.diferenca.limite" label="Limite de diferença sem justificativa (centavos)" config={config} onSalvar={salvar} placeholder="1000" />
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Acima deste valor, o fechamento exige motivo e PIN de supervisor. Padrão: 1000 (R$ 10,00).
          </p>
        </section>

        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase text-text-muted">
            Módulo fiscal em uso
          </h2>

          <FaixaSimulado estado={estadoFiscal} />

          <div className="space-y-3">
            <div>
              <label htmlFor="fiscal-provider" className="mb-1 block text-xs text-text-muted">
                Provider
              </label>
              <select
                id="fiscal-provider"
                className="input w-full"
                value={provider}
                disabled={!ehAdmin}
                onChange={(e) => void trocarProvider(e.target.value as ProviderFiscal)}
              >
                <option value="simulado">Simulado — sem valor fiscal</option>
                <option value="acbr">ACBrLib — emissão real</option>
              </select>
              <p className="mt-1 text-xs text-text-muted">
                {ehAdmin
                  ? 'A troca vale a partir do próximo início do app. Se o ACBr não subir, o caixa abre em simulado e avisa.'
                  : 'Só o perfil Admin troca o módulo fiscal.'}
              </p>
            </div>

            {estadoFiscal?.simulado && (
              <div>
                <label htmlFor="fiscal-falha" className="mb-1 block text-xs text-text-muted">
                  Falha injetada (para teste)
                </label>
                <select
                  id="fiscal-falha"
                  className="input w-full"
                  value={estadoFiscal.modoFalha}
                  disabled={!ehAdmin}
                  onChange={(e) => void trocarModoFalha(e.target.value as ModoFalhaFiscal)}
                >
                  <option value="nenhuma">Nenhuma — emite autorizada</option>
                  <option value="timeout">Timeout — cai em contingência</option>
                  <option value="rejeicao">Rejeição — documento rejeitado</option>
                </select>
                <p className="mt-1 text-xs text-text-muted">
                  Vale na hora, sem reiniciar. A venda continua sendo gravada em qualquer um
                  dos modos.
                </p>
              </div>
            )}
          </div>
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
