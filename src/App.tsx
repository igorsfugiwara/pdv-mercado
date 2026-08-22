import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import Sidebar from './components/Sidebar'
import LoginScreen from './screens/LoginScreen'
import CaixaScreen from './screens/CaixaScreen'
import FechamentoScreen from './screens/FechamentoScreen'
import ProdutosScreen from './screens/ProdutosScreen'
import EstoqueScreen from './screens/EstoqueScreen'
import RelatoriosScreen from './screens/RelatoriosScreen'
import FiscalScreen from './screens/FiscalScreen'
import ConfigScreen from './screens/ConfigScreen'

export default function App() {
  const usuario = useAuthStore((s) => s.usuario)

  if (!usuario) return <LoginScreen />

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-bg">
        <Routes>
          <Route path="/caixa" element={<CaixaScreen />} />
          <Route path="/fechamento" element={<FechamentoScreen />} />
          <Route path="/produtos" element={<ProdutosScreen />} />
          <Route path="/estoque" element={<EstoqueScreen />} />
          <Route path="/relatorios" element={<RelatoriosScreen />} />
          <Route path="/fiscal" element={<FiscalScreen />} />
          <Route path="/config" element={<ConfigScreen />} />
          <Route path="*" element={<Navigate to="/caixa" replace />} />
        </Routes>
      </main>
    </div>
  )
}
