/** @type {import('tailwindcss').Config} */
// Tema portado do PDV Casa Ó (dark + dourado), ajustado para tela de caixa.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0F0F0F',
        surface: '#1A1A1A',
        'surface-alt': '#222222',
        // Divisória decorativa dentro de um card. Não precisa de 3:1 — o conteúdo
        // já se distingue sozinho; a linha só organiza.
        border: '#383838',
        // Contorno de CONTROLE (input, botão, célula selecionável). Aqui a regra
        // 1.4.11 do WCAG vale: 3:1 contra o fundo. 3.5:1 sobre surface,
        // 3.2:1 sobre surface-alt. Sem isto o operador não vê onde é o campo.
        'border-strong': '#707070',
        primary: '#E8C547',
        'primary-dim': '#BFA030',
        success: '#4CAF7D',
        danger: '#E05252',
        warning: '#E8A23A',
        text: '#F0EDE6',
        // Era #8A8580 — 4.35:1 sobre surface-alt, abaixo do mínimo de 4.5.
        // Agora 5.3:1 sobre surface-alt e 6.4:1 sobre o fundo.
        'text-muted': '#9A948C',
        'text-inverse': '#0F0F0F',
      },
      fontFamily: {
        // Nenhuma webfont é carregada: a CSP bloqueia CDN (`font-src 'self'`) e o
        // projeto é offline-first. Stacks de sistema resolvem sem baixar nada, e
        // renderizam nativas em Windows e Linux — os dois alvos do PRD.
        display: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Ubuntu', 'Noto Sans', 'sans-serif'],
        body: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Ubuntu', 'Noto Sans', 'sans-serif'],
        mono: [
          'ui-monospace',
          'Cascadia Mono',
          'JetBrains Mono',
          'DejaVu Sans Mono',
          'Liberation Mono',
          'monospace',
        ],
      },
      borderRadius: { sm: '4px', md: '8px', lg: '12px' },
      boxShadow: {
        sm: '0 1px 3px rgba(0,0,0,0.4)',
        md: '0 4px 12px rgba(0,0,0,0.5)',
        lg: '0 8px 24px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
}
