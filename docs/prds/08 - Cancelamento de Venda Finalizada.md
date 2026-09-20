# Cancelamento de Venda Finalizada

**PDV Mercado · Fatia 08**

| | |
|---|---|
| **Objetivo** | O operador encontra uma venda já finalizada, cancela com autorização, e a NFC-e é cancelada junto. |
| **RFs tocados** | RF-09 · RF-16 · RF-21 · RF-28 |
| **Depende de** | 03 (autorização), 07 (E2E para cobrir o fluxo) |

---

## 1. Problema

`vendasRepo.cancelar()` existe, é transacional, estorna estoque com guarda de
idempotência e está coberto por teste. O handler está registrado, o canal está no
contrato, o adapter web implementa. **Nenhuma tela chama.**

É o mesmo padrão que já rendeu quatro correções nesta rodada: a regra difícil
pronta, o fio desligado. E é operação diária — cliente desiste depois de fechar a
conta, operador digita a quantidade errada e só percebe no fim.

Pior: **não há como listar vendas individuais**. `relatorios.vendas()` devolve
agregados; para cancelar a venda #47 é preciso saber que ela existe. Hoje não há
caminho nenhum até ela.

E há um buraco fiscal: `vendasRepo.cancelar()` muda o status da venda e estorna
estoque, mas **não toca no documento fiscal**. Uma venda cancelada continua com
NFC-e `autorizada` na SEFAZ — o que é divergência fiscal, não detalhe de tela.

## 2. Escopo

### 2.1 Listar vendas do período

Canal novo: `vendas.listar(filtro)` devolvendo venda, operador, quantidade de
itens, forma de pagamento e status do documento fiscal. Filtro por período,
operador e status.

Sem este canal não existe fatia: cancelar exige achar.

### 2.2 Tela de vendas

Nova `VendasScreen` em `/vendas`, perfis Supervisor e Admin. Lista do dia por
padrão, com busca por número. Cada linha mostra hora, operador, total, formas de
pagamento e o status fiscal — e a venda cancelada aparece riscada, não some:
auditoria é histórico, não faxina.

### 2.3 O cancelamento

Exige, nesta ordem:

1. **Justificativa** com no mínimo **15 caracteres** — é o mínimo que a SEFAZ
   aceita no evento de cancelamento, e não faz sentido a UI aceitar menos do que
   o fisco.
2. **PIN de supervisor** (mesma infraestrutura da fatia 03).
3. Confirmação destrutiva com o total da venda.

Então, na ordem:

- `vendasRepo.cancelar()` — estorna estoque, marca a venda (já existe)
- **`fiscal.cancelarNfce(chave, justificativa)`** quando o documento estiver
  `autorizada` — é o passo que falta hoje
- auditoria com `vendaId`, total, justificativa e `autorizadoPorId`

### 2.4 Quando a NFC-e não pode ser cancelada

O cancelamento de NFC-e tem **prazo legal** (SP: 30 minutos da autorização).
Passado o prazo, o caminho é outro — nota de entrada ou ajuste contábil — e o
sistema não pode fingir que cancelou.

Regra: fora do prazo, a UI **avisa antes** e oferece cancelar só a venda
(estoque e caixa), deixando o documento como está, com o motivo registrado em
auditoria. Mentir para o operador aqui vira problema fiscal meses depois.

A janela é configurável (`fiscal.cancelamento.minutos`, padrão 30).

### 2.5 Falha no cancelamento fiscal

A SEFAZ pode recusar ou estar fora. A venda **já foi cancelada** no banco — e
isso está certo, porque o estoque precisa voltar. O documento fica marcado para
nova tentativa e aparece no painel (fatia 06) como pendência de gravidade alta.

Nunca desfazer o cancelamento da venda porque o fisco não respondeu.

## 3. Fora de escopo

Devolução parcial (cancelar item de venda finalizada) — é outro fluxo, com outro
documento fiscal. Estorno de pagamento em cartão: o PDV não fala com a adquirente.

## 4. Critério de aceite

1. `/vendas` lista as vendas do dia, mais recente primeiro.
2. Cancelar exige justificativa ≥ 15 caracteres; 14 é recusado com a contagem.
3. PIN de operador comum é recusado; de supervisor, aceito.
4. Após cancelar: venda `cancelada`, estoque estornado, documento `cancelada`.
5. Cancelar duas vezes a mesma venda: a segunda é recusada sem efeito colateral.
6. Venda autorizada há mais de 30 min avisa sobre o prazo e não marca o
   documento como cancelado.
7. Com a SEFAZ em falha, a venda cancela e o documento fica pendente — e aparece
   no painel.
8. Toda ação registra auditoria com autor e autorizador distintos.

## 5. Testes

| Teste | Verifica |
|---|---|
| `vendas.listar` filtra por período e status | 2.1 |
| justificativa com 14 caracteres é recusada | 2.3 — a borda |
| cancelamento estorna estoque exatamente uma vez | 2.3 + idempotência |
| segundo cancelamento é recusado sem alterar estoque | 4.5 |
| dentro do prazo, o documento fiscal vira `cancelada` | 2.3 |
| fora do prazo, o documento **não** é alterado | 2.4 |
| falha da SEFAZ não desfaz o cancelamento da venda | 2.5 |
| auditoria registra justificativa e autorizador | 4.8 |
| E2E: vender → cancelar → conferir estoque de volta | fluxo inteiro |

## 6. Notas de implementação

A janela de prazo é calculada sobre `autorizadaEm` do documento, não sobre
`criadoEm` da venda: o que conta para a SEFAZ é a autorização.

`vendasRepo.cancelar()` não muda — ele já faz a parte transacional certa. O que
entra é a orquestração fiscal **em volta** dele, em `vendaService`, igual ao que
já existe para a finalização.
