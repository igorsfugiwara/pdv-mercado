# Plano e Estado Atual

**PDV Mercado · Índice dos PRDs e ordem de execução**

Este documento é o mapa: o que já está de pé, o que falta para o operacional ficar
impecável, e em que ordem atacar. Cada fatia tem PRD próprio, fecha sozinha e é
verificável — nenhuma depende de fatia futura para funcionar.

| | |
|---|---|
| **Foco desta rodada** | Operacional impecável. Integrações reais ficam para depois. |
| **NFC-e** | **Simulada** em todas as fatias. Emissão real é fase posterior. |
| **Alvo** | Desktop (Electron). A versão web existe e continua compilando, mas não é o foco. |
| **Credenciais** | Seeds de teste mantidos como estão (`admin/admin123`, `caixa/caixa123`). |

> O PRD original completo (RF-01 a RF-31, modelo de dados, hardware, fiscal SEFAZ-SP)
> está em [`docs/PRD-PDV-Supermercado.md`](../PRD-PDV-Supermercado.md). Os documentos
> desta pasta não o substituem — recortam a parte operacional em fatias executáveis.

---

## 1. Diagnóstico

Auditoria feita no código, não na memória do que foi construído. Cada linha abaixo
foi verificada em arquivo.

### O que está sólido

O núcleo de dados e as regras de domínio estão bem construídos e cobertos por teste:

- **Transação de venda** (`electron/db/repositories/vendas.repo.ts`) — venda, itens,
  pagamentos, baixa de estoque e documento fiscal numa transação só. Estorno no
  cancelamento, com guarda de idempotência.
- **Numeração fiscal sequencial** por série, sem reuso (invariante 2).
- **Validação de finalização** (`shared/vendaValidacao.ts`) — total positivo, pagamento
  suficiente, troco só em dinheiro.
- **Rascunho pós-queda** — venda em andamento persistida e recuperada na reabertura.
- **Relatórios** — vendas por período/forma/operador/produto/grupo e curva ABC, com as
  agregações testadas.
- **Auth argon2id + PIN**, auditoria append-only.
- **87 testes passando**, incluindo 27 contra Postgres real (PGlite).

### O que impede o operacional de ser impecável

| # | Achado | Evidência | Fatia |
|---|---|---|---|
| 1 | **18 `prompt()`/`alert()`/`confirm()` no renderer.** CPF, multiplicador, desconto, peso, sangria, PIN de supervisor — tudo em diálogo nativo. Trava a thread, ignora o tema, não dá para navegar por teclado de forma previsível e some do fluxo do operador. | 10 em `CaixaScreen.tsx`, 4 em `EstoqueScreen.tsx`, 3 em `ProdutosScreen.tsx`, 1 em `RelatoriosScreen.tsx` | **02** |
| 2 | **Não há tela de fechamento de caixa.** `caixaStore.fechar()` existe e o repositório calcula a diferença, mas nenhuma tela chama. Um turno começa e não termina. | `src/store/caixaStore.ts:20`, sem chamador em `src/screens/` | **04** |
| 3 | **Parser de etiqueta de balança órfão.** `parseEanBalanca()` está escrito e testado, mas `processarCaptura()` não o chama — bipar etiqueta de balança (EAN-13 prefixo 2) simplesmente não acha o produto. | `electron/hardware/balanca.ts:103` definido; zero chamadas fora do próprio módulo | **05** |
| 4 | **Desconto sem limite por perfil (RF-05).** `pedirDescontoVenda()` aceita qualquer valor de qualquer operador, sem autorização. Não há desconto por item na UI, embora o tipo suporte. | `CaixaScreen.tsx:155` | **03** |
| 5 | **Cancelamento de item sem autorização (RF-06)** e só do último item — não dá para cancelar um item no meio da compra. | `CaixaScreen.tsx:161` | **03** |
| 6 | **Sem painel de abertura** — o alerta de estoque mínimo (RF-18) não tem onde aparecer. `estoque.alertasMinimo()` existe e ninguém consome no lugar certo. | não há `DashboardScreen` | **06** |
| 7 | **Fiscal do desktop só instancia `AcbrNfceProvider`.** Sem a lib nativa e o certificado, o módulo fiscal não inicializa — ou seja, hoje não dá para rodar o app inteiro numa máquina de teste. | `electron/fiscal/index.ts:13` | **01** |
| 8 | **Busca sem debounce** — dispara uma consulta por tecla digitada. | `src/components/BuscaProdutos.tsx:23` | **02** |

