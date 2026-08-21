#!/usr/bin/env bash
# Registra o conector local do VisionLabel como serviço de usuário do systemd,
# para que ele suba sozinho no login e nenhum terminal precise ficar aberto.
#
# Uso:
#   bash visionlabel-sam-service-linux.sh install   # cria e inicia o serviço
#   bash visionlabel-sam-service-linux.sh status
#   bash visionlabel-sam-service-linux.sh uninstall
set -euo pipefail

APP_DIR="${HOME}/.visionlabel-sam"
CONNECTOR="${APP_DIR}/visionlabel-sam-local.py"
SELECTED_MODEL_FILE="${APP_DIR}/selected-model.txt"
UNIT_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
UNIT="${UNIT_DIR}/visionlabel-sam.service"
LAUNCHER="${APP_DIR}/bin/visionlabel-sam-service-run.sh"
PORT="7860"
SITE_URL="${VISIONLABEL_SITE_URL:-https://visionlabel-anotador.eduardo1089.chatgpt.site}"

fail() { printf '\nErro: %s\n' "$*" >&2; exit 1; }

command -v systemctl >/dev/null 2>&1 ||
  fail "systemd não encontrado. Use o iniciador comum: visionlabel-sam-start-macos-linux.sh"

case "${1:-install}" in
  status)
    systemctl --user status visionlabel-sam.service --no-pager || true
    exit 0
    ;;
  uninstall)
    systemctl --user disable --now visionlabel-sam.service >/dev/null 2>&1 || true
    rm -f "$UNIT" "$LAUNCHER"
    systemctl --user daemon-reload
    printf 'Serviço removido. O conector deixa de subir sozinho.\n'
    exit 0
    ;;
  install) ;;
  *) fail "argumento inválido: $1 (use install, status ou uninstall)" ;;
esac

[[ -s "$CONNECTOR" ]] ||
  fail "conector ausente em ${CONNECTOR}. Rode o instalador de um modelo antes."
[[ -f "$SELECTED_MODEL_FILE" ]] ||
  fail "nenhum modelo selecionado ainda. Rode o instalador de um modelo antes."

# O launcher resolve o modelo a cada arranque, então trocar de modelo pela web
# continua valendo depois de reiniciar a máquina.
mkdir -p "$(dirname "$LAUNCHER")"
cat >"$LAUNCHER" <<'RUNNER'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${HOME}/.visionlabel-sam"
MODEL_ID="$(tr -d '\r\n' <"${APP_DIR}/selected-model.txt")"
case "$MODEL_ID" in
  sam2.1-hiera-tiny)      FAMILY=sam2; CKPT=sam2.1_hiera_tiny.pt;      CFG=configs/sam2.1/sam2.1_hiera_t.yaml ;;
  sam2.1-hiera-small)     FAMILY=sam2; CKPT=sam2.1_hiera_small.pt;     CFG=configs/sam2.1/sam2.1_hiera_s.yaml ;;
  sam2.1-hiera-base-plus) FAMILY=sam2; CKPT=sam2.1_hiera_base_plus.pt; CFG=configs/sam2.1/sam2.1_hiera_b+.yaml ;;
  sam2.1-hiera-large)     FAMILY=sam2; CKPT=sam2.1_hiera_large.pt;     CFG=configs/sam2.1/sam2.1_hiera_l.yaml ;;
  sam3-concepts)          FAMILY=sam3; CKPT=sam3.pt;                   CFG="" ;;
  *) printf 'selected-model.txt inválido: %s\n' "$MODEL_ID" >&2; exit 1 ;;
esac
args=("${APP_DIR}/visionlabel-sam-local.py" --model "$MODEL_ID"
      --checkpoint "${APP_DIR}/models/${MODEL_ID}/${CKPT}")
[[ -n "$CFG" ]] && args+=(--model-config "$CFG")
args+=(--device auto --port "${VISIONLABEL_PORT:-7860}" --app-dir "$APP_DIR")
exec "${APP_DIR}/venvs/${FAMILY}/bin/python" "${args[@]}"
RUNNER
chmod 700 "$LAUNCHER"

site_origin="${SITE_URL%/}"
mkdir -p "$UNIT_DIR"
cat >"$UNIT" <<UNITFILE
[Unit]
Description=VisionLabel SAM local connector
After=network.target

[Service]
Type=simple
ExecStart=${LAUNCHER}
Environment=VISIONLABEL_ALLOWED_ORIGINS=${site_origin},http://localhost:5173,http://127.0.0.1:5173
Environment=VISIONLABEL_PORT=${PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNITFILE

systemctl --user daemon-reload
systemctl --user enable --now visionlabel-sam.service

printf '\nServiço instalado. O conector sobe sozinho no login e reinicia se falhar.\n'
printf 'Nenhum terminal precisa ficar aberto.\n\n'
printf '  systemctl --user status visionlabel-sam.service\n'
printf '  systemctl --user restart visionlabel-sam.service\n'
printf '  journalctl --user -u visionlabel-sam.service -f\n\n'
printf 'Para que ele suba mesmo sem login gráfico ativo:\n'
printf '  sudo loginctl enable-linger %s\n' "$USER"
