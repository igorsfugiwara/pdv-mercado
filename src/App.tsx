import { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import Sidebar from './components/Sidebar'
import LoginScreen from './screens/LoginScreen'
import CaixaScreen from './screens/CaixaScreen'
import PainelScreen from './screens/PainelScreen'
import VendasScreen from './screens/VendasScreen'
import FechamentoScreen from './screens/FechamentoScreen'
import ProdutosScreen from './screens/ProdutosScreen'
import EstoqueScreen from './screens/EstoqueScreen'
import RelatoriosScreen from './screens/RelatoriosScreen'
import FiscalScreen from './screens/FiscalScreen'
import ConfigScreen from './screens/ConfigScreen'
import { rotaInicial } from './lib/painel'
import { dialogoAberto } from './components/Dialogo'

export default function App() {
  const usuario = useAuthStore((s) => s.usuario)

  if (!usuario) return <LoginScreen />

  return (
    <>
      <AtalhosGlobais />
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-bg">
        <Routes>
          <Route path="/painel" element={<PainelScreen />} />
          <Route path="/caixa" element={<CaixaScreen />} />
          <Route path="/vendas" element={<VendasScreen />} />
          <Route path="/fechamento" element={<FechamentoScreen />} />
          <Route path="/produtos" element={<ProdutosScreen />} />
          <Route path="/estoque" element={<EstoqueScreen />} />
          <Route path="/relatorios" element={<RelatoriosScreen />} />
          <Route path="/fiscal" element={<FiscalScreen />} />
          <Route path="/config" element={<ConfigScreen />} />
          {/* Operador abre o sistema para trabalhar no caixa; quem supervisiona
              abre para saber como está a loja. */}
          <Route path="*" element={<Navigate to={rotaInicial(usuario.perfil)} replace />} />
        </Routes>
      </main>
    </div>
    </>
  )
}

/**
 * Atalhos de navegação (RF-10). O menu lateral anuncia `F1` para o caixa — sem
 * este handler o rótulo era promessa vazia, e voltar ao caixa exigia o mouse.
 */
function AtalhosGlobais() {
  const navigate = useNavigate()

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      // Diálogo aberto consome o teclado: navegar por baixo dele deixaria a
      // pergunta pendente numa tela que não existe mais.
      if (dialogoAberto()) return
      if (e.key === 'F1') {
        e.preventDefault()
        navigate('/caixa')
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [navigate])

  return null
}
