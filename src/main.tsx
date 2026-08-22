import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

/**
 * No desktop o preload do Electron já definiu `window.api` antes deste script,
 * e o `import()` abaixo nunca acontece — o cliente HTTP fica num chunk separado
 * que o app offline-first jamais carrega (RNF-06).
 * Na web não há preload, então instalamos o adapter equivalente antes de montar.
 */
async function bootstrap() {
  if (!('api' in window)) {
    const { apiWeb } = await import('./web/apiWeb')
    ;(window as any).api = apiWeb
    ;(window as any).__pdvWeb = true
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>,
  )
}

void bootstrap()
