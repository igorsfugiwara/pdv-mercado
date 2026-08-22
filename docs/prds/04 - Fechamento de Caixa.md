# Fechamento de Caixa

**PDV Mercado · Fatia 04**

| | |
|---|---|
| **Objetivo** | Fechar o ciclo do turno: conferência cega, apuração de diferença e comprovante. |
| **RFs tocados** | RF-11 · RF-12 · RF-13 |
| **Depende de** | 02 |

---

## 1. Problema

Hoje o turno **começa e não termina**. `AberturaCaixa.tsx` abre o caixa; `caixaRepo.fechar()`
calcula a diferença corretamente e está testado (`tests/caixa-repo.test.ts`);
`caixaStore.fechar()` (`src/store/caixaStore.ts:20`) faz a ponte. **Nenhuma tela chama.**

Sem fechamento não existe conferência de gaveta, não existe apuração de quebra, e o
operador seguinte herda um caixa aberto de outro turno — o que também deixa o
`saldoEsperado` sem significado.

## 2. Escopo

### 2.1 Conferência cega (RF-11)

O ponto inegociável: **o operador informa o que contou antes de ver o que o sistema
esperava**. Se o valor esperado aparece primeiro, a conferência não vale nada — a pessoa
digita o que está na tela.

Fluxo:

1. Menu ou `Ctrl+F` na `CaixaScreen` → tela de fechamento.
2. Resumo **sem valores de dinheiro**: quantidade de vendas, período do turno, operador.
3. Campo de contagem: o operador informa o total contado na gaveta.
   Opcionalmente, contagem por denominação (2 × R$ 50, 3 × R$ 20…) com soma automática —
   é o que a pessoa faz na prática, e reduz erro de digitação.
4. Só depois de confirmar: revelação do esperado, do contado e da **diferença**, com
   sobra e falta visualmente distintas.
5. Diferença acima de um limite configurável (`caixa.diferenca.limite`, padrão `1000` =
   R$ 10,00) exige **motivo obrigatório** e PIN de supervisor.

### 2.2 Composição do esperado

`caixaRepo.saldoEsperado()` já calcula: abertura + suprimentos − sangrias + dinheiro
recebido − troco. A tela mostra essa conta **aberta**, linha a linha, porque "esperado
R$ 843,20" sem decomposição não ajuda ninguém a achar o erro.

Vendas em cartão, PIX e voucher aparecem em bloco separado, marcadas como **não conferíveis
em gaveta** — elas entram no relatório do turno, não na contagem física.

### 2.3 Relatório de fechamento (RF-13)

Estrutura de dados `RelatorioFechamento` em `shared/types.ts`, montada por um método novo
`caixa.relatorioFechamento(caixaId)` no contrato:

- Cabeçalho: loja, caixa, operador de abertura e de fechamento, abertura e fechamento.
- Totais por forma de pagamento, com quantidade de vendas.
- Movimentações: sangrias e suprimentos, com motivo e autorizador.
- Conferência: esperado, contado, diferença.
- Documentos fiscais do turno por status.

Renderização em tela, com **impressão via ESC/POS quando houver impressora** — e, quando
não houver, sem erro: a tela é o comprovante. A montagem do relatório é função pura,
testável sem impressora (mesmo padrão do `montarDanfeNfce` já existente).

### 2.4 Bloqueios

- Não fecha caixa com **venda em espera** pendente: lista as vendas e exige resolver.
  Fechar por cima delas perde carrinho de cliente.
- Não fecha com **rascunho** de venda em andamento.
- Caixa fechado bloqueia a tela de venda até nova abertura, com mensagem clara.
- Perfil Operador fecha **o próprio** caixa; Supervisor+ fecha qualquer um.

## 3. Fora de escopo

Sangria e suprimento continuam onde estão (F9). Relatório em PDF é RF-25, fatia futura.
Impressão física de verdade depende de hardware — aqui basta o caminho ESC/POS existir e
degradar limpo.

## 4. Critério de aceite

1. Abrir caixa com R$ 100,00 → 3 vendas em dinheiro → sangria de R$ 50,00 → fechar.
2. O esperado **não aparece** em nenhum momento antes de o contado ser confirmado.
3. Informar contado igual ao esperado → diferença R$ 0,00, fecha sem pedir motivo.
4. Informar R$ 20,00 a menos → diferença negativa destacada, motivo e PIN exigidos.
5. Contagem por denominação soma corretamente e preenche o contado.
6. Com venda em espera, o fechamento é bloqueado com a lista.
7. Após fechar, a tela de venda fica bloqueada até nova abertura.
8. Sem impressora configurada, o fechamento conclui e mostra o relatório em tela.

## 5. Testes

| Teste | Verifica |
|---|---|
| `saldoEsperado` com abertura + vendas + sangria + suprimento | 2.2 (já existe; estender) |
| troco em dinheiro é descontado do esperado | 2.2 — o erro clássico |
| venda em cartão **não** entra no esperado da gaveta | 2.2 |
| diferença = contado − esperado, com sinal | 2.1 |
| diferença acima do limite exige motivo | 2.1 |
| `montarRelatorioFechamento` é pura e bate os totais por forma | 2.3 |
| fechar com venda em espera é bloqueado | 2.4 |
| fechar sem impressora não lança | 2.3 |
| operador não fecha caixa de outro operador | 2.4 |

## 6. Notas de implementação

`caixaRepo.fechar()` já grava o movimento de fechamento com
`motivo: "esperado=X contado=Y"`. Isso é bom para auditoria, mas frágil como fonte de
dado — o relatório deve recalcular a partir dos movimentos e das vendas, não fazer parse
dessa string.

A conferência cega é requisito de **fluxo**, não de layout: o valor esperado não pode
sequer chegar ao renderer antes da confirmação. Buscar o esperado depois do POST da
contagem, e não escondê-lo com CSS.
