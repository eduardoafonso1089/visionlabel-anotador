#!/usr/bin/env bash
set -euo pipefail

DEFAULT_SITE_URL="https://visionlabel-anotador.eduardo1089.chatgpt.site"
SITE_URL="${VISIONLABEL_SITE_URL:-${DEFAULT_SITE_URL}}"
SITE_URL="${SITE_URL%/}"
APP_DIR="${HOME}/.visionlabel-sam"
VENVS_DIR="${APP_DIR}/venvs"
MODELS_DIR="${APP_DIR}/models"
CONNECTOR="${APP_DIR}/visionlabel-sam-local.py"
SELECTED_MODEL_FILE="${APP_DIR}/selected-model.txt"
PORT="7860"

SAM1_REVISION="dca509fe793f601edb92606367a655c15ac00fdf"
SAM2_REVISION="2b90b9f5ceec907a1c18123530e92e794ad901a4"
SAM3_REVISION="8f0b7f4d4e7eda2ed606ebde6702c93359ad01da"

usage() {
  cat <<'EOF'
VisionLabel SAM local — instalador para macOS/Linux

Uso:
  bash visionlabel-sam-macos-linux.sh [MODELO]
  bash visionlabel-sam-macos-linux.sh --help

Modelos aceitos:
  sam1-vit-b
  sam1-vit-l
  sam1-vit-h
  sam2.1-hiera-tiny
  sam2.1-hiera-small
  sam2.1-hiera-base-plus
  sam2.1-hiera-large
  sam3-concepts          (alias aceito: sam3)

Sem MODELO, o instalador abre um menu. SAM 3 exige Linux, GPU NVIDIA,
Python 3.12+ e acesso aprovado ao checkpoint gated da Meta no Hugging Face.

Variável opcional:
  VISIONLABEL_SITE_URL   URL HTTPS do VisionLabel que fornece o conector
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

choose_model() {
  local choice
  printf '\nEscolha o modelo que deseja instalar e usar:\n\n' >&2
  printf '  1) SAM 1 ViT-B             (~375 MB; imagem)\n' >&2
  printf '  2) SAM 1 ViT-L             (~1,25 GB; imagem)\n' >&2
  printf '  3) SAM 1 ViT-H             (~2,56 GB; imagem)\n' >&2
  printf '  4) SAM 2.1 Hiera Tiny      (~156 MB; imagem/vídeo)\n' >&2
  printf '  5) SAM 2.1 Hiera Small     (~184 MB; recomendado)\n' >&2
  printf '  6) SAM 2.1 Hiera Base+     (~324 MB; imagem/vídeo)\n' >&2
  printf '  7) SAM 2.1 Hiera Large     (~898 MB; imagem/vídeo)\n' >&2
  printf '  8) SAM 3 Concepts          (~3,45 GB; Linux + NVIDIA)\n\n' >&2
  printf 'Digite 1–8 ou o ID completo: ' >&2
  IFS= read -r choice || fail "não foi possível ler a escolha. Informe o ID como primeiro argumento."
  case "$choice" in
    1) printf '%s\n' "sam1-vit-b" ;;
    2) printf '%s\n' "sam1-vit-l" ;;
    3) printf '%s\n' "sam1-vit-h" ;;
    4) printf '%s\n' "sam2.1-hiera-tiny" ;;
    5) printf '%s\n' "sam2.1-hiera-small" ;;
    6) printf '%s\n' "sam2.1-hiera-base-plus" ;;
    7) printf '%s\n' "sam2.1-hiera-large" ;;
    8) printf '%s\n' "sam3-concepts" ;;
    *) normalize_model "$choice" || fail "modelo inválido: ${choice}" ;;
  esac
}

python_meets() {
  local command_name="$1"
  local major="$2"
  local minor="$3"
  command -v "$command_name" >/dev/null 2>&1 || return 1
  "$command_name" -c "import sys; raise SystemExit(0 if sys.version_info >= (${major}, ${minor}) else 1)" >/dev/null 2>&1
}

