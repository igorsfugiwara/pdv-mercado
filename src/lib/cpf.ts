// RF-08: validação de dígito verificador do CPF.
export function validarCpf(cpf: string): boolean {
  const s = cpf.replace(/\D/g, '')
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false
  const calc = (base: string, pesoIni: number) => {
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += parseInt(base[i], 10) * (pesoIni - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  return calc(s.slice(0, 9), 10) === +s[9] && calc(s.slice(0, 10), 11) === +s[10]
}

export function formatarCpf(cpf: string): string {
  const s = cpf.replace(/\D/g, '').slice(0, 11)
  return s.replace(/(\d{3})(\d{3})?(\d{3})?(\d{2})?/, (_, a, b, c, d) =>
    [a, b, c].filter(Boolean).join('.') + (d ? `-${d}` : ''),
  )
}
