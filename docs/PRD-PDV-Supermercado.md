# PRD — PDV Supermercado (Desktop, Offline-First)

**Produto:** PDV Mercado v1.0
**Base de código:** PDV Casa Ó (React + Firebase) — reaproveitamento conforme seção 2.3
**Plataformas:** Windows 10+ (.exe/NSIS) e Linux Ubuntu 22.04+ (.AppImage, .deb)
**Operação:** 100% local. Única comunicação externa: web services da SEFAZ-SP para NFC-e, com contingência offline.
**Contexto fixo:** UF **São Paulo** · Regime **Simples Nacional** · **1 caixa** (1 instalação = 1 caixa) · Documento fiscal **NFC-e modelo 65** (SAT vedado em SP desde 01/01/2026 — Portaria SRE 79/2024).
**Documento para:** Claude Code (agente de desenvolvimento)

---

## 1. Escopo

### 1.1 Entregável
Aplicativo desktop de frente de caixa para supermercado com: venda por código de barras, produtos pesáveis, gestão de caixa, cadastro de produtos e estoque, usuários/permissões, relatórios locais, emissão de NFC-e com impressão de DANFE em térmica, contingência offline e backup automático.

### 1.2 Fora do escopo (v1)
Multi-loja, sincronização em nuvem, e-commerce/delivery, ERP de retaguarda (compras/financeiro), TEF integrado (pagamento em POS externo, registro manual da forma), NF-e modelo 55.

---

## 2. Arquitetura e Stack

| Camada | Tecnologia |
|---|---|
| Desktop shell | Electron + electron-builder |
| UI | React + TypeScript + Tailwind CSS |
| Estado | Zustand |
| Banco | SQLite via `better-sqlite3` (processo main), `journal_mode=WAL`, `foreign_keys=ON` |
| Migrations/ORM | Drizzle ORM |
| IPC | contextBridge com contratos tipados; `nodeIntegration: false`, `contextIsolation: true` |
| Impressora térmica | `node-thermal-printer` (ESC/POS) |
| Balança | `serialport` (Toledo Prix / Filizola, RS-232/USB-serial) |
| Fiscal | ACBrLib NFCe (`.dll`/`.so`) via `koffi`, atrás da interface `FiscalProvider` |
| Logs | `electron-log`, rotação diária, `data/logs/` |
| Testes | Vitest (unit/integração) + Playwright Electron (E2E) |

### 2.1 Estrutura
```
pdv-mercado/
├── electron/
│   ├── main.ts
│   ├── ipc/            # handlers: vendas, produtos, caixa, fiscal, hardware, backup
│   ├── db/             # conexão, migrations, repositórios
│   ├── fiscal/         # FiscalProvider + AcbrNfceProvider + fila de contingência
│   └── hardware/       # impressora, balança, gaveta
├── src/
│   ├── screens/        # Caixa, Produtos, Estoque, Relatorios, Fiscal, Config
│   ├── components/
│   └── store/
├── data/ (runtime, userData)  # pdv.db, xmls/, imagens/, backups/, logs/, certs/
└── docs/               # MANUAL_OPERADOR.md, FISCAL.md, TESTES_HARDWARE.md
```

### 2.2 Regras de arquitetura
- Renderer nunca acessa banco, filesystem, hardware ou fiscal diretamente — só via IPC tipado.
- `grep -ri "firebase\|analytics\|telemetry"` no repositório = 0 resultados. App funciona com rede desabilitada (exceto módulo fiscal).
- Toda a UI fiscal fala apenas com a interface `FiscalProvider`.

### 2.3 Reaproveitamento do código do PDV Casa Ó
Ponto de partida do desenvolvimento é o repositório do PDV Casa Ó. Reaproveitar sem reescrever; estender onde indicado. Não migrar dados (produtos/funcionários) — banco inicia vazio com seeds de desenvolvimento.

