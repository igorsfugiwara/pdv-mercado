# Módulo Fiscal — NFC-e SEFAZ-SP

## Parâmetros fixos
- Documento: **NFC-e modelo 65**, série 1, ambiente homologação → produção.
- Regime: **Simples Nacional** (CRT=1), tributação por **CSOSN** nos itens.
- Certificado: **e-CNPJ A1** (.pfx), senha via `safeStorage` (DPAPI/keyring) — nunca em texto.
- Emissor: **ACBrLib NFCe** (Windows `.dll` / Linux `.so`), carregada no processo main via `koffi`, encapsulada em `AcbrNfceProvider implements FiscalProvider`.

## Interface (`electron/fiscal/FiscalProvider.ts`)
`emitir · cancelar · inutilizar · statusServico · validarCertificado`. **Toda** a UI fiscal fala apenas com esta interface.

## Fluxo de emissão (`electron/services/vendaService.ts`)
```
finalizarVenda()
  ├─ tx SQLite (venda + itens + pagamentos + estoque + doc status=pendente)
  └─ FiscalProvider.emitir()
       ├─ autorizada  → salva XML+protocolo → imprime DANFE (QR) → doc=autorizada
       ├─ timeout/off → tpEmis=9 → XML assinado local → DANFE contingência
       │                 → doc=contingencia_pendente → fila (retry 2min, backoff, máx 24h → alerta)
       └─ rejeitada   → doc=rejeitada + motivo → venda permanece; correção e reemissão
```
A transação de banco **sempre** persiste a venda; falha fiscal não desfaz a venda.

## Spike ACBrLib (gate da Fase 0 / integração da Fase 3)
1. Obter binário da ACBrLib NFCe (Win `.dll` + Linux `.so`) compatível com o leiaute vigente 2026 (IBS/CBS, QR Code 3.0 — RF-31).
2. Em `AcbrNfceProvider.inicializar()`: `koffi.load(libPath)`, carregar símbolos `NFCE_Inicializar`, `NFCE_ConfigGravarValor`, `NFCE_CriarEnviarNFe`, `NFCE_Cancelar`, `NFCE_Inutilizar`, `NFCE_StatusServico`.
3. Gerar `ACBrLib.ini` com: certificado A1, CSC+IdToken (homologação/produção), UF=SP, ambiente, path de XMLs.
4. Bateria de homologação (seção 9.3 do PRD) 100% aprovada → virada para produção (apenas troca de CSC/certificado/ambiente; a UI não muda).

## Pipeline de atualização da lib (RF-31)
O leiaute NFC-e muda por Notas Técnicas. Manter a ACBrLib atualizada é o mecanismo de conformidade: versionar o binário em `build/acbr/<versao>/`, registrar a versão em `configuracoes` (`fiscal.acbrVersao`), e revalidar a bateria 9.3 a cada atualização.

## Contingência (`electron/fiscal/contingenciaQueue.ts`)
Documentos `contingencia_pendente` são reprocessados a cada 2 min com backoff exponencial (máx 30 min). Após 24h sem autorização → alerta no monitor fiscal. Conciliação de protocolo reenvia o XML já assinado.

## Onboarding fiscal do cliente (checklist)
1. Certificado A1 e-CNPJ (AC ICP-Brasil) → importar .pfx.
2. Credenciamento NFC-e no portal SEFAZ-SP.
3. Geração de CSC + IdToken (homologação e produção).
4. Cadastro fiscal dos produtos (NCM/CEST/CFOP/CSOSN/PIS/COFINS) — **exige contador**.
5. Bateria de homologação → produção.
