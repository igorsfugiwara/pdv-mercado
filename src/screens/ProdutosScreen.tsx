import { useEffect, useState } from 'react'
import type { Produto } from '@shared/types'
import type { ProdutoInput } from '@shared/ipc'
import { useAuthStore } from '../store/authStore'
import { formatBRL, parseBRL } from '../lib/money'
import ProdutoForm from '../components/ProdutoForm'
import { ehWeb } from '../lib/plataforma'
import { useDialogos } from '../components/dialogos'
import Aviso, { useAviso } from '../components/Aviso'

export default function ProdutosScreen() {
  const usuario = useAuthStore((s) => s.usuario)!
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [incluirInativos, setIncluirInativos] = useState(false)
  const [editando, setEditando] = useState<ProdutoInput | null>(null)
  const [busca, setBusca] = useState('')

  async function recarregar() {
    setProdutos(await window.api.produtos.listar(incluirInativos))
  }
  useEffect(() => { void recarregar() }, [incluirInativos]) // eslint-disable-line react-hooks/exhaustive-deps

  const dlg = useDialogos()
  const { aviso, mostrar: avisar, limpar: limparAviso } = useAviso()

  const filtrados = produtos.filter((p) =>
    [p.descricao, p.ean, p.codigoInterno].some((c) => c?.toLowerCase().includes(busca.toLowerCase())),
  )

  async function excluir(p: Produto) {
    // Exclusão é destrutiva e antes acontecia direto no clique.
    const ok = await dlg.confirmar({
      titulo: 'Excluir produto?',
      descricao: `${p.descricao} será removido do cadastro.`,
      rotuloConfirmar: 'Excluir',
      destrutivo: true,
    })
    if (!ok) return

    const r = await window.api.produtos.excluir(p.id, usuario.id)
    if (!r.ok) avisar(r.motivo ?? 'Não foi possível excluir.', 'erro')
    else avisar(`${p.descricao} excluído.`, 'sucesso')
    await recarregar()
  }

  async function importarCsv() {
    // No desktop o main lê o arquivo do disco; na web o adapter abre o seletor
    // de arquivos e envia o conteúdo, então não há caminho a pedir.
    let caminho = ''
    if (!ehWeb()) {
      const informado = await dlg.pedirTexto({
        titulo: 'Importar CSV',
        descricao: 'Caminho do arquivo no disco.',
        placeholder: '/home/usuario/produtos.csv',
        validar: (v) => (v.trim().endsWith('.csv') ? null : 'Informe um arquivo .csv.'),
      })
      if (!informado) return
      caminho = informado
    }
    const r = await window.api.produtos.importarCsv(caminho)
    // Resultado de importação pode ter erro linha a linha: fica até dispensar.
    const houveErro = r.erros.length > 0
    avisar(
      `Importados: ${r.importados}.` +
        (houveErro ? `\nErros:\n${r.erros.join('\n')}` : ' Nenhum erro.'),
      houveErro ? 'erro' : 'sucesso',
    )
    await recarregar()
  }

  return (
    <div className="p-4">
      <header className="mb-4 flex items-center gap-3">
        <h1 className="font-display text-2xl text-primary">Produtos</h1>
        <input
          className="input ml-4 max-w-xs"
          placeholder="Filtrar…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input type="checkbox" checked={incluirInativos} onChange={(e) => setIncluirInativos(e.target.checked)} />
          incluir inativos
        </label>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" onClick={importarCsv}>Importar CSV</button>
          <button
            className="btn-primary"
            onClick={() => setEditando({ ...vazio() })}
          >
            Novo produto
          </button>
        </div>
      </header>

      <div className="mb-4"><Aviso aviso={aviso} onDispensar={limparAviso} /></div>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-text-muted">
          <tr className="border-b border-border">
            <th className="py-2">Cód.</th>
            <th>EAN</th>
            <th>Descrição</th>
            <th>Un.</th>
            <th className="text-right">Venda</th>
            <th className="text-right">Estoque</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtrados.map((p) => (
            <tr key={p.id} className="border-b border-border/40">
              <td className="py-2 font-mono">{p.codigoInterno}</td>
              <td className="font-mono text-xs">{p.ean ?? '—'}</td>
              <td>{p.descricao}</td>
              <td>{p.unidade}</td>
              <td className="text-right font-mono">{formatBRL(p.precoVenda)}</td>
              <td className="text-right font-mono">{p.estoqueAtual}</td>
              <td>
                <span className={p.ativo ? 'text-success' : 'text-text-muted'}>
                  {p.ativo ? 'ativo' : 'inativo'}
                </span>
              </td>
              <td className="space-x-2 text-right">
                <button className="text-primary" onClick={() => setEditando(toInput(p))}>editar</button>
                {p.ativo ? (
                  <button className="text-warning" onClick={() => window.api.produtos.inativar(p.id, usuario.id).then(recarregar)}>inativar</button>
                ) : (
                  <button className="text-success" onClick={() => window.api.produtos.reativar(p.id, usuario.id).then(recarregar)}>reativar</button>
                )}
                <button className="text-danger" onClick={() => excluir(p)}>excluir</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editando && (
        <ProdutoForm
          inicial={editando}
          onSalvar={async (input) => { await window.api.produtos.salvar(input); setEditando(null); await recarregar() }}
          onFechar={() => setEditando(null)}
        />
      )}
      {dlg.elemento}
    </div>
  )
}

function vazio(): ProdutoInput {
  return {
    codigoInterno: '', ean: null, descricao: '', unidade: 'UN', pesavel: false,
    precoCusto: 0, precoVenda: 0, estoqueAtual: 0, estoqueMinimo: 0, grupoId: null,
    imagemPath: null, ativo: false, ncm: null, cest: null, cfop: null, origem: '0',
    csosn: null, cstPis: null, aliqPis: null, cstCofins: null, aliqCofins: null,
  }
}

function toInput(p: Produto): ProdutoInput {
  const { criadoEm: _c, atualizadoEm: _a, ...rest } = p
  return rest
}

export { parseBRL }
