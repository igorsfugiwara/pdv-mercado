import { getDb, initDb } from './index'
import { usuarios, grupos, produtos } from './schema'
import { hashSenha, hashPin } from '../auth/hash'
import { join } from 'node:path'

// Seeds de DESENVOLVIMENTO (seção 2.3: banco inicia vazio; não migrar dados reais).
export async function seedDatabase() {
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

  const gruposInseridos = await db
    .insert(grupos)
    .values([{ nome: 'Mercearia' }, { nome: 'Hortifruti' }, { nome: 'Bebidas' }])
    .returning()

  const [mercearia, hortifruti, bebidas] = gruposInseridos

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
      ativo: true,
      ncm: '10063021',
      cfop: '5102',
      origem: '0',
      csosn: '102',
      cstPis: '49',
      aliqPis: 0,
      cstCofins: '49',
      aliqCofins: 0,
      criadoEm: agora,
      atualizadoEm: agora,
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
      ativo: true,
      ncm: '08030012',
      cfop: '5102',
      origem: '0',
      csosn: '102',
      cstPis: '49',
      aliqPis: 0,
      cstCofins: '49',
      aliqCofins: 0,
      criadoEm: agora,
      atualizadoEm: agora,
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
      ativo: true,
      ncm: '22021000',
      cfop: '5102',
      origem: '0',
      csosn: '102',
      cstPis: '49',
      aliqPis: 0,
      cstCofins: '49',
      aliqCofins: 0,
      criadoEm: agora,
      atualizadoEm: agora,
    },
  ])

  return { criado: true }
}

// Execução standalone: `npm run db:seed`
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  const dbPath = join(process.cwd(), 'data', 'pdv.db')
  const migrationsDir = join(process.cwd(), 'electron', 'db', 'migrations')
  initDb(dbPath, migrationsDir)
  seedDatabase()
    .then((r) => {
      console.log(r.criado ? '✅ Seeds inseridos.' : 'ℹ️  Banco já populado, nada a fazer.')
      process.exit(0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
