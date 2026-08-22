/**
 * Em qual alvo o renderer está rodando.
 *
 * No desktop o preload do Electron define `window.api` ANTES de qualquer script
 * da página; na web quem define é o adapter HTTP, que marca `__pdvWeb`.
 * Módulo minúsculo e sem dependências de propósito: as telas precisam só disto,
 * sem arrastar o cliente HTTP para dentro do bundle do Electron.
 */
export function ehWeb(): boolean {
  return (window as any).__pdvWeb === true
}
