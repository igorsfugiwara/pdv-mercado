/**
 * Tela mostrada quando o renderer está num navegador comum, sem backend.
 *
 * Existe porque o `npm run dev` imprime um endereço do Vite que *parece* o app.
 * Ele não é: serve só para a janela do Electron carregar o renderer de dentro.
 * Abrir esse endereço no navegador dá um app sem `window.api` — e antes disso
 * falhava só no login, o que parecia credencial inválida.
 */
export default function ForaDoApp({ endereco }: { endereco: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg p-6">
      <div className="card max-w-xl space-y-4">
        <h1 className="font-display text-2xl text-primary">Este não é o app</h1>

        <p className="text-sm text-text">
          Você abriu <code className="font-mono text-primary">{endereco}</code>, que é o
          servidor de desenvolvimento do Vite. Ele existe só para a janela do Electron
          carregar a interface de dentro — sozinho, ele não tem banco nem backend.
        </p>

        <div className="rounded-md border-l-2 border-l-primary bg-surface-alt px-4 py-3">
          <p className="text-sm font-medium text-text">O app já está aberto na sua tela.</p>
          <p className="mt-1 text-sm text-text-muted">
            Procure a janela chamada <strong className="text-text">PDV Mercado</strong> —
            use <kbd className="kbd">Alt</kbd> + <kbd className="kbd">Tab</kbd> ou clique no
            ícone do Electron na barra de tarefas. Em desenvolvimento também abre uma janela
            de DevTools junto; a do app é a que tem a tela de login.
          </p>
        </div>

        <details className="text-sm text-text-muted">
          <summary className="cursor-pointer text-text">
            E se eu quiser mesmo usar pelo navegador?
          </summary>
          <p className="mt-2">
            Aí é a versão web, que precisa de um Postgres: configure{' '}
            <code className="font-mono">DATABASE_URL</code> e{' '}
            <code className="font-mono">SESSION_SECRET</code>, rode{' '}
            <code className="font-mono">npm run db:setup</code> e suba com{' '}
            <code className="font-mono">npx vercel dev</code>. O passo a passo está em{' '}
            <code className="font-mono">docs/DEPLOY_VERCEL.md</code>.
          </p>
        </details>
      </div>
    </div>
  )
}
