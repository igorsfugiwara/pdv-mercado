import type {
  VendaFiscal,
  ResultadoEmissao,
  ResultadoCancelamento,
  StatusSefaz,
} from '@shared/types'

/**
 * Interface fiscal — seção 7.2 do PRD. TODA a UI/lógica fiscal fala apenas
 * com esta interface; a implementação concreta (ACBrLib) fica isolada atrás dela.
 */
export interface FiscalProvider {
  emitir(venda: VendaFiscal): Promise<ResultadoEmissao>
  cancelar(chave: string, justificativa: string): Promise<ResultadoCancelamento>
  inutilizar(serie: number, numIni: number, numFim: number, justificativa: string): Promise<void>
  statusServico(): Promise<StatusSefaz>
  validarCertificado(): Promise<{ valido: boolean; expiraEm: Date | null }>
}
