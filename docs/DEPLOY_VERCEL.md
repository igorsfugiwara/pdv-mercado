# Colocar o PDV web no ar (Vercel)

Guia do zero até a tela de caixa funcionando numa URL pública. Uns 15 minutos.

O app desktop (Electron + SQLite + NFC-e + periféricos) continua neste mesmo
repositório e não é afetado por nada aqui — ver [README](../README.md).

---

## O que muda na web

| | Desktop (Electron) | Web (Vercel) |
|---|---|---|
| Banco | SQLite local, offline-first | Postgres gerenciado |
| Senhas | argon2id | scrypt (`node:crypto`) — argon2 é nativo e não sobrevive ao bundle serverless |
| Sessão | processo main | cookie HttpOnly assinado (HMAC), 12 h |
| NFC-e | ACBrLib + certificado A1 → SEFAZ-SP | **simulada** — chave de acesso válida em estrutura, sem valor fiscal |
| Impressora / balança / gaveta | ESC/POS, serial | indisponível (o caixa cai para digitação manual do peso) |
| Backup | dump agendado local | responsabilidade do provedor Postgres |

Tudo o mais — caixa, carrinho, pesáveis, pagamento múltiplo, troco, sangria e
suprimento, produtos, estoque, relatórios, curva ABC — roda igual, porque é o
mesmo renderer React falando com o mesmo contrato `PdvApi`.

---

## 1. Criar o banco Postgres

Qualquer Postgres serve. O caminho mais curto é o [Neon](https://neon.tech)
(free tier, sem cartão):

1. Crie um projeto — região `AWS us-east-1` costuma ser a mais próxima das
   funções da Vercel.
2. Copie a connection string **Pooled** (o Neon mostra as duas; a pooled tem
   `-pooler` no host).

> **Por que a pooled:** cada request serverless abre uma conexão nova e curta.
> Na string direta o Postgres derruba por excesso de conexões assim que houver
> algum tráfego.

Alternativas equivalentes: Supabase (use a porta 6543, do PgBouncer), Vercel
Postgres, ou qualquer Postgres com SSL.

## 2. Preparar as variáveis

```bash
cp .env.example .env.local
```

Preencha as duas:

- `DATABASE_URL` — a string pooled do passo 1, com `?sslmode=require`.
- `SESSION_SECRET` — gere o seu:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Criar as tabelas e os dados de demonstração

```bash
npm install
npm run db:setup
```

Isso aplica o DDL de `server/migrations/0000_init.sql` (idempotente — pode rodar
de novo) e insere usuários e produtos de exemplo. Rodar de novo com o banco já
populado não duplica nada.

Usuários criados:

| Login | Senha | PIN | Perfil |
|---|---|---|---|
| `admin` | `admin123` | 9999 | admin |
| `supervisor` | `super123` | 1234 | supervisor |
| `caixa` | `caixa123` | 1111 | operador |

> **Troque essas senhas antes de expor a URL para alguém.** São credenciais de
> demonstração, versionadas em `server/setup.ts`.

## 4. Subir para o GitHub

```bash
git remote add origin git@github.com:SEU_USUARIO/pdv-mercado.git
git push -u origin main
```

## 5. Deploy na Vercel

1. [vercel.com/new](https://vercel.com/new) → importe o repositório.
2. **Não mexa** em Framework/Build/Output: o `vercel.json` já define
   `npm run build:web`, saída em `dist` e install com `--omit=optional`
   (é isso que faz a Vercel pular Electron, better-sqlite3 e afins).
3. Em **Environment Variables**, adicione `DATABASE_URL` e `SESSION_SECRET`
   com os mesmos valores do `.env.local`, nos três ambientes.
4. **Deploy**.

Pelo CLI, se preferir:

```bash
npx vercel --prod
```

## 6. Conferir

Abra `https://SEU-APP.vercel.app/api/health`. A resposta diz exatamente o que
está faltando:

```json
{ "ok": true, "checagens": { "DATABASE_URL": "definida", "SESSION_SECRET": "definida", "banco": "conectado", "usuarios": "3" } }
```

Depois abra a raiz e entre com `caixa` / `caixa123`.

### Roteiro de 2 minutos para ver funcionando

1. Login como `caixa`.
2. Abrir caixa com fundo de troco (ex.: `100,00`).
3. `F2` e busque "arroz" — ou digite o EAN `7891000100103` e dê Enter.
4. Bipe "Banana Prata": é pesável, então o navegador pede o peso na mão
   (sem balança serial) — digite `1,5`.
5. `F10` para pagamento, escolha dinheiro, informe um valor maior que o total
   e confira o troco.
6. Menu **Relatórios** → período de hoje → veja resumo, formas de pagamento e
   curva ABC. **Exportar CSV** baixa o arquivo direto pelo navegador.
7. Menu **Fiscal** → o documento aparece autorizado, com chave de 44 dígitos
   (simulada — ver a tabela lá em cima).

---

## Problemas comuns

**`/api/health` responde 503 com `banco: ERRO`**
As tabelas não existem. Rode `npm run db:setup` com a mesma `DATABASE_URL` que
está na Vercel.

**`too many connections` / timeout intermitente**
Está usando a connection string direta em vez da pooled. Troque na Vercel e
faça um redeploy.

**Login responde "Sessão expirada" logo em seguida**
`SESSION_SECRET` diferente entre os ambientes da Vercel, ou ausente. O cookie é
assinado com ela; se muda, todo cookie emitido antes deixa de valer.

**Build falha instalando `better-sqlite3` / `electron`**
O install command foi sobrescrito nas configurações do projeto. Precisa ser
`npm install --omit=optional`, como está no `vercel.json`.

---

## Desenvolvimento local da versão web

```bash
npm run dev:web     # só o SPA (as chamadas /api falham — bom para mexer em UI)
npx vercel dev      # SPA + serverless functions, igual à produção
```

Para trabalhar no app desktop, `npm run dev` continua como sempre.
