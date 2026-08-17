#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${HOME}/.epiaka-sam"
PYTHON="${APP_DIR}/venv/bin/python"
CONNECTOR="${APP_DIR}/epiaka-sam-local.py"
CHECKPOINT="${APP_DIR}/sam_vit_b_01ec64.pth"
SITE_URL="https://visionlabel-anotador.eduardo1089.chatgpt.site"

open_site() {
  if command -v open >/dev/null 2>&1; then
    open "${SITE_URL}" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${SITE_URL}" >/dev/null 2>&1 || true
  fi
}

printf '\n==========================================\n'
printf ' Epiaka SAM - iniciar novamente\n'
printf '==========================================\n\n'

if [[ ! -x "${PYTHON}" || ! -f "${CONNECTOR}" || ! -f "${CHECKPOINT}" ]]; then
  printf 'A instalacao completa do SAM nao foi encontrada.\n'
  printf 'Abra o Epiaka e use primeiro o instalador para macOS/Linux.\n'
  open_site
  exit 1
fi

if command -v curl >/dev/null 2>&1 && curl --fail --silent --max-time 2 "http://127.0.0.1:7860/health" >/dev/null 2>&1; then
  printf 'O servidor SAM ja esta em execucao.\n'
  open_site
  exit 0
fi

printf 'Carregando o modelo instalado. Mantenha este terminal aberto.\n'
open_site
"${PYTHON}" "${CONNECTOR}" --checkpoint "${CHECKPOINT}" --model-type vit_b --device auto
