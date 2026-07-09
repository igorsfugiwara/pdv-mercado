#!/usr/bin/env bash
# RNF-06 / seção 2.2: garante zero acoplamento com nuvem.
# `grep` por firebase/analytics/telemetry no código-fonte deve retornar 0 resultados.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Verificando ausência de firebase/analytics/telemetry no código-fonte..."
if grep -rniE "firebase|google-analytics|gtag|mixpanel|telemetry|amplitude" \
    --include="*.ts" --include="*.tsx" --include="*.js" \
    src electron shared 2>/dev/null; then
  echo "❌ FALHA: encontradas referências proibidas acima." >&2
  exit 1
fi
echo "✅ OK: nenhuma referência a nuvem/telemetria encontrada."
