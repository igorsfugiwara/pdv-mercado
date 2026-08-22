# Aceite Ponta a Ponta

**PDV Mercado · Fatia 07**

| | |
|---|---|
| **Objetivo** | Transformar o critério 9.4 do PRD original em teste automatizado que roda a cada mudança. |
| **RFs tocados** | verificação de RF-01 a RF-21 |
| **Depende de** | 03, 04, 05 |

---

## 1. Problema

O PRD original define o aceite final (seção 9.4):

> Operador sem treinamento técnico executa, apenas com teclado e leitor: abertura de caixa
> → venda de 20 itens (incluindo pesável) → pagamento em 2 formas → NFC-e autorizada e
> DANFE impresso → sangria → fechamento com conferência cega.

Hoje isso só é verificável por alguém sentado na máquina. `@playwright/test` está no
`package.json` e existe o script `test:e2e`, mas **não há nenhum arquivo de teste E2E** —
o comando roda no vazio.

O risco concreto: as fatias 02 a 06 mexem em teclado, foco e fluxo do caixa. São
exatamente as mudanças que quebram em conjunto sem quebrar teste unitário nenhum.

## 2. Escopo

### 2.1 Infraestrutura

`playwright.config.ts` com o launcher do Electron (`_electron.launch`), banco temporário
por execução (`PDV_DATA_DIR` apontando para diretório descartável), provider fiscal
`simulado` (fatia 01) e seed determinístico.

Nada de reaproveitar o banco de desenvolvimento: teste que depende de estado prévio passa
na máquina de quem escreveu e falha no CI.

### 2.2 O roteiro de aceite

Um teste que percorre o fluxo inteiro **só por teclado** — nada de `page.click()` no
caminho principal. Se um passo precisar de mouse, o requisito de operação por teclado está
quebrado e o teste tem que acusar.

1. Login `caixa` / `caixa123`.
2. Abertura de caixa com fundo de R$ 100,00.
3. **20 itens**: 15 por bipe de EAN, 3 por multiplicador (`3 *`), 2 pesáveis — um por
   diálogo de peso, outro por **etiqueta de balança** (fatia 05).
4. Desconto dentro do limite do operador.
5. CPF na nota, com dígito válido.
6. Cancelamento de um item do meio, com PIN de supervisor (fatia 03).
7. `F10` → pagamento em **duas formas**: parte dinheiro, parte cartão. Confere o troco.
8. NFC-e autorizada (simulada), chave de 44 dígitos com DV válido.
9. `F9` sangria com autorização.
10. Fechamento com **conferência cega** (fatia 04): informa contado, revela diferença.
11. Confere que o esperado bate com abertura + dinheiro − troco − sangria.

### 2.3 Roteiros de resiliência

Da seção 9.2 do PRD, os que dá para automatizar sem hardware:

| Roteiro | Verifica |
|---|---|
| Mata o processo no meio da venda, reabre | rascunho recuperado com os mesmos itens (invariante 4) |
| Impressora ausente na finalização | venda finaliza, documento gravado, sem travar |
| Provider fiscal em `timeout` | venda persiste, documento em contingência |
| Provider fiscal em `rejeicao` | venda persiste, documento rejeitado com motivo |
| Fecha caixa com venda em espera | bloqueado com a lista |

Disco cheio, papel acabando e balança desconectada continuam manuais — ficam em
`docs/TESTES_HARDWARE.md`.

### 2.4 CI

Workflow do GitHub Actions rodando em `push` e `pull_request`:

```
typecheck → test (vitest) → check:offline → build → e2e (xvfb)
```

E2E de Electron precisa de display virtual no Linux: `xvfb-run`. Artefato de trace e vídeo
só nos que falharem — trace de execução verde é lixo que enche o storage.

## 3. Fora de escopo

E2E da versão web. Teste de carga (500 vendas da fase 5). Homologação fiscal real — sem
certificado não há o que homologar.

## 4. Critério de aceite

1. `npm run test:e2e` passa numa máquina limpa, sem configuração manual.
2. O roteiro de aceite roda **sem nenhum `page.click()`** no caminho principal.
3. Cada execução começa de banco vazio e não deixa resíduo.
4. Os 5 roteiros de resiliência passam.
5. O CI roda os 5 estágios e falha o PR quando qualquer um falha.
6. Execução completa em menos de 5 minutos.

## 5. Testes

O entregável **é** o teste. O que precisa de verificação própria é a infraestrutura:

| Verificação | Por quê |
|---|---|
| helper de seed produz o mesmo estado toda vez | teste instável é pior que teste ausente |
| `PDV_DATA_DIR` é respeitado e limpo ao fim | não pode tocar no banco de desenvolvimento |
| dois `npm run test:e2e` seguidos passam | prova que não há estado vazando |

## 6. Notas de implementação

O bipe do leitor é digitação rápida seguida de Enter. Simule com
`page.keyboard.type(ean, { delay: 5 })` + `Enter` — `fill()` não exercita o caminho de
captura por velocidade que a `CaixaScreen` implementa (RF-01), e é justamente esse caminho
que precisa de cobertura.

Para matar o processo no roteiro de resiliência, use `electronApp.close()` sem finalizar a
venda e reabra apontando para o mesmo `PDV_DATA_DIR` — é o que reproduz a queda de energia
de verdade, com o WAL do SQLite no estado real.
