# Relógio e Integridade Temporal

**PDV Mercado · Fatia 09**

| | |
|---|---|
| **Objetivo** | O PDV percebe quando o relógio da máquina está errado, antes de a SEFAZ recusar a nota. |
| **RFs tocados** | RF-26 · RF-27 · RNF-05 |
| **Depende de** | 06 (painel para exibir o alerta) |

---

## 1. Problema

Todo registro do sistema usa `new Date()` da máquina local: emissão fiscal,
abertura e fechamento de caixa, auditoria, backup. **Nada confere se esse relógio
está certo.**

Num PDV isso não é hipótese remota:

- Bateria da placa-mãe acabando é o defeito mais comum em máquina de caixa
  antiga. O relógio volta para 2010 a cada desligamento.
- **A SEFAZ recusa NFC-e com data-hora fora de uma janela de tolerância.** Uma
  loja com relógio adiantado passa o dia emitindo e acumulando rejeição.
- Pior que rejeitar: se o relógio estiver errado **para trás** dentro da
  tolerância, a nota é autorizada com hora errada e ninguém percebe.
- Relógio que anda para trás quebra a ordenação de auditoria (RF-21), que é
  append-only mas ordenada por `criadoEm`.

O sistema é offline-first, então não dá para simplesmente exigir NTP. Mas dá para
**detectar** e avisar.

## 2. Escopo

### 2.1 Referência de tempo confiável

Três fontes, em ordem de confiança, todas opcionais:

| Fonte | Quando | Custo |
|---|---|---|
| Resposta da SEFAZ (`statusServico`) | quando há rede | zero — a consulta já acontece |
| Cabeçalho `Date` de uma requisição HTTP | quando há rede | baixo |
| Monotonicidade local | sempre | zero |

A primeira é a melhor: é literalmente o relógio contra o qual a nota será
validada. As duas primeiras exigem rede; a terceira não, e é a que pega o caso
clássico.

### 2.2 Detecção monotônica — funciona offline

Grava em `configuracoes` o maior instante já observado (`relogio.ultimoVisto`),
atualizado no boot e a cada venda.

Se o relógio atual for **menor** que o último visto por mais que uma folga
(`relogio.tolerancia.segundos`, padrão 120), o relógio andou para trás: ou a
bateria morreu, ou alguém mexeu. Nenhum dos dois é normal.

Isto funciona **sem rede nenhuma**, que é a condição real da loja.

### 2.3 Sinalização

- **Painel (fatia 06)**: alerta de gravidade **alta** — está na mesma classe de
  contingência, porque também tem consequência fiscal.
- **Antes de abrir o caixa**: se o desvio passar de `relogio.bloqueio.minutos`
  (padrão 60), avisa em diálogo e **exige confirmação consciente** para seguir.
  Não bloqueia: uma loja que não pode vender perde mais do que uma nota com hora
  torta. Mas ninguém segue sem saber.
- **Configurações**: mostra o desvio medido, a fonte e o horário da última
  verificação.

### 2.4 Registro

Desvio detectado vira auditoria `relogio_desvio` com o valor em segundos, a
fonte e o instante. É o que permite explicar depois por que uma nota saiu com
hora estranha.

## 3. Fora de escopo

Corrigir o relógio. Ajustar o relógio do sistema exige privilégio administrativo,
é específico de cada SO, e um PDV mexendo na hora da máquina é mais perigoso do
que o problema que resolve. O sistema **detecta e avisa**; corrigir é do técnico.

## 4. Critério de aceite

1. Relógio normal: nenhum alerta, e `relogio.ultimoVisto` avança.
2. Relógio movido 10 min para trás: alerta no painel, gravidade alta.
3. Movido 2 h para trás: abertura de caixa pede confirmação consciente.
4. Dentro da tolerância de 120 s: silêncio — senão o alerta vira ruído.
5. Com a SEFAZ acessível, o desvio é medido contra a resposta dela.
6. Sem rede, a detecção monotônica continua funcionando.
7. Todo desvio detectado está em auditoria.

## 5. Testes

| Teste | Verifica |
|---|---|
| desvio abaixo da tolerância não alerta | 2.2 — evita ruído |
| desvio de 10 min para trás alerta | 2.2 |
| relógio avançando normalmente atualiza o último visto | 2.2 |
| desvio acima do bloqueio exige confirmação | 2.3 |
| a comparação usa segundos, não milissegundos | 2.2 — precisão irrelevante aqui |
| desvio gera auditoria com fonte e valor | 2.4 |
| sem `relogio.ultimoVisto` gravado, primeiro boot não alerta | 2.2 — estado inicial |

## 6. Notas de implementação

A lógica de comparação vai para `shared/relogio.ts`, pura: recebe o instante
atual, o último visto e as tolerâncias, devolve o veredito. Os dois alvos usam.

Cuidado com fuso: comparar sempre em epoch (número), nunca em string ISO. A
fatia 06 já teve um bug exatamente disso.