| Origem (Casa Ó) | Destino (PDV Mercado) | Ação |
|---|---|---|
| Layout, tema, componentes de UI | Todas as telas | Portar; ajustar densidade para tela de caixa |
| Cadastro de produtos | RF-14/RF-15 | Portar e estender com campos fiscais (NCM, CEST, CFOP, CSOSN, PIS/COFINS), EAN e pesável |
| Tela de venda / carrinho | RF-01 a RF-10 | Portar e estender (bip, balança, atalhos, multiplicador) |
| Formas de pagamento | RF-07 | Portar e estender (múltiplas formas + troco) |
| Firebase Auth | RF-19/RF-20 | Substituir por auth local (argon2id + PIN) |
| Firestore | Seção 4 | Substituir por SQLite; queries → repositórios SQL |
| Firebase Storage (imagens) | `data/imagens/` | Substituir por filesystem local com path no banco |
| `onSnapshot`/realtime | Zustand store | Substituir por eventos internos (cliente único) |
| Cloud Functions / Hosting | Processo main / electron-builder | Remover; lógica migra para o main |

Critério de conclusão da portabilidade: app renderiza as telas da Casa Ó dentro do Electron, lendo/gravando em SQLite, com a regra de `grep` da seção 2.2 satisfeita.

---

## 3. Requisitos Funcionais

### 3.1 Frente de caixa
- **RF-01** Leitura de código de barras via leitor USB HID (modo teclado); foco permanente no campo de captura; detecção de bip por velocidade + sufixo Enter.
- **RF-02** Busca por EAN, código interno ou nome (autocomplete ≤ 50ms).
- **RF-03** Produtos pesáveis: peso lido da balança serial (comando de solicitação + parse) e suporte a EAN-13 de balança (prefixo 2; layout código+peso e código+valor, configurável).
- **RF-04** Multiplicador de quantidade: `3 *` + bip = 3 unidades.
- **RF-05** Desconto por item e por venda (% ou R$), com limite por perfil; acima do limite, autorização de supervisor por PIN.
- **RF-06** Cancelamento de item e de venda com autorização de supervisor; registro em `auditoria`.
- **RF-07** Múltiplas formas de pagamento na mesma venda: dinheiro (troco), débito, crédito, PIX, voucher.
- **RF-08** CPF na nota (opcional, validação de dígito).
- **RF-09** Venda em espera: salvar e recuperar carrinho.
- **RF-10** Operação 100% por teclado:
  `F2` buscar · `F3` quantidade · `F4` desconto · `F5` peso · `F6` cancelar item · `F7` espera · `F8` CPF · `F9` sangria/suprimento · `F10` pagamento · `F12` cancelar venda · `Ctrl+L` trava/troca de operador (PIN)

### 3.2 Gestão de caixa
- **RF-11** Abertura com fundo de troco; fechamento com conferência cega e apuração de diferença.
- **RF-12** Sangria e suprimento com motivo e autorização.
- **RF-13** Relatório de fechamento por forma de pagamento impresso na térmica.

### 3.3 Produtos e estoque
- **RF-14** Cadastro de produtos: EAN, código interno, descrição, unidade (UN/KG), pesável, preço custo/venda, estoque atual/mínimo, grupo, imagem, **NCM, CEST, CFOP, origem, CSOSN (Simples Nacional), CST PIS/COFINS e alíquotas**. Campos fiscais obrigatórios para ativar o produto.
- **RF-15** Importação de produtos via CSV com validação (template em `docs/`); relatório de erros linha a linha.
- **RF-16** Baixa de estoque na venda e estorno no cancelamento (transacional).
- **RF-17** Entrada de mercadoria e ajuste de inventário com motivo.
- **RF-18** Alerta de estoque mínimo no dashboard.
- **RF-18.1** Cancelamento de produto: exclusão definitiva permitida apenas para produto sem histórico de venda; produto com histórico é **inativado** (some da busca do caixa, preserva integridade referencial de vendas e relatórios). Reativação disponível na listagem com filtro "inativos". Ambas as ações exigem perfil Supervisor+ e registram em `auditoria`.

