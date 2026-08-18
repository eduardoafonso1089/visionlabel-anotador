#!/usr/bin/env bash
set -euo pipefail

DEFAULT_SITE_URL="https://visionlabel-anotador.eduardo1089.chatgpt.site"
SITE_URL="${VISIONLABEL_SITE_URL:-${DEFAULT_SITE_URL}}"
SITE_URL="${SITE_URL%/}"
APP_DIR="${HOME}/.visionlabel-sam"
SELECTED_MODEL_FILE="${APP_DIR}/selected-model.txt"
CONNECTOR="${APP_DIR}/visionlabel-sam-local.py"
PORT="7860"

usage() {
  cat <<'EOF'
VisionLabel SAM local — iniciar o modelo selecionado

Uso:
  bash visionlabel-sam-start-macos-linux.sh
  bash visionlabel-sam-start-macos-linux.sh --help

O modelo é lido de ~/.visionlabel-sam/selected-model.txt. Para trocar de
modelo, execute novamente o instalador e informe o novo ID.
EOF
}

fail() {
  printf '\nErro: %s\n' "$*" >&2
  exit 1
}

normalize_model() {
  case "$1" in
    sam1-vit-b|sam1-vit-l|sam1-vit-h|\
    sam2.1-hiera-tiny|sam2.1-hiera-small|sam2.1-hiera-base-plus|sam2.1-hiera-large|\
    sam3-concepts)
      printf '%s\n' "$1"
      ;;
    sam3)
      printf '%s\n' "sam3-concepts"
      ;;
    *)
      return 1
      ;;
  esac
}

open_site() {
  if command -v open >/dev/null 2>&1; then
    open "$SITE_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$SITE_URL" >/dev/null 2>&1 || true
  fi
}

server_is_running() {
  command -v curl >/dev/null 2>&1 &&
    curl --fail --silent --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1
}

set_model_metadata() {
  MODEL_ID="$1"
  MODEL_CONFIG=""
  case "$MODEL_ID" in
    sam1-vit-b)
      FAMILY="sam1"
      CHECKPOINT_NAME="sam_vit_b_01ec64.pth"
      ;;
    sam1-vit-l)
      FAMILY="sam1"
      CHECKPOINT_NAME="sam_vit_l_0b3195.pth"
      ;;
    sam1-vit-h)
      FAMILY="sam1"
      CHECKPOINT_NAME="sam_vit_h_4b8939.pth"
      ;;
    sam2.1-hiera-tiny)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_tiny.pt"
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    sam2.1-hiera-small)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_small.pt"
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_s.yaml"
      ;;
    sam2.1-hiera-base-plus)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_base_plus.pt"
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_b+.yaml"
      ;;
    sam2.1-hiera-large)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_large.pt"
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_l.yaml"
      ;;
    sam3-concepts)
      FAMILY="sam3"
      CHECKPOINT_NAME="sam3.pt"
      ;;
    *)
      fail "modelo salvo inválido: ${MODEL_ID}"
      ;;
  esac

  VENV_DIR="${APP_DIR}/venvs/${FAMILY}"
  PYTHON="${VENV_DIR}/bin/python"
  CHECKPOINT="${APP_DIR}/models/${MODEL_ID}/${CHECKPOINT_NAME}"
}

recognize_legacy_installation() {
  local legacy_checkpoint="${APP_DIR}/sam_vit_b_01ec64.pth"
  if [[ -f "$SELECTED_MODEL_FILE" ]]; then
    return 0
  fi
  if [[ -f "$legacy_checkpoint" ]]; then
    printf 'Instalação antiga do SAM 1 ViT-B reconhecida; usando-a sem remover arquivos.\n'
    mkdir -p "$APP_DIR"
    printf '%s\n' "sam1-vit-b" >"${SELECTED_MODEL_FILE}.part"
    mv -f "${SELECTED_MODEL_FILE}.part" "$SELECTED_MODEL_FILE"
    return 0
  fi
  fail "nenhum modelo selecionado. Execute primeiro o instalador para macOS/Linux."
}

