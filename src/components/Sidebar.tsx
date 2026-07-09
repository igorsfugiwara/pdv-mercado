import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

const LINKS = [
  { to: '/caixa', label: 'Caixa', atalho: 'F1', perfis: ['admin', 'supervisor', 'operador'] },
  { to: '/produtos', label: 'Produtos', perfis: ['admin', 'supervisor'] },
  { to: '/estoque', label: 'Estoque', perfis: ['admin', 'supervisor'] },
  { to: '/relatorios', label: 'Relatórios', perfis: ['admin', 'supervisor'] },
  { to: '/fiscal', label: 'Fiscal', perfis: ['admin', 'supervisor'] },
  { to: '/config', label: 'Configurações', perfis: ['admin'] },
] as const

export default function Sidebar() {
  const { usuario, logout, temPerfil } = useAuthStore()

  return (
    <aside className="flex w-56 flex-col border-r border-border bg-surface">
      <div className="border-b border-border p-4">
        <h1 className="font-display text-xl text-primary">PDV Mercado</h1>
        <p className="text-xs text-text-muted">Caixa 1 · SEFAZ-SP</p>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {LINKS.filter((l) => temPerfil(...l.perfis)).map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              `flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                isActive ? 'bg-primary text-text-inverse' : 'text-text hover:bg-surface-alt'
              }`
            }
          >
            <span>{l.label}</span>
            {'atalho' in l && l.atalho && <span className="kbd">{l.atalho}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-3 text-sm">
        <p className="text-text">{usuario?.nome}</p>
        <p className="mb-2 text-xs uppercase text-text-muted">{usuario?.perfil}</p>
        <button className="btn-ghost w-full text-xs" onClick={() => logout()}>
          Sair
        </button>
      </div>
    </aside>
  )
}
