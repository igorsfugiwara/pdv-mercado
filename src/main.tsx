import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import ForaDoApp from './components/ForaDoApp'
import './index.css'

/**
 * No desktop o preload do Electron já definiu `window.api` antes deste script,
 * e o `import()` abaixo nunca acontece — o cliente HTTP fica num chunk separado
 * que o app offline-first jamais carrega (RNF-06).
 * Na web não há preload, então instalamos o adapter equivalente antes de montar.
 */
async function bootstrap() {
  const raiz = ReactDOM.createRoot(document.getElementById('root')!)
  const noNavegador = !('api' in window)

  if (noNavegador) {
    const { apiWeb } = await import('./web/apiWeb')
    ;(window as any).api = apiWeb
    ;(window as any).__pdvWeb = true

    // Em desenvolvimento, o endereço do Vite não tem backend nenhum. Detectar
    // isso agora evita o percurso confuso de descobrir só ao tentar entrar —
    // onde a falha de transporte parece credencial inválida.
    if (import.meta.env.DEV && !(await temBackend())) {
      raiz.render(
        <React.StrictMode>
          <ForaDoApp endereco={window.location.origin} />
        </React.StrictMode>,
      )
      return
    }
  }

  raiz.render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>,
  )
}

/** Sonda barata: o dev server do Vite devolve 404 em /api/rpc; a Vercel, não. */
async function temBackend(): Promise<boolean> {
  try {
    const r = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canal: '__ping__', args: [] }),
    })
    // 404 = a rota não existe (sem backend). Qualquer outra resposta significa
    // que há uma API do outro lado, mesmo que ela recuse este canal.
    return r.status !== 404
  } catch {
    return false
  }
}

void bootstrap()
