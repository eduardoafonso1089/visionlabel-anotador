#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${HOME}/.epiaka-cog"
VENV_DIR="${APP_DIR}/venv"
CONNECTOR="${APP_DIR}/epiaka-cog-local.py"
READY_FILE="${APP_DIR}/dependencies-v1.ok"
SAIDA_DIR="${APP_DIR}/convertidos"
SITE_URL="https://www.epiaka.com/anotar"

printf '\n==========================================\n'
printf '       Epiaka COG local\n'
printf '==========================================\n'
printf 'Converte GeoTIFF grande para COG na sua maquina.\n'
printf 'Na primeira execucao, a preparacao pode demorar alguns minutos.\n\n'

command -v python3 >/dev/null 2>&1 || {
  printf 'Python 3 nao encontrado. Instale python3 e rode este arquivo de novo.\n'
  exit 1
}

mkdir -p "${APP_DIR}" "${SAIDA_DIR}"

# O conversor vem embutido depois do marcador, para o instalador ser um arquivo so.
awk 'f{print} /^# === EPIAKA_PYTHON ===$/{f=1}' "$0" > "${CONNECTOR}"
[ -s "${CONNECTOR}" ] || { printf 'Nao foi possivel preparar o conversor local.\n'; exit 1; }

[ -x "${VENV_DIR}/bin/python" ] || {
  printf 'Criando ambiente isolado...\n'
  python3 -m venv "${VENV_DIR}"
}
PYTHON="${VENV_DIR}/bin/python"

if [ ! -f "${READY_FILE}" ]; then
  printf 'Instalando rasterio, rio-cogeo e o servidor local. Aguarde...\n'
  "${PYTHON}" -m pip install --upgrade pip
  "${PYTHON}" -m pip install rasterio rio-cogeo fastapi uvicorn python-multipart
  printf 'pronto\n' > "${READY_FILE}"
fi

printf '\nPreparacao concluida. Mantenha este terminal aberto enquanto converte.\n'
printf 'Os arquivos convertidos ficam em %s\n\n' "${SAIDA_DIR}"
(command -v xdg-open >/dev/null 2>&1 && xdg-open "${SITE_URL}" >/dev/null 2>&1) \
  || (command -v open >/dev/null 2>&1 && open "${SITE_URL}" >/dev/null 2>&1) || true

exec "${PYTHON}" "${CONNECTOR}" --porta 7861 --pasta "${SAIDA_DIR}"

# === EPIAKA_PYTHON ===
#!/usr/bin/env python3
"""Conversor local de TIFF para COG do Epiaka.

Converter no navegador não funciona para os arquivos que mais precisam da conversão: o
processo exige ler o raster inteiro e gerar a pirâmide de overviews, e um GeoTIFF de
gigapixels não cabe na memória de uma aba. Medido nesta base: 3 288 MP levaram 11 minutos
e 619 MB de entrada. Aqui isso roda na máquina do usuário, em segundo plano.

O servidor também devolve o COG pronto com suporte a Range, para o Epiaka abrir o
resultado por tiles sem baixar o arquivo de novo.

    python epiaka-cog-local.py
    python epiaka-cog-local.py --porta 7861 --pasta ~/epiaka-cog
"""

from __future__ import annotations

import argparse
import os
import shutil
import tempfile
import threading
import uuid
from pathlib import Path

import rasterio
import uvicorn
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from rio_cogeo.cogeo import cog_translate, cog_validate
from rio_cogeo.profiles import cog_profiles

app = FastAPI(title="Epiaka COG local", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    # Sem isto o navegador não expõe o Content-Range ao geotiff.js, e a leitura por tiles
    # cai para o caminho lento de baixar tudo.
    expose_headers=["Content-Length", "Content-Range", "Accept-Ranges"],
)

PASTA = Path(tempfile.gettempdir()) / "epiaka-cog"
TRABALHOS: dict[str, dict] = {}
TRAVA = threading.Lock()


@app.middleware("http")
async def allow_local_browser_access(request: Request, call_next):
    resposta = await call_next(request)
    # Chrome bloqueia pedidos de uma página pública para 127.0.0.1 sem este cabeçalho.
    resposta.headers["Access-Control-Allow-Private-Network"] = "true"
    resposta.headers["Accept-Ranges"] = "bytes"
    return resposta


@app.get("/")
def root():
    return {"service": "Epiaka COG local", "status": "ready", "pasta": str(PASTA)}


@app.get("/health")
def health():
    with TRAVA:
        rodando = sum(1 for t in TRABALHOS.values() if t["estado"] == "convertendo")
    return {"status": "ready", "convertendo": rodando, "trabalhos": len(TRABALHOS)}