find_python() {
  local major="$1"
  local minor="$2"
  local candidate
  for candidate in python3.13 python3.12 python3.11 python3.10 python3 python; do
    if python_meets "$candidate" "$major" "$minor"; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

require_https() {
  case "$1" in
    https://*) ;;
    *) fail "download recusado porque a URL não usa HTTPS: $1" ;;
  esac
}

download_to_file() {
  local url="$1"
  local destination="$2"
  require_https "$url"
  mkdir -p "$(dirname "$destination")"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --retry 3 --retry-delay 2 --progress-bar "$url" --output "$destination"
  elif command -v wget >/dev/null 2>&1; then
    wget --https-only --tries=3 --show-progress "$url" --output-document="$destination"
  else
    fail "instale curl ou wget para continuar."
  fi
  [[ -s "$destination" ]] || fail "o download retornou um arquivo vazio: $url"
}

download_atomic() {
  local url="$1"
  local destination="$2"
  local partial="${destination}.part"
  download_to_file "$url" "$partial"
  mv -f "$partial" "$destination"
}

download_connector() {
  local url="${SITE_URL}/visionlabel-sam-local.py"
  local partial="${CONNECTOR}.part"
  require_https "$SITE_URL"
  printf 'Baixando o conector canônico do VisionLabel...\n'
  download_to_file "$url" "$partial"
  if ! grep -q -- '"--model"' "$partial"; then
    rm -f "$partial"
    fail "o Site forneceu um conector incompatível, sem a opção --model. Tente novamente após atualizar o VisionLabel."
  fi
  chmod 600 "$partial"
  mv -f "$partial" "$CONNECTOR"
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
      CHECKPOINT_URL="https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
      ;;
    sam1-vit-l)
      FAMILY="sam1"
      CHECKPOINT_NAME="sam_vit_l_0b3195.pth"
      CHECKPOINT_URL="https://dl.fbaipublicfiles.com/segment_anything/sam_vit_l_0b3195.pth"
      ;;
    sam1-vit-h)
      FAMILY="sam1"
      CHECKPOINT_NAME="sam_vit_h_4b8939.pth"
      CHECKPOINT_URL="https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth"
      ;;
    sam2.1-hiera-tiny)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_tiny.pt"
      CHECKPOINT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt"
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    sam2.1-hiera-small)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_small.pt"
      CHECKPOINT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt"
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_s.yaml"
      ;;
    sam2.1-hiera-base-plus)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_base_plus.pt"
      CHECKPOINT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt"
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_b+.yaml"
      ;;
    sam2.1-hiera-large)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_large.pt"
      CHECKPOINT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt"
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_l.yaml"
      ;;
    sam3-concepts)
      FAMILY="sam3"
      CHECKPOINT_NAME="sam3.pt"
      CHECKPOINT_URL=""
      ;;
    *)
      fail "modelo inválido: ${MODEL_ID}"
      ;;
  esac
  VENV_DIR="${VENVS_DIR}/${FAMILY}"
  PYTHON="${VENV_DIR}/bin/python"
  CHECKPOINT="${MODELS_DIR}/${MODEL_ID}/${CHECKPOINT_NAME}"
}

check_platform() {
  OS_NAME="$(uname -s)"
  case "$OS_NAME" in
    Linux|Darwin) ;;
    *) fail "sistema não suportado por este instalador: ${OS_NAME}" ;;
  esac

  if [[ "$MODEL_ID" == "sam3-concepts" ]]; then
    if [[ "$OS_NAME" == "Darwin" ]]; then
      fail "SAM 3 não é oferecido no macOS: o upstream exige Linux, GPU NVIDIA e CUDA 12.6+. Escolha SAM 1 ou SAM 2.1."
    fi
    command -v nvidia-smi >/dev/null 2>&1 ||
      fail "SAM 3 exige uma GPU NVIDIA disponível no Linux; nvidia-smi não foi encontrado."
    nvidia-smi -L >/dev/null 2>&1 ||
      fail "SAM 3 exige uma GPU NVIDIA funcional; nvidia-smi não conseguiu acessá-la."
  fi
}

