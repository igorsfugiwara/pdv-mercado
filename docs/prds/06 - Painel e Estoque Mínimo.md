# Painel e Estoque Mínimo

**PDV Mercado · Fatia 06**

| | |
|---|---|
| **Objetivo** | Uma tela inicial que responde "como está a loja agora" e mostra o que exige ação. |
| **RFs tocados** | RF-18 · RF-22 (resumo) · RF-24 (resumo) |
| **Depende de** | 04 |

---

## 1. Problema

Não existe tela inicial. `App.tsx` manda qualquer rota desconhecida para `/caixa`, e o
gerente que abre o sistema cai direto na frente de caixa.

`estoque.alertasMinimo()` está implementado, testado e exposto no contrato — a
`EstoqueScreen` o consome numa lista secundária, onde só aparece para quem já foi procurar.
RF-18 pede alerta **no dashboard**, e o dashboard não existe. Na prática, o produto acaba
na gôndola sem ninguém ser avisado.

Mesma coisa do lado fiscal: documentos em contingência pendente só aparecem se alguém
abrir a `FiscalScreen`. Contingência que ninguém reprocessa vira problema fiscal com prazo.

## 2. Escopo

### 2.1 Tela inicial

Nova `src/screens/PainelScreen.tsx`, rota `/painel`, virando o destino padrão para perfis
**Supervisor e Admin**. Operador continua caindo em `/caixa` — ele abre o sistema para
trabalhar no caixa, não para ler indicador.

### 2.2 Blocos

Ordem por urgência, não por bonito. O que exige ação vem primeiro.

**Ações pendentes** — some quando não há nada, em vez de mostrar "0":

| Alerta | Origem | Gravidade |
|---|---|---|
| Documentos em contingência pendente | `fiscal.filaContingencia()` | alta — tem prazo |
| Documentos rejeitados sem correção | `fiscal.listarDocumentos('rejeitada')` | alta |
| Produtos abaixo do estoque mínimo | `estoque.alertasMinimo()` | média |
| Produtos inativos por falta de campo fiscal | `produtos.listar(true)` filtrado | média |
| Caixa aberto há mais de 12 h | `caixa.atual()` | média — turno esquecido |
| Vendas em espera não resolvidas | `vendas.recuperarEspera()` | baixa |

Cada alerta é **clicável e leva à tela onde se resolve**, com o filtro já aplicado. Alerta
que não leva à ação é ruído.

**Turno atual** — só quando há caixa aberto: operador, aberto desde, vendas no turno,
total, ticket médio, esperado em gaveta.

**Dia** — vendas de hoje, faturamento, ticket médio, formas de pagamento, comparação com
a média dos 7 dias anteriores. Reaproveita `relatorios.vendas()` com filtro de hoje; sem
consulta nova.

### 2.3 Estoque mínimo com utilidade

A lista mostra descrição, saldo, mínimo e **quantos dias de venda restam** — estimado pela
média diária dos últimos 30 dias. "Arroz: 8 unidades" não diz nada; "Arroz: 8 unidades,
~2 dias" diz quando comprar.

Requer agregação nova no `relatoriosRepo`: média de venda diária por produto num período.
Produto sem venda no período não estima — mostra "sem histórico", não divide por zero.

### 2.4 Atualização

Recarrega ao ganhar foco e a cada 60 s enquanto visível. Sem polling com a janela em
segundo plano — é PDV local, não painel de parede.

## 3. Fora de escopo

Gráfico e série temporal. Este painel é operacional, não analítico — relatório é a
`RelatoriosScreen`, que já existe e já tem curva ABC. Nada de biblioteca de chart nesta
fatia.

## 4. Critério de aceite

1. Login como `admin` cai em `/painel`; como `caixa`, em `/caixa`.
2. Com produto abaixo do mínimo, o alerta aparece e o clique abre estoque já filtrado.
3. Sem nenhuma pendência, o bloco de ações some — não mostra lista vazia.
4. Com caixa aberto, o bloco do turno bate com o esperado do fechamento (fatia 04).
5. Documento em contingência aparece com gravidade alta e leva à tela fiscal.
6. Produto sem histórico de venda mostra "sem histórico", sem erro de divisão.
7. Painel carrega em menos de 500 ms com 5 000 produtos e 10 000 vendas.

## 5. Testes

| Teste | Verifica |
|---|---|
| média diária ignora produto sem venda no período | 2.3 — divisão por zero |
| dias restantes = saldo ÷ média diária, arredondado para baixo | 2.3 |
| alerta some quando a origem está vazia | 2.2 |
| caixa aberto há mais de 12 h dispara alerta | 2.2 |
| ticket médio do turno = total ÷ vendas, em centavos | 2.2 |
| operador é roteado para `/caixa`, admin para `/painel` | 2.1 |
| agregação de média diária com 10 000 vendas < 200 ms | 4.7 |

## 6. Notas de implementação

Todos os dados vêm de canais que já existem, menos a média diária. Resista a criar canal
novo por bloco: o painel faz 4–5 chamadas no carregamento, não 15.

O alerta de "produto inativo por falta de campo fiscal" usa `faltamCamposFiscais()` que já
está em `server/repos/produtos.repo.ts` e no equivalente do Electron — a mesma função,
exportada, sem reimplementar a regra no renderer.
