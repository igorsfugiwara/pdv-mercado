// RF-25: serialização CSV (separador ';', escape de aspas), compartilhada entre
// a exportação do desktop e o download do navegador — o formato precisa ser o mesmo.
export function toCsv(linhas: Record<string, unknown>[]): string {
  if (!linhas.length) return ''
  const colunas = Object.keys(linhas[0])
  const escapar = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const cabecalho = colunas.join(';')
  const corpo = linhas.map((l) => colunas.map((c) => escapar(l[c])).join(';'))
  return [cabecalho, ...corpo].join('\n')
}
