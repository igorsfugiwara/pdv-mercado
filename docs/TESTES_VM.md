# O que testar na máquina virtual

Complemento de [`TESTES_HARDWARE.md`](TESTES_HARDWARE.md), que trata do teste **com** o
periférico na mão. Aqui: o que uma VM prova, o que ela prova pela metade, e o que ela não
prova de jeito nenhum — para não descobrir isso no dia da instalação no cliente.

A regra por trás da divisão: a VM é um computador de verdade rodando o sistema de verdade.
Ela falha só onde há **matéria física** (papel, peso, mecanismo) ou **credencial que não
existe ainda** (certificado A1).

---

## 1. Testa por completo na VM

Nada aqui precisa de periférico. É a maior parte do produto.

| Área | O que dá para verificar | Requisitos |
|---|---|---|
| **Frente de caixa** | Lançamento de item, multiplicador, desconto, CPF, venda em espera, cancelamento, atalhos F2–F12 | fatia 01 (fiscal simulado) |
| **Código de barras** | Fluxo completo de bipe — **digitar o EAN e apertar Enter é idêntico a bipar** (ver ressalva em §2) | nenhum |
| **Etiqueta de balança** | Layouts código+peso e código+valor: a etiqueta chega como 13 dígitos digitados, não pela porta serial | fatia 05 |
| **Pagamento e troco** | Múltiplas formas, troco só em dinheiro, pagamento insuficiente | — |
| **Gestão de caixa** | Abertura, sangria, suprimento, **fechamento com conferência cega**, diferença, justificativa por PIN | — |
| **Produtos e estoque** | Cadastro, campos fiscais, importação CSV, entrada, ajuste, estoque mínimo | — |
| **Usuários e auditoria** | Perfis, login, troca por PIN, autorização de supervisor, trilha de auditoria | — |
| **Relatórios** | Vendas por período/forma/operador/produto/grupo, curva ABC, exportação CSV | — |
| **Resiliência de dados** | Queda de energia: **a VM testa isso melhor que a máquina real**, porque dá para dar reset forçado sem risco | — |
| **Instalação limpa (RNF-07)** | `.exe` no Windows e `.AppImage`/`.deb` no Ubuntu, em SO recém-instalado. É exatamente para isso que VM serve. | — |
| **Backup** | Backup automático, retenção, restauração a partir do arquivo | — |

### Queda de energia: use snapshot, não `kill`

Matar o processo testa o WAL do SQLite, mas não testa o cache de escrita do disco. Na VM
dá para fazer o teste honesto:

1. Tire um snapshot com o caixa aberto e uma venda em andamento.
2. **Reset forçado da VM** (não shutdown) no meio da finalização.
3. Suba de novo e confira: a venda em andamento foi recuperada (invariante 4), e nenhuma
   venda ficou pela metade.

Repita com reset durante a baixa de estoque. É o cenário que mais dá medo em PDV e o que
menos se consegue reproduzir em máquina física sem estragar hardware.

---

## 2. Testa pela metade — dá para emular, com ressalva

### Leitor de código de barras

O leitor é **USB HID, ou seja, um teclado**. Duas formas na VM:

- **USB passthrough** (VirtualBox, VMware, QEMU): o leitor aparece como teclado e o teste
  é idêntico ao real.
- **Sem passthrough**: digitar o código e apertar Enter exercita o mesmo caminho.

> **Ressalva atual:** o PRD (RF-01) pede detecção de bipe **por velocidade de digitação**
> além do sufixo Enter. A implementação de hoje reage só ao Enter
> (`CaixaScreen.tsx`, `onKeyDown`). Enquanto for assim, digitar e bipar são de fato
> equivalentes — e a VM prova tudo. Se a detecção por velocidade entrar depois, esse
> caminho passa a exigir o leitor real ou um script que simule a cadência.

### Impressora térmica

Três níveis, do mais fraco ao mais forte:

1. **Sem impressora** — o cupom é montado por função pura (`montarCupomFechamento`,
   `montarDanfeNfce`) e já tem teste automatizado. Prova o conteúdo e a largura da bobina,
   não a impressão.
2. **Impressora de rede** — se houver uma térmica na rede, a VM alcança por
   `tcp://IP:9100`. Isso prova o caminho ESC/POS inteiro, de verdade.
3. **Impressora USB** — exige passthrough do dispositivo para a VM.

