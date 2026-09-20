import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSql, getDb } from './db'
import { usuarios, grupos, produtos } from './schema.pg'
import { hashSenha, hashPin } from './auth'

const aqui = dirname(fileURLToPath(import.meta.url))

/**
 * Cria e evolui as tabelas (DDL idempotente).
 *
 * Aplica **todos** os arquivos de `migrations/` em ordem, não só o init: quando
 * a fatia 10 acrescentou colunas, a migração nova não era aplicada porque este
 * arquivo lia um nome fixo — e o deploy web subiria com o schema velho.
 */
export async function migrar() {
  const sql = getSql()
  const dir = join(aqui, 'migrations')
  const arquivos = readdirSync(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort()

  for (const nome of arquivos) {
    await sql.unsafe(readFileSync(join(dir, nome), 'utf-8'))
  }
}

/**
 * Seeds de DEMONSTRAÇÃO — mesmos usuários e produtos do desktop (`electron/db/seed.ts`),
 * para dar pra logar e bipar produto assim que o deploy sobe. Não roda se já houver usuário.
 */
export async function seed() {
  const db = getDb()
  const existentes = await db.select().from(usuarios).limit(1)
  if (existentes.length > 0) return { criado: false }

  const agora = new Date().toISOString()

  await db.insert(usuarios).values([
    {
      nome: 'Administrador',
      login: 'admin',
      senhaHash: await hashSenha('admin123'),
      pinHash: await hashPin('9999'),
      perfil: 'admin',
      ativo: true,
      criadoEm: agora,
    },
    {
      nome: 'Supervisor',
      login: 'supervisor',
      senhaHash: await hashSenha('super123'),
      pinHash: await hashPin('1234'),
      perfil: 'supervisor',
      ativo: true,
      criadoEm: agora,
    },
    {
      nome: 'Operador Caixa',
      login: 'caixa',
      senhaHash: await hashSenha('caixa123'),
      pinHash: await hashPin('1111'),
      perfil: 'operador',
      ativo: true,
      criadoEm: agora,
    },
  ])

  const [mercearia, hortifruti, bebidas] = await db
    .insert(grupos)
    .values([{ nome: 'Mercearia' }, { nome: 'Hortifruti' }, { nome: 'Bebidas' }])
    .returning()

  const fiscalPadrao = {
    cfop: '5102',
    origem: '0',
    csosn: '102',
    cstPis: '49',
    aliqPis: 0,
    cstCofins: '49',
    aliqCofins: 0,
    ativo: true,
    criadoEm: agora,
    atualizadoEm: agora,
  }

  await db.insert(produtos).values([
    {
      codigoInterno: '1001',
      ean: '7891000100103',
      descricao: 'Arroz Branco 5kg',
      unidade: 'UN',
      pesavel: false,
      precoCusto: 1800,
      precoVenda: 2790,
      estoqueAtual: 40,
      estoqueMinimo: 10,
      grupoId: mercearia.id,
      ncm: '10063021',
      ...fiscalPadrao,
    },
    {
      codigoInterno: '2001',
      ean: null,
      descricao: 'Banana Prata (kg)',
      unidade: 'KG',
      pesavel: true,
      precoCusto: 300,
      precoVenda: 599,
      estoqueAtual: 25.5,
      estoqueMinimo: 5,
      grupoId: hortifruti.id,
      ncm: '08030012',
      ...fiscalPadrao,
    },
    {
      codigoInterno: '3001',
      ean: '7894900011517',
      descricao: 'Refrigerante Cola 2L',
      unidade: 'UN',
      pesavel: false,
      precoCusto: 500,
      precoVenda: 899,
      estoqueAtual: 60,
      estoqueMinimo: 12,
      grupoId: bebidas.id,
      ncm: '22021000',
      ...fiscalPadrao,
    },
    {
      codigoInterno: '1002',
      ean: '7891000315507',
      descricao: 'Feijão Carioca 1kg',
      unidade: 'UN',
      pesavel: false,
      precoCusto: 550,
      precoVenda: 899,
      estoqueAtual: 35,
      estoqueMinimo: 10,
      grupoId: mercearia.id,
      ncm: '07133319',
      ...fiscalPadrao,
    },
    {
      codigoInterno: '2002',
      ean: null,
      descricao: 'Tomate (kg)',
      unidade: 'KG',
      pesavel: true,
      precoCusto: 400,
      precoVenda: 799,
      estoqueAtual: 18.2,
      estoqueMinimo: 5,
      grupoId: hortifruti.id,
      ncm: '07020000',
      ...fiscalPadrao,
    },
    {
      codigoInterno: '3002',
      ean: '7891991010856',
      descricao: 'Água Mineral 1,5L',
      unidade: 'UN',
      pesavel: false,
      precoCusto: 150,
      precoVenda: 349,
      estoqueAtual: 80,
      estoqueMinimo: 20,
      grupoId: bebidas.id,
      ncm: '22011000',
      ...fiscalPadrao,
    },
  ])

  return { criado: true }
}

// `npm run db:setup`
const executadoDireto = process.argv[1]?.endsWith('setup.ts')
if (executadoDireto) {
  ;(async () => {
    try {
      console.log('→ criando tabelas...')
      await migrar()
      console.log('→ populando dados de demonstração...')
      const r = await seed()
      console.log(
        r.criado
          ? '✅ Pronto. Logins: admin/admin123 · supervisor/super123 · caixa/caixa123'
          : 'ℹ️  Banco já populado — tabelas garantidas, seeds preservados.',
      )
      process.exit(0)
    } catch (e) {
      console.error('❌ Falhou:', e instanceof Error ? e.message : e)
      process.exit(1)
    }
  })()
}