prepare_venv() {
  local minimum_minor
  case "$FAMILY" in
    sam1) minimum_minor=10 ;;
    sam2) minimum_minor=10 ;;
    sam3) minimum_minor=12 ;;
    *) fail "família de runtime inválida: ${FAMILY}" ;;
  esac

  if [[ ! -x "$PYTHON" ]]; then
    local system_python
    system_python="$(find_python 3 "$minimum_minor")" ||
      fail "Python 3.${minimum_minor}+ não foi encontrado. Instale essa versão do Python e execute novamente."
    printf 'Criando ambiente isolado da família %s com %s...\n' "$FAMILY" "$system_python"
    mkdir -p "$VENVS_DIR"
    "$system_python" -m venv "$VENV_DIR" ||
      fail "não foi possível criar o ambiente virtual. No Linux, instale também o pacote python3-venv."
  fi

  "$PYTHON" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, ${minimum_minor}) else 1)" >/dev/null 2>&1 ||
    fail "o ambiente ${VENV_DIR} usa um Python antigo. Preserve-o e remova-o manualmente se desejar recriá-lo com Python 3.${minimum_minor}+."
}

install_runtime() {
  local ready_file
  case "$FAMILY" in
    sam1) ready_file="${VENV_DIR}/.visionlabel-sam1-${SAM1_REVISION}.ok" ;;
    sam2) ready_file="${VENV_DIR}/.visionlabel-sam2-${SAM2_REVISION}.ok" ;;
    sam3) ready_file="${VENV_DIR}/.visionlabel-sam3-${SAM3_REVISION}.ok" ;;
  esac

  if [[ -f "$ready_file" ]]; then
    if "$PYTHON" -c 'import cv2, fastapi, torch, uvicorn' >/dev/null 2>&1; then
      case "$FAMILY" in
        sam1) "$PYTHON" -c 'import segment_anything' >/dev/null 2>&1 && return 0 ;;
        sam2) "$PYTHON" -c 'import sam2' >/dev/null 2>&1 && return 0 ;;
        sam3) "$PYTHON" -c 'import sam3, huggingface_hub' >/dev/null 2>&1 && return 0 ;;
      esac
    fi
  fi

  printf 'Instalando dependências oficiais da família %s. Isso pode demorar...\n' "$FAMILY"
  "$PYTHON" -m pip install --upgrade pip setuptools wheel
  case "$FAMILY" in
    sam1)
      "$PYTHON" -m pip install torch torchvision
      "$PYTHON" -m pip install "https://github.com/facebookresearch/segment-anything/archive/${SAM1_REVISION}.zip"
      "$PYTHON" -m pip install fastapi uvicorn pillow opencv-python-headless numpy
      ;;
    sam2)
      "$PYTHON" -m pip install "torch>=2.5.1" "torchvision>=0.20.1"
      SAM2_BUILD_CUDA=0 "$PYTHON" -m pip install "https://github.com/facebookresearch/sam2/archive/${SAM2_REVISION}.zip"
      "$PYTHON" -m pip install fastapi uvicorn pillow opencv-python-headless numpy
      ;;
    sam3)
      "$PYTHON" -m pip install torch==2.10.0 torchvision --index-url https://download.pytorch.org/whl/cu128
      "$PYTHON" -m pip install "https://github.com/facebookresearch/sam3/archive/${SAM3_REVISION}.zip"
      "$PYTHON" -m pip install fastapi uvicorn pillow "opencv-python-headless<4.12" "numpy<2"
      ;;
  esac
  touch "$ready_file"
}

verify_runtime_device() {
  if [[ "$FAMILY" == "sam3" ]]; then
    "$PYTHON" -c 'import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)' >/dev/null 2>&1 ||
      fail "o PyTorch do SAM 3 não conseguiu usar a GPU NVIDIA. Confirme driver e compatibilidade CUDA 12.6+."
  fi
}