Também dá para apontar `impressora.interface` para um arquivo ou socket e inspecionar os
bytes ESC/POS gerados, sem papel nenhum.

### Balança serial

A VM expõe porta serial virtual (`/dev/ttyS0`, `COM1`) ligada a um socket ou pty do host.
Com isso dá para escrever um script que fala o protocolo Toledo/Filizola e responde peso:

```bash
# Cria um par de portas virtuais no host Linux; aponte a VM para uma delas.
socat -d -d pty,raw,echo=0,link=/tmp/balanca-app pty,raw,echo=0,link=/tmp/balanca-sim
# Em outro terminal, responda às solicitações de peso do PDV:
#   printf '\x02 1.500\x03' > /tmp/balanca-sim
```

Isso prova o **parsing e o protocolo** (`parsePeso`, timeout de 2 s, fallback manual).
Não prova a balança.

### Gaveta

Acionada por pulso ESC/POS através da impressora — segue exatamente o que valer para a
impressora acima.

---

## 3. Não testa na VM — precisa da máquina e do periférico

| O que | Por que a VM não resolve |
|---|---|
| **Precisão e calibração da balança** | Peso é matéria física. Estabilização, tara, deriva térmica e a aferição do INMETRO só existem na balança real. |
| **Comportamento da balança sob uso** | Item molhado, item que encosta na borda, operador que apoia a mão no prato. |
| **Qualidade de impressão** | Escurecimento térmico, corte do papel, legibilidade do QR Code depois de amassar no bolso do cliente. |
| **Papel acabando no meio do DANFE** | Precisa da impressora avisando fim de papel de verdade. |
| **Mecânica da gaveta** | Se o pulso tem força para destravar aquela gaveta específica, com aquela mola. |
| **Etiqueta impressa de verdade** | Etiqueta borrada, curvada na embalagem ou com adesivo mal colado — o leitor lê ou não? |
| **Ergonomia e ritmo real** | Se o operador consegue manter a fila andando. Só com gente usando. |
| **Emissão NFC-e real** | Ver §4 — o bloqueio não é a VM. |

---

## 4. Sobre o fiscal: a VM não é o obstáculo

Vale separar, porque é fácil confundir:

- **A VM roda NFC-e sem problema.** A ACBrLib é uma biblioteca nativa e a SEFAZ é um web
  service HTTPS — nada disso se importa com virtualização. Homologação inteira, incluindo
  contingência e retransmissão, roda numa VM.
- **O que falta é credencial**, não máquina: certificado e-CNPJ A1, credenciamento NFC-e no
  portal da SEFAZ-SP, e CSC + IdToken. Ver o checklist de onboarding na seção 7.4 do
  [PRD original](PRD-PDV-Supermercado.md).

Enquanto isso não existe, a fatia 01 entrega um `FiscalProvider` simulado que percorre o
mesmo fluxo — autorizada, contingência e rejeição — com chave de acesso estruturalmente
válida e **sem valor fiscal**. Dá para testar toda a lógica de venda, contingência e
monitor fiscal sem nunca falar com a SEFAZ.

---

## 5. Roteiro sugerido para a primeira VM

Ordem que descobre problema cedo:

1. **Instalação limpa** — Windows 10/11 e Ubuntu 22.04/24.04 recém-instalados. Instale
   pelo `.exe` e pelo `.AppImage`. Confirme que o app sobe sem ACBrLib e sem certificado
   (fatia 01).
2. **Seed e login** — `admin/admin123`, `caixa/caixa123`. Confira os três perfis.
3. **Ciclo completo de turno** — abertura com fundo → 20 itens (incluindo pesável por peso
   manual) → pagamento em duas formas → sangria → **fechamento com conferência cega**.
   Confira que o esperado não aparece antes de você informar o contado.
4. **Diferença de caixa** — feche com R$ 20,00 a menos e confirme que o sistema exige
   motivo e PIN de supervisor.
5. **Bloqueios** — deixe uma venda em espera e tente fechar. Tem que bloquear.
6. **Queda de energia** — reset forçado da VM no meio de uma venda; confirme a recuperação.
7. **Relatórios** — período do dia, curva ABC, exportação CSV.
8. **Só então** ligue periférico real, um de cada vez, seguindo
   [`TESTES_HARDWARE.md`](TESTES_HARDWARE.md).

Os passos 1 a 7 não precisam de nenhum hardware.