resolve_legacy_paths() {
  if [[ "$MODEL_ID" != "sam1-vit-b" ]]; then
    return 0
  fi
  if [[ ! -x "$PYTHON" && -x "${APP_DIR}/venv/bin/python" ]]; then
    printf 'Reutilizando o ambiente antigo do SAM 1 sem movê-lo.\n'
    VENV_DIR="${APP_DIR}/venv"
    PYTHON="${VENV_DIR}/bin/python"
  fi
  if [[ ! -f "$CHECKPOINT" && -f "${APP_DIR}/sam_vit_b_01ec64.pth" ]]; then
    printf 'Reutilizando o checkpoint antigo do SAM 1 ViT-B sem movê-lo.\n'
    CHECKPOINT="${APP_DIR}/sam_vit_b_01ec64.pth"
  fi
}

validate_platform() {
  local os_name
  os_name="$(uname -s)"
  case "$os_name" in
    Linux|Darwin) ;;
    *) fail "sistema não suportado por este iniciador: ${os_name}" ;;
  esac
  if [[ "$MODEL_ID" == "sam3-concepts" ]]; then
    [[ "$os_name" == "Linux" ]] ||
      fail "SAM 3 não é disponibilizado no macOS; selecione SAM 1 ou SAM 2.1."
    command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1 ||
      fail "SAM 3 exige uma GPU NVIDIA funcional no Linux."
  fi
}

run_connector() {
  local args=(
    "$CONNECTOR"
    --model "$MODEL_ID"
    --checkpoint "$CHECKPOINT"
  )
  if [[ -n "$MODEL_CONFIG" ]]; then
    args+=(--model-config "$MODEL_CONFIG")
  fi
  args+=(--device auto --port "$PORT")
  VISIONLABEL_ALLOWED_ORIGINS="${SITE_URL},http://localhost:5173,http://127.0.0.1:5173" \
    "$PYTHON" "${args[@]}"
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if (( $# != 0 )); then
  usage >&2
  fail "este iniciador não recebe modelo; a seleção vem de ${SELECTED_MODEL_FILE}."
fi
case "$SITE_URL" in
  https://*) ;;
  *) fail "VISIONLABEL_SITE_URL deve usar HTTPS." ;;
esac

recognize_legacy_installation
RAW_MODEL_ID="$(tr -d '\r\n' <"$SELECTED_MODEL_FILE")"
MODEL_ID="$(normalize_model "$RAW_MODEL_ID")" || fail "modelo salvo inválido: ${RAW_MODEL_ID}"
set_model_metadata "$MODEL_ID"
validate_platform
resolve_legacy_paths

[[ -x "$PYTHON" ]] || fail "ambiente da família ${FAMILY} não encontrado. Execute novamente o instalador para ${MODEL_ID}."
[[ -f "$CONNECTOR" ]] || fail "conector canônico não encontrado. Execute novamente o instalador."
[[ -f "$CHECKPOINT" ]] || fail "checkpoint de ${MODEL_ID} não encontrado. Execute novamente o instalador."

MINIMUM_PYTHON_MINOR=10
[[ "$FAMILY" == "sam3" ]] && MINIMUM_PYTHON_MINOR=12
"$PYTHON" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, ${MINIMUM_PYTHON_MINOR}) else 1)" >/dev/null 2>&1 ||
  fail "o runtime ${FAMILY} precisa de Python 3.${MINIMUM_PYTHON_MINOR}+ para o conector atual. Execute novamente o instalador."
if [[ "$FAMILY" == "sam3" ]]; then
  "$PYTHON" -c 'import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)' >/dev/null 2>&1 ||
    fail "o runtime SAM 3 não conseguiu usar a GPU NVIDIA. Confirme driver e compatibilidade CUDA 12.6+."
fi

if ! "$PYTHON" "$CONNECTOR" --help 2>&1 | grep -q -- '--model'; then
  fail "o conector instalado é antigo e não aceita --model. Execute novamente o instalador para atualizá-lo."
fi

printf '\n==========================================\n'
printf ' VisionLabel SAM — %s\n' "$MODEL_ID"
printf '==========================================\n\n'

if server_is_running; then
  printf 'Já existe um conector em execução na porta %s.\n' "$PORT"
  printf 'Para trocar de modelo, encerre a janela antiga antes de iniciar novamente.\n'
  open_site
  exit 0
fi

printf 'Carregando o modelo selecionado. Mantenha este terminal aberto.\n'
open_site
run_connector
