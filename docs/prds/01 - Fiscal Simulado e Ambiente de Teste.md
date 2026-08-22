# Fiscal Simulado e Ambiente de Teste

**PDV Mercado · Fatia 01**

| | |
|---|---|
| **Objetivo** | O app sobe, vende e fecha o turno numa máquina limpa — sem ACBrLib, sem certificado A1, sem impressora, sem balança. |
| **RFs tocados** | RF-26 (parcial, simulado) · RF-30 · seção 7.2 do PRD |
| **Depende de** | — |
| **Destrava** | Todas as outras fatias |

---

## 1. Problema

`electron/fiscal/index.ts:13` instancia `AcbrNfceProvider` incondicionalmente e chama
`inicializar()` no boot. Numa máquina sem a biblioteca nativa e sem certificado, isso
falha — e o módulo fiscal não sobe. Como `vendaService.finalizarVenda()` chama
`getFiscalProvider()` sempre que a venda pede NFC-e, **não existe hoje um caminho para
testar o operacional inteiro fora de uma máquina fiscalmente configurada**.

Existe um `FakeFiscalProvider` em `tests/support/fakeFiscal.ts`, mas ele vive nos testes
e entra por `_setFiscalParaTestes()`, explicitamente marcado como "não usar em produção".

O que falta não é a implementação — é a **escolha do provider virar configuração**.

## 2. Escopo

### 2.1 Provider simulado de primeira classe

Criar `electron/fiscal/SimuladoProvider.ts`, implementando `FiscalProvider`, promovido de
código de teste a código de aplicação:

- `emitir()` devolve `autorizada` com **chave de acesso estruturalmente válida** — layout
  NFC-e (cUF, AAMM, CNPJ, mod 65, série, nNF, tpEmis, cNF) e dígito verificador módulo 11
  real. Já existe uma implementação correta disso em `server/fiscal.web.ts:montarChave` —
  extraia para `shared/` e use nos dois lados em vez de duplicar.
- `statusServico()` devolve online, ambiente `homologacao`, com mensagem que **diz que é
  simulação**.
- `validarCertificado()` devolve `{ valido: false, expiraEm: null }` — não minta dizendo
  que existe certificado.
- `cancelar()` e `inutilizar()` respondem sucesso e registram em auditoria.
- Latência artificial configurável (padrão 0 ms) para exercitar a UI de espera.
- Modo de falha injetável por configuração: `fiscal.simulado.falha` ∈
  `nenhuma | timeout | rejeicao`. É assim que se testa contingência e rejeição sem
  derrubar rede de verdade.

### 2.2 Seleção por configuração

`initFiscal()` passa a ler `fiscal.provider` ∈ `simulado | acbr`, **com `simulado` como
padrão** enquanto a emissão real não for homologada.

Falha ao inicializar o `acbr` **não pode derrubar o app**: registra o erro, cai para
`simulado` e marca a condição para a UI mostrar. Um PDV que não abre porque o certificado
venceu é pior do que um que abre avisando.

### 2.3 Sinalização honesta na UI

O operador precisa saber, sem ambiguidade, que os documentos não valem fiscalmente:

- Faixa persistente na `FiscalScreen` quando o provider é `simulado`.
- Indicador no rodapé da `CaixaScreen` — discreto, sempre visível.
- `ConfigScreen → Fiscal` mostra qual provider está ativo e permite trocar (perfil Admin).

Texto sugerido: **"Modo simulado — documentos sem valor fiscal."** Direto, sem eufemismo.

### 2.4 Periféricos ausentes não podem quebrar a venda

Auditar todo caminho de venda que toca hardware e garantir degradação limpa:

- Gaveta indisponível: já é best-effort em `vendaService.ts:31`. Confirmar com teste.
- Impressora ausente: a falha de DANFE **não pode** desfazer a venda. Hoje há `.catch()`,
  mas não há teste cobrindo. Adicionar.
- Balança ausente: o caixa já cai para peso manual. Manter, e cobrir com teste.

## 3. Fora de escopo

Emissão real, certificado, CSC, homologação SEFAZ, impressão física. Nada de tocar em
`AcbrNfceProvider` além do necessário para ele deixar de ser o padrão.

## 4. Critério de aceite

Numa máquina sem ACBrLib, sem certificado e sem periférico:

1. `npm run dev` sobe o app sem erro no console do main.
2. Login com `caixa/caixa123` → abertura de caixa → bipar `7891000100103` → F10 →
   dinheiro → venda finaliza e a NFC-e aparece **autorizada**.
3. A chave de acesso tem 44 dígitos e o DV confere pelo módulo 11.
4. A tela mostra em algum lugar visível que o modo é simulado.
5. Com `fiscal.simulado.falha = timeout`, a mesma venda finaliza e o documento fica
   `contingencia_pendente` — e a venda **existe** no banco.
6. Com `fiscal.simulado.falha = rejeicao`, documento fica `rejeitada` com motivo, e a
   venda continua existindo.

## 5. Testes

| Teste | Verifica |
|---|---|
| `SimuladoProvider.emitir` devolve chave com DV mód-11 correto | 2.1 — a chave não é string aleatória |
| chave respeita o layout posicional da NFC-e | 2.1 |
| `initFiscal` sem config usa `simulado` | 2.2 — padrão seguro |
| `initFiscal` com `acbr` quebrado cai para `simulado` sem lançar | 2.2 — app não morre |
| `validarCertificado` do simulado devolve `valido: false` | 2.3 — não mente |
| venda com `falha: timeout` → doc `contingencia_pendente` e venda persistida | 2.1 + invariante 1 |
| venda com `falha: rejeicao` → doc `rejeitada` e venda persistida | idem |
| falha de impressão de DANFE não desfaz a venda | 2.4 |

## 6. Notas de implementação

O `FakeFiscalProvider` dos testes continua existindo e não deve ser deletado — ele tem
controle fino (`proximaEmissao`, `lancarNaEmissao`) que os testes usam. O `SimuladoProvider`
é outra coisa: é para o **operador** rodar, não para o teste controlar.

Ao extrair `montarChave` para `shared/`, `server/fiscal.web.ts` passa a importar de lá.
Um só gerador de chave no repositório.
