import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import ForaDoApp from './components/ForaDoApp'
import './index.css'

/**
 * No desktop quem define `window.api` é o preload; na web, o adapter HTTP.
 *
 * A distinção NÃO pode ser `'api' in window`: o preload é ESM e pode terminar
 * depois do primeiro script da página. Com o renderer servido de `file://` —
 * que é o caso do app empacotado — ele vence a corrida, o adapter HTTP entra
 * por cima do preload e o login falha com "Failed to fetch". Em desenvolvimento
 * o dev server do Vite é lento o bastante para esconder o problema.
 *
 * O `userAgent` é síncrono e definitivo: só o renderer do Electron o traz.
 */
const EH_DESKTOP = navigator.userAgent.includes('Electron')

/** Espera o preload expor a ponte. No desktop ela sempre chega. */
async function esperarPonte(limiteMs = 10_000): Promise<boolean> {
  const fim = Date.now() + limiteMs
  while (!('api' in window)) {
    if (Date.now() > fim) return false
    await new Promise((r) => setTimeout(r, 20))
  }
  return true
}

async function bootstrap() {
  const raiz = ReactDOM.createRoot(document.getElementById('root')!)

  if (EH_DESKTOP) {
    const pronto = await esperarPonte()
    if (!pronto) {
      // Sem ponte e sem HTTP não há app: melhor dizer isso do que fingir que
      // é credencial inválida.
      raiz.render(
        <React.StrictMode>
          <ForaDoApp endereco="preload do Electron não carregou" />
        </React.StrictMode>,
      )
      return
    }
  } else {
    const { apiWeb } = await import('./web/apiWeb')
    ;(window as any).api = apiWeb
    ;(window as any).__pdvWeb = true

    // No navegador, o endereço do Vite não tem backend nenhum. Detectar isso
    // agora evita o percurso confuso de descobrir só ao tentar entrar — onde a
    // falha de transporte parece credencial inválida.
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
