/**
 * Contagem de dias de um período de relatório.
 *
 * Vive em `shared/` porque os dois alvos agregam por dia e precisam do MESMO
 * número — se divergirem, o mesmo dado dá giro diferente no desktop e na web.
 */

/**
 * Dias de calendário entre duas datas `YYYY-MM-DD`, contando as duas pontas.
 *
 * Trabalha só com os componentes da data, nunca com `Date` de data-e-hora: um
 * `new Date('2026-09-20')` é meia-noite **UTC**, enquanto
 * `new Date('2026-09-20T23:59:59')` é hora **local**. Misturar os dois faz o
 * período render um dia a mais em qualquer fuso a oeste de Greenwich — e o
 * giro diário sai menor do que é.
 */
export function diasNoPeriodo(de: string, ate: string): number {
  const inicio = Date.UTC(
    Number(de.slice(0, 4)),
    Number(de.slice(5, 7)) - 1,
    Number(de.slice(8, 10)),
  )
  const fim = Date.UTC(
    Number(ate.slice(0, 4)),
    Number(ate.slice(5, 7)) - 1,
    Number(ate.slice(8, 10)),
  )
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return 1
  return Math.max(1, Math.round((fim - inicio) / 86_400_000) + 1)
}
