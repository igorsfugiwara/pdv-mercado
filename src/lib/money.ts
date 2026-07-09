// Helpers monetários. Convenção do projeto: centavos (inteiros).
export function formatBRL(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function parseBRL(texto: string): number {
  const limpo = texto.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.')
  const v = parseFloat(limpo)
  return Number.isFinite(v) ? Math.round(v * 100) : 0
}

export function formatPeso(kg: number): string {
  return `${kg.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`
}
