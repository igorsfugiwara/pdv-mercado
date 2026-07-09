# Testes de Hardware

Tela **Configurações → Periféricos** tem um botão de teste por dispositivo.

## Leitor de código de barras (USB HID)
- Sem driver. Configure o leitor para enviar **sufixo Enter**.
- Teste: com o foco no campo de captura da tela Caixa, bipe um produto do seed (EAN `7891000100103`). Deve adicionar ao carrinho.

## Impressora térmica (ESC/POS)
- Modelos: Epson TM-T20X, Elgin i9, Bematech MP-4200 TH.
- Interface: USB/rede. Configure em `configuracoes` (`impressora.interface`, ex.: `printer:auto`, `tcp://192.168.0.100`, `/dev/usb/lp0`).
- Teste: botão **Testar impressora** imprime página de teste com corte automático.
- Codepage: CP-850 / UTF-8.

## Gaveta de dinheiro
- Acionada por **pulso ESC/POS** via impressora (kick). Abre em venda em dinheiro e em sangria.
- Teste: botão **Abrir gaveta**.

## Balança (serial RS-232/USB)
- Modelos: Toledo Prix 3/4/5, Filizola CS15. Protocolo selecionável.
- Configure porta e baud rate (`balanca.porta`, `balanca.baudRate`, `balanca.protocolo`).
- Timeout de leitura: **2s**, com fallback para entrada manual.
- EAN-13 de balança (prefixo `2`): layouts **código+peso** e **código+valor** — ver `parseEanBalanca` em `electron/hardware/balanca.ts`.
- Teste: botão **Ler peso da balança**.

## Roteiro de resiliência (manual)
- Kill do processo durante venda → recuperação da venda em andamento.
- Queda de rede durante emissão → contingência automática.
- Disco cheio; impressora sem papel no meio do DANFE; balança desconectada.