def perfil_para(caminho: Path) -> str:
    """Reencodar JPEG como deflate multiplicaria o tamanho por seis; manter a compressão
    de origem é o que faz a saída caber no mesmo espaço da entrada."""
    with rasterio.open(caminho) as fonte:
        compressao = str(fonte.profile.get("compress") or "").lower()
        bandas = fonte.count
    if compressao == "jpeg" and bandas in (1, 3):
        return "jpeg"
    if compressao in ("webp",):
        return "webp"
    return "deflate"


def converte(identificador: str, entrada: Path, saida: Path) -> None:
    try:
        perfil = perfil_para(entrada)
        with TRAVA:
            TRABALHOS[identificador]["perfil"] = perfil
        config = {"GDAL_NUM_THREADS": "ALL_CPUS", "GDAL_TIFF_OVR_BLOCKSIZE": "512"}
        cog_translate(
            str(entrada), str(saida), cog_profiles.get(perfil),
            overview_resampling="average", config=config, quiet=True, in_memory=False,
        )
        valido, _, _ = cog_validate(str(saida), quiet=True)
        with TRAVA:
            TRABALHOS[identificador].update(
                estado="pronto", valido=bool(valido),
                bytes_saida=saida.stat().st_size,
                url=f"/arquivos/{identificador}",
            )
    except Exception as erro:  # noqa: BLE001 — o motivo precisa chegar ao navegador
        with TRAVA:
            TRABALHOS[identificador].update(estado="erro", detalhe=str(erro)[:500])
    finally:
        entrada.unlink(missing_ok=True)


@app.post("/converter")
async def converter(tarefas: BackgroundTasks, arquivo: UploadFile):
    nome = Path(arquivo.filename or "entrada.tif").name
    if not nome.lower().endswith((".tif", ".tiff")):
        raise HTTPException(status_code=400, detail="Envie um arquivo .tif ou .tiff.")

    identificador = uuid.uuid4().hex[:12]
    PASTA.mkdir(parents=True, exist_ok=True)
    entrada = PASTA / f"{identificador}-entrada.tif"
    saida = PASTA / f"{identificador}.tif"

    # Em disco, não em memória: o upload pode ter centenas de megabytes.
    with entrada.open("wb") as destino:
        while pedaco := await arquivo.read(8 * 1024 * 1024):
            destino.write(pedaco)

    try:
        with rasterio.open(entrada) as fonte:
            largura, altura, bandas = fonte.width, fonte.height, fonte.count
    except Exception as erro:  # noqa: BLE001
        entrada.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Não é um GeoTIFF legível: {erro}") from erro

    with TRAVA:
        TRABALHOS[identificador] = {
            "id": identificador, "nome": nome, "estado": "convertendo",
            "pixels": [largura, altura], "bandas": bandas,
            "megapixels": round(largura * altura / 1e6, 1),
            "bytes_entrada": entrada.stat().st_size,
        }
    tarefas.add_task(converte, identificador, entrada, saida)
    with TRAVA:
        return JSONResponse(TRABALHOS[identificador], status_code=202)


@app.get("/trabalhos/{identificador}")
def trabalho(identificador: str):
    with TRAVA:
        dados = TRABALHOS.get(identificador)
    if not dados:
        raise HTTPException(status_code=404, detail="Trabalho desconhecido.")
    return dados


@app.get("/arquivos/{identificador}")
def arquivo_pronto(identificador: str):
    caminho = PASTA / f"{identificador}.tif"
    if not caminho.exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    # FileResponse já responde a Range, que é o que permite ler o COG por tiles.
    return FileResponse(caminho, media_type="image/tiff", filename=f"{identificador}.tif")


@app.delete("/arquivos/{identificador}")
def descarta(identificador: str):
    caminho = PASTA / f"{identificador}.tif"
    caminho.unlink(missing_ok=True)
    with TRAVA:
        TRABALHOS.pop(identificador, None)
    return {"removido": identificador}


def main() -> None:
    global PASTA
    parser = argparse.ArgumentParser(description="Conversor local de TIFF para COG do Epiaka")
    parser.add_argument("--porta", type=int, default=7861)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--pasta", default=str(PASTA),
                        help="onde guardar os COGs convertidos")
    argumentos = parser.parse_args()
    PASTA = Path(os.path.expanduser(argumentos.pasta))
    PASTA.mkdir(parents=True, exist_ok=True)
    livre = shutil.disk_usage(PASTA).free / 1024 ** 3
    print(f"Epiaka COG local em http://{argumentos.host}:{argumentos.porta}")
    print(f"Convertidos vão para {PASTA} ({livre:.1f} GB livres)")
    uvicorn.run(app, host=argumentos.host, port=argumentos.porta, log_level="warning")


if __name__ == "__main__":
    main()