migrate_legacy_vit_b() {
  local legacy_checkpoint="${APP_DIR}/sam_vit_b_01ec64.pth"
  if [[ "$MODEL_ID" != "sam1-vit-b" || -f "$CHECKPOINT" || ! -f "$legacy_checkpoint" ]]; then
    return 0
  fi
  printf 'Instalação ViT-B antiga encontrada; preservando o original e registrando uma cópia no novo layout...\n'
  mkdir -p "$(dirname "$CHECKPOINT")"
  if ln "$legacy_checkpoint" "${CHECKPOINT}.part" 2>/dev/null; then
    mv -f "${CHECKPOINT}.part" "$CHECKPOINT"
  else
    cp "$legacy_checkpoint" "${CHECKPOINT}.part"
    mv -f "${CHECKPOINT}.part" "$CHECKPOINT"
  fi
}

download_sam3_checkpoint() {
  local hf_cli="${VENV_DIR}/bin/hf"
  local staging_dir="${APP_DIR}/downloads/${MODEL_ID}"
  local staged_checkpoint="${staging_dir}/${CHECKPOINT_NAME}"
  [[ -x "$hf_cli" ]] || fail "o comando hf não foi instalado no ambiente do SAM 3."
  printf '\nSAM 3 usa um checkpoint gated da Meta.\n'
  printf 'Solicite acesso em https://huggingface.co/facebook/sam3 e aceite a licença antes de continuar.\n'
  if ! "$hf_cli" auth whoami >/dev/null 2>&1; then
    printf 'A autenticação será feita pelo CLI oficial do Hugging Face; o VisionLabel não lê nem armazena seu token.\n'
    "$hf_cli" auth login || fail "autenticação no Hugging Face não concluída."
  fi
  mkdir -p "$(dirname "$CHECKPOINT")" "$staging_dir"
  if ! "$hf_cli" download facebook/sam3 "$CHECKPOINT_NAME" --local-dir "$staging_dir"; then
    fail "não foi possível baixar o checkpoint gated. Confirme a aprovação de acesso à conta no Hugging Face."
  fi
  [[ -s "$staged_checkpoint" ]] || fail "o Hugging Face não retornou o checkpoint esperado: ${CHECKPOINT_NAME}"
  mv -f "$staged_checkpoint" "${CHECKPOINT}.part"
  mv -f "${CHECKPOINT}.part" "$CHECKPOINT"
}

ensure_checkpoint() {
  migrate_legacy_vit_b
  [[ -f "$CHECKPOINT" ]] && return 0
  printf 'Baixando checkpoint oficial %s...\n' "$CHECKPOINT_NAME"
  if [[ "$FAMILY" == "sam3" ]]; then
    download_sam3_checkpoint
  else
    download_atomic "$CHECKPOINT_URL" "$CHECKPOINT"
  fi
}

save_selection() {
  local partial="${SELECTED_MODEL_FILE}.part"
  printf '%s\n' "$MODEL_ID" >"$partial"
  mv -f "$partial" "$SELECTED_MODEL_FILE"
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
if (( $# > 1 )); then
  usage >&2
  fail "informe no máximo um modelo."
fi

case "$SITE_URL" in
  https://*) ;;
  *) fail "VISIONLABEL_SITE_URL deve usar HTTPS." ;;
esac

if [[ $# -eq 1 ]]; then
  MODEL_ID="$(normalize_model "$1")" || {
    usage >&2
    fail "modelo inválido: $1"
  }
else
  MODEL_ID="$(choose_model)"
fi

set_model_metadata "$MODEL_ID"
check_platform

printf '\n==========================================\n'
printf ' VisionLabel SAM local — %s\n' "$MODEL_ID"
printf '==========================================\n\n'

mkdir -p "$APP_DIR" "$VENVS_DIR" "$MODELS_DIR"
prepare_venv
install_runtime
verify_runtime_device
download_connector
ensure_checkpoint
save_selection

printf '\nModelo %s instalado e selecionado.\n' "$MODEL_ID"
printf 'A seleção foi salva em %s.\n' "$SELECTED_MODEL_FILE"
open_site

if server_is_running; then
  printf '\nJá existe um conector em execução na porta %s.\n' "$PORT"
  printf 'Feche a janela antiga e execute o iniciador novamente para carregar %s.\n' "$MODEL_ID"
  exit 0
fi

printf 'Mantenha este terminal aberto enquanto usar o SAM.\n\n'
run_connector