### 3.4 Usuários e auditoria
- **RF-19** Perfis: Administrador, Supervisor, Operador.
- **RF-20** Login usuário/senha (argon2id) + troca rápida de operador por PIN.
- **RF-21** Auditoria imutável: cancelamentos, descontos autorizados, sangrias, alteração de preço, ações fiscais.

### 3.5 Relatórios
- **RF-22** Vendas por período, forma de pagamento, operador, produto e grupo.
- **RF-23** Curva ABC.
- **RF-24** Documentos fiscais por status: autorizados, contingência pendente, cancelados, rejeitados, inutilizados.
- **RF-25** Exportação CSV e PDF.

### 3.6 Fiscal
- **RF-26** Emissão de NFC-e (modelo 65) na finalização da venda; impressão do DANFE NFC-e com QR Code na térmica.
- **RF-27** Contingência offline automática (`tpEmis=9`): assina e armazena XML local, imprime DANFE de contingência; job de retransmissão a cada 2 min com backoff; conciliação de protocolo.
- **RF-28** Cancelamento de NFC-e dentro do prazo regulamentar da SEFAZ-SP.
- **RF-29** Inutilização de faixa de numeração.
- **RF-30** Monitor fiscal: validade do certificado (alerta a 30 dias), fila de contingência, últimas rejeições com motivo tratado, ambiente ativo (homologação/produção).
- **RF-31** Leiaute NFC-e conforme Notas Técnicas vigentes em 2026 (campos IBS/CBS da Reforma Tributária e QR Code 3.0) — responsabilidade da versão atualizada da ACBrLib; pipeline de atualização da lib documentado em `docs/FISCAL.md`.

---

## 4. Modelo de Dados (SQLite)

```sql
usuarios(id, nome, login, senha_hash, pin_hash, perfil, ativo, criado_em)
grupos(id, nome)

produtos(id, codigo_interno, ean, descricao, unidade, pesavel,
         preco_custo, preco_venda, estoque_atual, estoque_minimo,
         grupo_id, imagem_path, ativo,
         ncm, cest, cfop, origem, csosn, cst_pis, aliq_pis,
         cst_cofins, aliq_cofins, criado_em, atualizado_em)

caixas(id, usuario_abertura_id, valor_abertura, aberto_em,
       usuario_fechamento_id, fechado_em, status)

movimentos_caixa(id, caixa_id, tipo, valor, motivo, usuario_id,
                 autorizado_por_id, criado_em)

vendas(id, caixa_id, usuario_id, cliente_cpf, subtotal, desconto, total,
       status, criado_em, cancelada_em, cancelada_por_id)

venda_itens(id, venda_id, produto_id, descricao, quantidade, peso,
            preco_unitario, desconto, total)

venda_pagamentos(id, venda_id, forma, valor, troco)

documentos_fiscais(id, venda_id, modelo, serie, numero, chave_acesso,
                   status, protocolo, xml_path, motivo_rejeicao,
                   emitida_em, autorizada_em, cancelada_em)

estoque_movimentos(id, produto_id, tipo, quantidade, referencia_id,
                   usuario_id, criado_em)

auditoria(id, usuario_id, acao, detalhe_json, criado_em)
configuracoes(chave, valor)
```

**Invariantes:**
1. Finalização de venda é uma transação única: `vendas` + `venda_itens` + `venda_pagamentos` + `estoque_movimentos` + `documentos_fiscais`.
2. Numeração NFC-e sequencial por série, nunca reutilizada; lacunas geram inutilização (RF-29).
3. XMLs em `data/xmls/AAAA/MM/`, retenção de 5 anos, incluídos no backup.
4. Rascunho da venda em andamento persistido a cada item; recuperação oferecida na reabertura do app.

---

## 5. Hardware

| Equipamento | Integração | Requisito |
|---|---|---|
| Leitor de código de barras | USB HID (teclado) | Sem driver; configurar sufixo Enter |
| Impressora térmica (Epson TM-T20X, Elgin i9, Bematech MP-4200 TH) | ESC/POS via USB/rede | DANFE NFC-e com QR Code, corte automático, CP-850/UTF-8 |
| Gaveta | Pulso via impressora (ESC/POS kick) | Abre em venda em dinheiro e sangria |
| Balança (Toledo Prix 3/4/5, Filizola CS15) | Serial RS-232/USB | Protocolo selecionável; timeout 2s com fallback manual |

