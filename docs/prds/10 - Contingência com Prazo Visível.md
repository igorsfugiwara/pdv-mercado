# Contingência com Prazo Visível

**PDV Mercado · Fatia 10**

| | |
|---|---|
| **Objetivo** | Documento parado em contingência escala com o tempo, em vez de envelhecer em silêncio. |
| **RFs tocados** | RF-27 · RF-30 · RF-18 |
| **Depende de** | 06 (painel) |

---

## 1. Problema

A fila de contingência funciona: reprocessa sozinha, com backoff exponencial a
partir de 2 minutos, e trata autorização, rejeição e falha. Está testada.

O que falta é **consequência**. Hoje:

- O painel (fatia 06) mostra "N documentos em contingência" — o mesmo texto
  para um documento de 3 minutos e para um de 3 dias.
- **Contingência tem prazo legal.** NFC-e emitida offline (tpEmis=9) precisa ser
  transmitida em até **24 horas**. Depois disso não é mais um aviso amarelo: é
  problema fiscal com multa.
- Quando a fila desiste (backoff no teto), nada sobe. O documento fica parado e
  o sistema segue quieto.
- O operador não tem como saber **por que** um documento não passou: a mensagem
  de erro da SEFAZ fica só no log do main.

## 2. Escopo

### 2.1 Idade e escalonamento

Cada documento em contingência ganha uma classificação por idade, calculada
sobre `emitidaEm`:

| Idade | Classe | Onde aparece |
|---|---|---|
| < 1 h | normal | painel, gravidade média |
| 1 h – 12 h | atenção | painel, gravidade alta |
| 12 h – 24 h | urgente | painel no topo + faixa persistente no caixa |
| > 24 h | **vencido** | faixa vermelha no caixa, não dispensável |

O prazo é configurável (`fiscal.contingencia.prazoHoras`, padrão 24), porque a
regra pode mudar e ninguém vai recompilar o PDV por causa disso.

### 2.2 Motivo do erro visível

A fila passa a gravar a **última falha** de cada documento: mensagem, horário e
número de tentativas. Hoje isso só existe no log.

Campo novo em `documentos_fiscais`: `ultimoErro` e `tentativas`. O monitor fiscal
mostra os dois, e o painel mostra o motivo do mais antigo — "SEFAZ indisponível"
e "rejeitado por chave duplicada" pedem ações completamente diferentes.

### 2.3 Fila que não desiste em silêncio

Quando o backoff chega ao teto, a fila hoje continua tentando no intervalo
máximo, sem dizer nada. Passa a emitir um alerta (o mesmo canal `fiscal:alerta`
que já existe) na primeira vez que atinge o teto, e a marcar o documento como
`travado` para o painel.

### 2.4 Ação manual

O monitor fiscal já tem "reprocessar fila". Ganha:

- **Reprocessar um documento específico**, em vez de a fila inteira.
- Mostrar o resultado da tentativa na hora, com o motivo em caso de falha — não
  um "processados: 0" que não explica nada.

## 3. Fora de escopo

Inutilização automática de numeração. Contingência por formulário de segurança
(FS-DA). Ambos exigem decisão fiscal humana.

## 4. Critério de aceite

1. Documento com 30 min em contingência: gravidade média no painel.
2. Com 13 h: aparece no topo e o caixa mostra faixa persistente.
3. Com 25 h: faixa vermelha não dispensável no caixa.
4. A idade é calculada sobre `emitidaEm`, não sobre a hora da última tentativa.
5. Falha de transmissão grava motivo e incrementa tentativas.
6. O monitor fiscal mostra o motivo e permite reprocessar um documento só.
7. Reprocessar com sucesso limpa o erro e tira do painel.
8. Prazo configurável muda a classificação sem recompilar.

## 5. Testes

| Teste | Verifica |
|---|---|
| classificação por idade nas quatro faixas | 2.1 |
| bordas exatas (1 h, 12 h, 24 h) caem na faixa de cima | 2.1 — a borda que sempre erra |
| idade usa `emitidaEm`, não a última tentativa | 4.4 |
| falha grava `ultimoErro` e incrementa `tentativas` | 2.2 |
| sucesso limpa `ultimoErro` | 4.7 |
| prazo configurado a 1 h muda a classificação | 4.8 |
| documento sem `emitidaEm` não quebra a classificação | robustez |

## 6. Notas de implementação

A classificação é pura: `shared/contingencia.ts`, recebendo `emitidaEm`, o agora
e o prazo. Os dois alvos e o painel usam a mesma.

Os campos novos exigem migração. Migração numerada, idempotente, como as 23
anteriores — e com teste, como as anteriores.

A faixa no caixa reaproveita `AvisoFiscalSimulado`: já existe o padrão de faixa
persistente ali, não é para inventar outro.
