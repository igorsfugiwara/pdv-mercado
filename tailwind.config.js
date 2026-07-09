/** @type {import('tailwindcss').Config} */
// Tema portado do PDV Casa Ó (dark + dourado). Densidade ajustada para tela de caixa.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0F0F0F',
        surface: '#1A1A1A',
        'surface-alt': '#222222',
        border: '#2E2E2E',
        primary: '#E8C547',
        'primary-dim': '#BFA030',
        success: '#4CAF7D',
        danger: '#E05252',
        warning: '#E8A23A',
        text: '#F0EDE6',
        'text-muted': '#8A8580',
        'text-inverse': '#0F0F0F',
      },
      fontFamily: {
        display: ["'Playfair Display'", 'serif'],
        body: ["'Inter'", 'sans-serif'],
        mono: ["'JetBrains Mono'", 'monospace'],
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