Tela **Configurações → Periféricos** com botão de teste por dispositivo (imprime página de teste, lê peso, abre gaveta, ecoa bip).

---

## 6. Requisitos Não-Funcionais

- **RNF-01** Item no carrinho em < 100ms.
- **RNF-02** Resistência a queda de energia: WAL + transações; zero corrupção; recuperação de venda em andamento.
- **RNF-03** Operação integral offline; apenas o fiscal usa rede, com contingência.
- **RNF-04** Certificado A1 (.pfx) em `data/certs/`, senha via `safeStorage` (DPAPI/keyring).
- **RNF-05** Backup diário automático (`VACUUM INTO` → `data/backups/`, retenção 30) + export manual para pendrive; backup inclui XMLs.
- **RNF-06** Zero telemetria e zero requests externos fora do módulo fiscal.
- **RNF-07** Instalação limpa validada em Windows 10/11 e Ubuntu 22.04/24.04.

---

## 7. Módulo Fiscal — NFC-e SEFAZ-SP

### 7.1 Parâmetros fixos
- Documento: NFC-e modelo 65, série 1, ambiente homologação → produção.
- SEFAZ-SP: web services oficiais; CSC + IdToken de homologação e de produção cadastrados em Configurações → Fiscal.
- Regime: Simples Nacional → CRT=1, tributação por **CSOSN** nos itens.
- Certificado: e-CNPJ **A1** (.pfx).
- Emissor: **ACBrLib NFCe** (Windows `.dll` / Linux `.so`), carregada no processo main via `koffi`, encapsulada em `AcbrNfceProvider implements FiscalProvider`.

### 7.2 Interface
```ts
interface FiscalProvider {
  emitir(venda: VendaFiscal): Promise<ResultadoEmissao>;   // autorizada | contingencia | rejeitada
  cancelar(chave: string, justificativa: string): Promise<ResultadoCancelamento>;
  inutilizar(serie: number, numIni: number, numFim: number, justificativa: string): Promise<void>;
  statusServico(): Promise<StatusSefaz>;
  validarCertificado(): Promise<{ valido: boolean; expiraEm: Date }>;
}
```

### 7.3 Fluxo de emissão
```
finalizarVenda()
  └─ tx SQLite (venda + itens + pagamentos + estoque + doc status=pendente)
  └─ FiscalProvider.emitir()
       ├─ autorizada  → salvar XML+protocolo → imprimir DANFE (QR online) → doc=autorizada
       ├─ timeout/indisponível → tpEmis=9 → XML assinado local → DANFE contingência
       │     → doc=contingencia_pendente → fila (retry 2min, backoff, máx 24h → alerta)
       └─ rejeitada   → doc=rejeitada + motivo tratado na UI → venda permanece; correção e reemissão
```

### 7.4 Onboarding fiscal do cliente (checklist operacional)
1. **Certificado digital e-CNPJ A1** — AC credenciada ICP-Brasil (Serasa, Certisign, Soluti, Valid, Safeweb); validação por videoconferência; R$ 150–300/ano; importar .pfx no sistema.
2. **Credenciamento NFC-e no portal da SEFAZ-SP** (login com certificado do CNPJ).
3. **Geração do CSC + IdToken** (homologação e produção) no portal da SEFAZ-SP.
4. **Cadastro fiscal dos produtos** (NCM, CEST, CFOP, CSOSN, PIS/COFINS) — planilha padrão validada por contador responsável.
5. Bateria de homologação (seção 9.3) → virada para produção.

> Itens 1–3 e 5 são executáveis como serviço de implantação pelo fornecedor do software. O item 4 (enquadramento tributário) exige contador responsável.

---

## 8. Plano de Desenvolvimento