### O que fica explicitamente para depois

NFC-e real (ACBrLib + certificado A1 + homologação SEFAZ), impressora térmica e gaveta
físicas, balança serial física, exportação PDF (RF-25), instaladores assinados, e a
versão web. Nada disso entra nesta rodada.

---

## 2. Fatias

Ordem pensada para que cada fatia deixe o app mais testável do que encontrou. A 01 vem
primeiro porque sem ela não dá para exercitar nenhuma das outras ponta a ponta.

| Fatia | PRD | Entrega | Depende de |
|---|---|---|---|
| **01** | [Fiscal Simulado e Ambiente de Teste](01%20-%20Fiscal%20Simulado%20e%20Ambiente%20de%20Teste.md) | App sobe e vende sem ACBrLib, certificado ou periférico. Provider fiscal escolhido por configuração. | — |
| **02** | [Diálogos do Caixa](02%20-%20Diálogos%20do%20Caixa.md) | Todo `prompt/alert/confirm` vira diálogo próprio, operável por teclado, sem travar a thread. | 01 |
| **03** | [Autorização e Limites](03%20-%20Autorização%20e%20Limites.md) | Limite de desconto por perfil, autorização por PIN acima do limite, cancelamento de item arbitrário — tudo auditado. | 02 |
| **04** | [Fechamento de Caixa](04%20-%20Fechamento%20de%20Caixa.md) | Conferência cega, apuração de diferença, comprovante do turno. Fecha o ciclo abertura→fechamento. | 02 |
| **05** | [Etiqueta de Balança](05%20-%20Etiqueta%20de%20Balança.md) | Bipar etiqueta de balança resolve produto e peso/valor. Liga o parser órfão. | 02 |
| **06** | [Painel e Estoque Mínimo](06%20-%20Painel%20e%20Estoque%20Mínimo.md) | Tela inicial com o estado do turno e os alertas que exigem ação. | 04 |
| **07** | [Aceite Ponta a Ponta](07%20-%20Aceite%20Ponta%20a%20Ponta.md) | O critério 9.4 do PRD original virado em teste E2E que roda no CI. | 03, 04, 05 |

### Por que esta ordem

A fatia **02** vem logo depois da 01 porque quase toda fatia seguinte precisa pedir algo
ao operador — PIN, valor contado, peso. Fazer isso enquanto ainda existe `prompt()` é
construir duas vezes: uma no diálogo nativo, outra quando ele for substituído. Matar o
`prompt()` primeiro faz as fatias 03, 04 e 05 nascerem já no formato final.

A **07** vem por último de propósito: o teste de aceite só é honesto quando existe o
fluxo inteiro para exercitar.

---

## 3. Invariantes que nenhuma fatia pode quebrar

Valem para toda fatia. O revisor verifica os cinco em cada entrega.

1. **O renderer não acessa banco, filesystem, hardware ou fiscal direto.** Só `window.api`,
   cujo contrato é `shared/ipc.ts`. Canal novo entra no contrato primeiro.
2. **`npm run check:offline` retorna zero.** Nada de firebase, analytics ou telemetria.
3. **Toda a lógica fiscal fala com a interface `FiscalProvider`** — nunca com uma
   implementação concreta.
4. **Dinheiro é inteiro em centavos.** Nada de float em valor monetário. Quantidade de
   produto pesável é fracionária e usa `double precision`.
5. **Finalização de venda é uma transação só** (invariante 1 do PRD original), e a
   numeração fiscal é sequencial sem reuso (invariante 2).

---

## 4. Portões de verificação

Toda fatia só é considerada pronta com os quatro passando. O comando `/fatia` roda os
quatro automaticamente antes de chamar o revisor.

```bash
npm run typecheck       # tsc --noEmit, projeto inteiro
npm test                # vitest, suíte completa
npm run check:offline   # RNF-06
npx vite build          # o alvo desktop ainda compila
```

Regressão é bloqueio: uma fatia que quebra teste de outra volta para o executor.

---

## 5. Como executar uma fatia

O harness está em `.claude/`:

- **`/fatia <n>`** — lê o PRD da fatia, delega ao executor certo, roda os portões e chama
  o revisor. Volta ao executor se o revisor achar bloqueio.
- **`/checar`** — só os portões, sem escrever código.
- Agentes: `pdv-caixa` (renderer), `pdv-main` (processo main) e `pdv-revisor`.

Detalhe de cada um em [`.claude/README.md`](../../.claude/README.md).