### Fase 0 — Fundação (1 semana)
- [ ] Bootstrap Electron + electron-builder; portar app React da Casa Ó para o shell (build .exe e .AppImage funcionais)
- [ ] SQLite + Drizzle + migrations + repositórios + seeds; remoção completa do Firebase (critério da seção 2.3)
- [ ] **Spike fiscal:** hello-world ACBrLib emitindo NFC-e em homologação SEFAZ-SP no Windows e no Linux — gate de aprovação da fase

### Fase 1 — Núcleo de venda (2–3 semanas)
- [ ] Cadastro de produtos (portado da Casa Ó) + campos fiscais + inativação/exclusão (RF-18.1) + importação CSV
- [ ] Tela de caixa completa (RF-01 a RF-10)
- [ ] Abertura/fechamento, sangria/suprimento (RF-11 a RF-13)
- [ ] Auth local, perfis, auditoria (RF-19 a RF-21)
- [ ] Transação de venda + recuperação pós-queda (RNF-02)

### Fase 2 — Hardware (1–2 semanas)
- [ ] Impressora térmica: cupom teste, fechamento de caixa, gaveta
- [ ] Balança serial + EAN de balança
- [ ] Tela de periféricos com testes

### Fase 3 — Fiscal em homologação (2–3 semanas)
- [ ] `AcbrNfceProvider` completo (emitir, cancelar, inutilizar, status, certificado)
- [ ] Configurações fiscais + importação do .pfx
- [ ] DANFE NFC-e com QR Code na térmica
- [ ] Contingência + fila + monitor fiscal (RF-27, RF-30)
- [ ] Checklist 9.3 aprovado 100%

### Fase 4 — Relatórios, backup, empacotamento (1–2 semanas)
- [ ] RF-22 a RF-25
- [ ] Backup automático + export pendrive
- [ ] Instaladores assinados; instalação limpa nos 2 SOs
- [ ] `MANUAL_OPERADOR.md` e `FISCAL.md`

### Fase 5 — Produção e go-live (1–2 semanas)
- [ ] CSC/certificado de produção; ambiente=produção
- [ ] Teste de estresse: 500 vendas, latência e integridade verificadas
- [ ] Operação assistida 2–3 dias no cliente
- [ ] Go-live + rotina de suporte (logs + verificação de backup)

---

## 9. Testes

### 9.1 Automatizados
| Tipo | Escopo | Ferramenta |
|---|---|---|
| Unitários | Totais, troco, descontos, parse EAN balança, validação CPF/EAN, repositórios | Vitest |
| Integração | Transação de venda completa, fila de contingência, estorno de estoque | Vitest + SQLite in-memory |
| E2E | Fluxo de caixa via UI com bip simulado e atalhos | Playwright Electron |

### 9.2 Resiliência (roteiro manual)
Kill do processo durante venda · queda de rede durante emissão · disco cheio · impressora sem papel no meio do DANFE · balança desconectada.

### 9.3 Homologação fiscal (gate obrigatório da Fase 3)
- [ ] Emissão autorizada: 1 item, dinheiro
- [ ] Venda com múltiplos pagamentos + desconto + CPF
- [ ] Item pesável (quantidade fracionada KG)
- [ ] Cancelamento dentro do prazo
- [ ] Contingência: rede off, 5 vendas, rede on, retransmissão e conciliação automáticas
- [ ] Rejeições simuladas: duplicidade (539), NCM inválido, certificado vencido
- [ ] Inutilização de faixa
- [ ] XMLs aprovados no validador da SEFAZ
- [ ] QR Code do DANFE validado na consulta pública da SEFAZ-SP

### 9.4 Critério de aceite final
Operador sem treinamento técnico executa, apenas com teclado e leitor: abertura de caixa → venda de 20 itens (incluindo pesável) → pagamento em 2 formas → NFC-e autorizada e DANFE impresso → sangria → fechamento com conferência cega. Em seguida, mesma venda com rede desconectada resulta em NFC-e de contingência transmitida automaticamente ao reconectar.
