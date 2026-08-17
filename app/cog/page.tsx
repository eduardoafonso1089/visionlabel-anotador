"use client";

// Protótipo isolado para avaliar viabilidade de renderizar imagens enormes por tiles na
// GPU. Não toca no anotador. O fluxo é o pedido: o usuário escolhe um COG e a partir dele
// só os tiles do nível de zoom visível são lidos.
//
// OpenLayers é browser-only, então tudo entra por import() dentro do efeito.

import { useCallback, useEffect, useRef, useState } from "react";

const SAMPLE = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/Q/WD/2020/7/S2A_36QWD_20200701_0_L2A/TCI.tif";

type Info = {
  origem: string;
  projecao: string;
  pixels: string;
  tile: string;
  niveis: number;
  niveisView: number;
  bandas: string;
  resolucaoNativa: string;
  ehCog: string;
};

type Live = {
  tilesPedidos: number;
  tilesProntos: number;
  tilesErro: number;
  requisicoes: number;
  bytes: number;
  escala: string;
  ponteiro: string;
  vertices: number;
};

type Falha = { titulo: string; detalhe: string; dica?: string };

const LIMITE_MS = 30_000;

// Lê só os 4 primeiros bytes. Serve para os dois caminhos: um File dá slice, uma URL
// dá range request. É a checagem mais barata que existe e evita entregar lixo ao leitor.
async function primeirosBytes(origem: File | string) {
  if (typeof origem !== "string") {
    return new Uint8Array(await origem.slice(0, 4).arrayBuffer());
  }
  const resposta = await fetch(origem, { headers: { Range: "bytes=0-3" } });
  if (!resposta.ok) throw new Error(`O servidor respondeu HTTP ${resposta.status}.`);
  return new Uint8Array(await resposta.arrayBuffer());
}

// II* ou MM* no começo do arquivo. Sem isso não é TIFF, e insistir só faz o leitor
// travar interpretando bytes aleatórios — foi o que acontecia com o HTML de fallback
// que o servidor devolve, com status 200, para um caminho inexistente.
function assinaturaTiff(bytes: Uint8Array) {
  if (bytes.length < 4) return null;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!little && !big) return null;
  const magic = little ? bytes[2] | (bytes[3] << 8) : (bytes[2] << 8) | bytes[3];
  return magic === 42 ? "TIFF" : magic === 43 ? "BigTIFF" : null;
}

// Nenhuma etapa pode ficar pendurada para sempre: uma barra girando sem fim é pior
// que um erro claro.
function comLimite<T>(promessa: Promise<T>, etapa: string) {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(
      () => reject(new Error(`Tempo esgotado (${LIMITE_MS / 1000}s) em: ${etapa}`)), LIMITE_MS);
    promessa.then(
      (valor) => { window.clearTimeout(id); resolve(valor); },
      (erro) => { window.clearTimeout(id); reject(erro); });
  });
}

// Traduz a exceção crua num diagnóstico útil. O objetivo é o cliente saber o que
// fazer com o arquivo dele, não só que "falhou".
function diagnostica(error: unknown, origem: File | string): Falha {
  const bruto = error instanceof Error ? error.message : String(error);
  const nome = typeof origem === "string" ? origem : origem.name;
  const baixo = bruto.toLowerCase();

  const http = bruto.match(/HTTP (\d{3})/);
  if (http) {
    const codigo = http[1];
    return {
      titulo: codigo === "404" ? "O arquivo não foi encontrado no endereço informado"
        : codigo === "403" ? "Sem permissão para ler este arquivo"
        : `O servidor recusou o pedido (HTTP ${codigo})`,
      detalhe: bruto,
      dica: codigo === "404" ? "Confira o caminho. Se for um arquivo local, use o botão de escolher arquivo."
        : "O arquivo precisa ser público e permitir range requests (Accept-Ranges: bytes).",
    };
  }
  if (/failed to fetch|networkerror|load failed/.test(baixo)) {
    return {
      titulo: "Não foi possível baixar o arquivo",
      detalhe: bruto,
      dica: "Verifique o endereço e se o servidor libera CORS e range requests (Accept-Ranges: bytes).",
    };
  }
  if (/tempo esgotado/.test(baixo)) {
    return {
      titulo: "O arquivo não respondeu em tempo",
      detalhe: bruto,
      dica: "Pode ser um arquivo sem tiles internos, uma rede lenta, ou um endereço que "
        + "devolve outra coisa em vez do TIFF.",
    };
  }
  if (/não são de um tiff|not a tiff|invalid tiff|unexpected magic|endianness/.test(baixo)) {
    return {
      titulo: "Este arquivo não é um TIFF",
      detalhe: bruto,
      dica: `${nome} não começa com a assinatura TIFF. Converta com: `
        + "gdal_translate -of COG entrada.ext saida.tif",
    };
  }
  if (/projection|crs|epsg|no geo/.test(baixo)) {
    return {
      titulo: "O arquivo não tem georreferenciamento utilizável",
      detalhe: bruto,
      dica: "Um COG precisa de CRS e ModelPixelScale. Reprojete com: gdalwarp -t_srs EPSG:4326",
    };
  }
  if (/out of memory|allocation/.test(baixo)) {
    return {
      titulo: "Memória insuficiente para este arquivo",
      detalhe: bruto,
      dica: "Sem tiles internos o leitor precisa carregar faixas inteiras. Gere um COG com overviews.",
    };
  }
  return {
    titulo: "Não foi possível carregar a imagem",
    detalhe: bruto,
    dica: "Confirme que é um GeoTIFF tiled. Valide com: rio cogeo validate arquivo.tif",
  };
}

const ZERO: Live = {
  tilesPedidos: 0, tilesProntos: 0, tilesErro: 0, requisicoes: 0, bytes: 0,
  escala: "—", ponteiro: "—", vertices: 0,
};

// viewConfig.projection pode ser string ou objeto Projection do OpenLayers.
function codigoProjecao(value: unknown) {
  if (!value) return "—";
  if (typeof value === "string") return value;
  const withCode = value as { getCode?: () => string };
  return typeof withCode.getCode === "function" ? withCode.getCode() : String(value);
}

function mb(bytes: number) {
  return bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
}

export default function CogPrototype() {
  const hostRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const liveRef = useRef<Live>({ ...ZERO });
  const [live, setLive] = useState<Live>({ ...ZERO });
  const [info, setInfo] = useState<Info | null>(null);
  const [fase, setFase] = useState<"vazio" | "lendo" | "pronto" | "erro">("vazio");
  const [etapa, setEtapa] = useState("");
  const [falha, setFalha] = useState<Falha | null>(null);
  const busy = fase === "lendo";
  const [mode, setMode] = useState<"desenhar" | "editar">("desenhar");
  const modeRef = useRef(mode);

  // O HUD é atualizado por um relógio, não a cada evento de tile: com centenas de tiles
  // um setState por evento afogaria o render e falsearia a medição.
  useEffect(() => {
    const id = window.setInterval(() => setLive({ ...liveRef.current }), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => cleanupRef.current?.(), []);

  const load = useCallback(async (origem: File | string) => {
    setFase("lendo");
    setFalha(null);
    setInfo(null);
    liveRef.current = { ...ZERO };
    setEtapa("Carregando a biblioteca de mapa…");
    cleanupRef.current?.();

    try {
      const [
        { default: Map }, { default: View }, { default: WebGLTileLayer },
        { default: GeoTIFF }, { default: VectorLayer }, { default: VectorSource },
        { default: Draw }, { default: Modify }, { default: Snap },
        { Style, Stroke, Fill, Circle: CircleStyle },
      ] = await Promise.all([
        import("ol/Map.js"), import("ol/View.js"), import("ol/layer/WebGLTile.js"),
        import("ol/source/GeoTIFF.js"), import("ol/layer/Vector.js"), import("ol/source/Vector.js"),
        import("ol/interaction/Draw.js"), import("ol/interaction/Modify.js"), import("ol/interaction/Snap.js"),
        import("ol/style.js"),
      ]);

      // Conta o tráfego real. Só vale para a amostra remota: com arquivo local o
      // geotiff.js fatia o Blob em memória, sem passar por fetch.
      const nativeFetch = window.fetch;
      const remoto = typeof origem === "string";
      if (remoto) {
        window.fetch = async (...args) => {
          const response = await nativeFetch(...args);
          liveRef.current.requisicoes += 1;
          const length = Number(response.headers.get("content-length") ?? 0);
          if (Number.isFinite(length)) liveRef.current.bytes += length;
          return response;
        };
      }

      setEtapa("Verificando a assinatura do arquivo…");
      const tipoArquivo = assinaturaTiff(await comLimite(primeirosBytes(origem), "leitura inicial"));
      if (!tipoArquivo) {
        throw new Error("Os primeiros bytes não são de um TIFF: esperado II* ou MM*.");
      }

      // Os metadados vêm antes da fonte do OpenLayers, porque duas decisões dependem
      // deles: o valor de nodata e, quando há só uma banda, a rampa de cor. Também é
      // daqui que saem as dimensões: sem overviews o OpenLayers sintetiza níveis extra
      // e o "mais fino" deixa de ser a resolução nativa — foi assim que um arquivo de
      // 4096² apareceu como 8192².
      setEtapa("Lendo o cabeçalho e a pirâmide de overviews…");
      const { fromBlob, fromUrl } = await import("geotiff");
      const tiff = await comLimite(
        typeof origem === "string" ? fromUrl(origem) : fromBlob(origem), "abertura do TIFF");
      const imagem = await comLimite(tiff.getImage(0), "leitura dos metadados");
      const totalImagens = await tiff.getImageCount();
      const bandas = imagem.getSamplesPerPixel();
      const semDado = imagem.getGDALNoData();

      // Uma banda só (elevação, NDVI, térmico, máscara) não tem mapeamento para RGB:
      // sem uma rampa explícita o WebGLTile pinta tudo preto, porque interpreta a
      // altitude em metros como componente de cor de 0 a 255.
      let faixa: { min: number; max: number } | null = null;
      if (bandas === 1) {
        setEtapa("Medindo a faixa de valores da banda…");
        const grossa = await comLimite(tiff.getImage(totalImagens - 1), "leitura do overview");
        const rasters = await comLimite(grossa.readRasters(), "amostragem de valores");
        const amostra = (rasters as unknown as Array<ArrayLike<number>>)[0];
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < amostra.length; i += 1) {
          const valor = amostra[i];
          if (!Number.isFinite(valor) || valor === semDado) continue;
          if (valor < min) min = valor;
          if (valor > max) max = valor;
        }
        faixa = Number.isFinite(min) && max > min ? { min, max } : { min: 0, max: 255 };
      }

      const fonteBase = typeof origem === "string" ? { url: origem } : { blob: origem };
      const source = new GeoTIFF({
        sources: [semDado !== null ? { ...fonteBase, nodata: semDado } : fonteBase],
        interpolate: true,
        // Por padrão o OpenLayers reescala os valores para 0–1, o que desfaz a relação
        // com a unidade real. Para a rampa de uma banda usar metros de altitude, a
        // normalização precisa sair do caminho.
        ...(faixa ? { normalize: false } : {}),
      });

      source.on("tileloadstart", () => { liveRef.current.tilesPedidos += 1; });
      source.on("tileloadend", () => { liveRef.current.tilesProntos += 1; });
      source.on("tileloaderror", () => { liveRef.current.tilesErro += 1; });

      setEtapa("Montando o sistema de coordenadas…");
      const viewConfig = await comLimite(source.getView(), "leitura da pirâmide");
      const resolutions = (viewConfig.resolutions ?? []) as number[];
      // Num TIFF por faixas o geotiff.js devolve a largura da imagem como "tile", então
      // getTileWidth() não distingue tiled de striped. A flag isTiled sim: ela vale false
      // quando o arquivo tem StripOffsets em vez de TileWidth.
      const realmenteTiled = Boolean((imagem as unknown as { isTiled?: boolean }).isTiled);
      const larguraTile = imagem.getTileWidth();
      const alturaTile = imagem.getTileHeight();
      const [escalaX] = imagem.getResolution() as number[];
      // Resolução nativa autoritativa: vem do ModelPixelScale do TIFF.
      const nativa = Math.abs(escalaX);

      setInfo({
        origem: origem === SAMPLE ? "amostra remota (Sentinel-2 TCI)"
          : typeof origem === "string" ? origem : origem.name,
        projecao: codigoProjecao(viewConfig.projection),
        pixels: `${imagem.getWidth().toLocaleString("pt-BR")} × ${imagem.getHeight().toLocaleString("pt-BR")}`,
        tile: `${larguraTile} × ${alturaTile}`,
        niveis: Math.max(0, totalImagens - 1),
        niveisView: resolutions.length,
        bandas: bandas === 1
          ? `1 (faixa ${faixa ? `${faixa.min.toFixed(0)}–${faixa.max.toFixed(0)}` : "?"}${semDado !== null ? `, nodata ${semDado}` : ""})`
          : `${bandas}${semDado !== null ? `, nodata ${semDado}` : ""}`,
        resolucaoNativa: `${Math.abs(escalaX).toFixed(4)} un/px`,
        // Sem tiles internos o geotiff.js precisa ler faixas inteiras: funciona, mas
        // transfere muito mais do que o necessário.
        ehCog: realmenteTiled && totalImagens > 1 ? "sim"
          : realmenteTiled ? "tiled, sem overviews" : "não — por faixas",
      });

      const desenhos = new VectorSource();
      const estilo = new Style({
        stroke: new Stroke({ color: "#44C995", width: 2.5 }),
        fill: new Fill({ color: "rgba(68,201,149,0.18)" }),
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: "#FFFFFF" }),
          stroke: new Stroke({ color: "#44C995", width: 2 }),
        }),
      });

      setEtapa("Pedindo os primeiros tiles…");
      const map = new Map({
        target: hostRef.current!,
        layers: [
          // Com uma banda, a rampa mapeia a faixa medida para tons legíveis; com três,
          // o padrão do OpenLayers já trata como RGB.
          new WebGLTileLayer({
            source,
            ...(faixa ? {
              style: {
                color: ["interpolate", ["linear"], ["band", 1],
                  faixa.min, [16, 22, 19],
                  (faixa.min + faixa.max) / 2, [104, 148, 124],
                  faixa.max, [242, 246, 243]],
              },
            } : {}),
          }),
          new VectorLayer({ source: desenhos, style: estilo }),
        ],
        view: new View(viewConfig),
      });

      const draw = new Draw({ source: desenhos, type: "Polygon", style: estilo });
      const modify = new Modify({ source: desenhos, style: estilo });
      const snap = new Snap({ source: desenhos });
      map.addInteraction(modify);
      map.addInteraction(snap);
      if (modeRef.current === "desenhar") map.addInteraction(draw);

      const contaVertices = () => {
        let total = 0;
        for (const feature of desenhos.getFeatures()) {
          const geometry = feature.getGeometry() as { getCoordinates?: () => number[][][] } | null;
          const rings = geometry?.getCoordinates?.();
          if (rings?.[0]) total += Math.max(0, rings[0].length - 1);
        }
        liveRef.current.vertices = total;
      };
      desenhos.on("addfeature", contaVertices);
      desenhos.on("changefeature", contaVertices);

      const onMove = (event: { coordinate: number[] }) => {
        const [x, y] = event.coordinate;
        liveRef.current.ponteiro = `${x.toFixed(1)}, ${y.toFixed(1)}`;
      };
      map.on("pointermove", onMove);

      const onView = () => {
        const atual = map.getView().getResolution() ?? 0;
        const fator = nativa ? atual / nativa : 0;
        liveRef.current.escala = fator
          ? `1 px de tela = ${fator.toFixed(2)} px da imagem`
          : "—";
      };
      map.on("moveend", onView);
      map.once("rendercomplete", onView);

      if (new URLSearchParams(window.location.search).get("nativo") === "1") {
        map.getView().setResolution(nativa);
      }

      cleanupRef.current = () => {
        window.fetch = nativeFetch;
        map.setTarget(undefined);
        map.dispose();
      };

      (window as unknown as { __cogMap?: unknown }).__cogMap = map;
      setFase("pronto");
      setEtapa("");
    } catch (error) {
      setFalha(diagnostica(error, origem));
      setFase("erro");
      setEtapa("");
      cleanupRef.current?.();
      cleanupRef.current = null;
    }
  }, []);

  // Carga automática por parâmetro, para demonstrar e medir sem interação:
  //   ?amostra=1   a amostra remota do Sentinel-2
  //   ?url=X       qualquer COG por HTTP, exercitando range requests
  //   ?blob=X      baixa X inteiro e entrega como Blob, exercitando o mesmo
  //                caminho de um arquivo escolhido no disco
  // O setTimeout evita setState síncrono dentro do efeito.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const blob = params.get("blob");
    const url = params.get("url");
    const alvo = params.get("amostra") === "1" ? SAMPLE : url;
    if (!blob && !alvo) return;
    const id = window.setTimeout(() => {
      if (blob) {
        void fetch(blob)
          .then((response) => response.blob())
          .then((body) => load(new File([body], blob.split("/").pop() || "local.tif")))
          .catch((error) => {
            setFalha(diagnostica(error, blob));
            setFase("erro");
          });
      } else if (alvo) {
        void load(alvo);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  // Alterna desenhar/editar sem recriar o mapa.
  useEffect(() => {
    modeRef.current = mode;
    const map = (window as unknown as { __cogMap?: { getInteractions: () => { getArray: () => Array<{ constructor: { name: string }; setActive: (v: boolean) => void }> } } }).__cogMap;
    for (const interaction of map?.getInteractions().getArray() ?? []) {
      if (interaction.constructor.name === "Draw") interaction.setActive(mode === "desenhar");
    }
  }, [mode]);

  const pendentes = Math.max(0, live.tilesPedidos - live.tilesProntos - live.tilesErro);
  const pct = live.tilesPedidos
    ? Math.round((live.tilesProntos + live.tilesErro) / live.tilesPedidos * 100)
    : 0;

  return <main className="cog">
    <header>
      <h1>Protótipo: COG por tiles na GPU</h1>
      <p>{
        fase === "lendo" ? etapa
          : fase === "pronto" ? "Arraste para navegar, roda para zoom, clique para desenhar."
          : fase === "erro" ? "Escolha outro arquivo ou corrija o atual."
          : "Escolha um arquivo COG ou carregue a amostra."
      }</p>

      {/* Duas barras porque só uma das fases é mensurável: ler o cabeçalho não expõe
          progresso, então ali a barra é indeterminada; os tiles têm contagem. */}
      {fase === "lendo" && <div className="cog-progress indeterminada" role="progressbar"
        aria-label="Lendo o arquivo"><i /></div>}
      {fase === "pronto" && pendentes > 0 && <div className="cog-progress" role="progressbar"
        aria-label="Carregando tiles" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${pct}%` }} />
        <b>{live.tilesProntos} / {live.tilesPedidos} tiles</b>
      </div>}

      <div className="cog-actions">
        <label className="cog-file">
          <input type="file" accept=".tif,.tiff,image/tiff" disabled={busy}
            onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void load(file); }} />
          <span>Escolher COG local…</span>
        </label>
        <button disabled={busy} onClick={() => void load(SAMPLE)}>Carregar amostra remota</button>
        {info && <div className="cog-modes">
          <button className={mode === "desenhar" ? "on" : ""} onClick={() => setMode("desenhar")}>Desenhar</button>
          <button className={mode === "editar" ? "on" : ""} onClick={() => setMode("editar")}>Editar</button>
        </div>}
      </div>
      {falha && <div className="cog-erro" role="alert">
        <span aria-hidden="true">!</span>
        <div>
          <b>{falha.titulo}</b>
          <p className="cog-erro-detalhe">{falha.detalhe}</p>
          {falha.dica && <p className="cog-erro-dica">{falha.dica}</p>}
        </div>
      </div>}

      {/* Carregou, mas não é um COG de verdade: não é erro, é o motivo da lentidão. */}
      {fase === "pronto" && info && info.ehCog !== "sim" && <div className="cog-aviso" role="status">
        <span aria-hidden="true">i</span>
        <div>
          <b>Funciona, mas este arquivo não é um COG completo: {info.ehCog}</b>
          <p>Sem tiles internos ou sem overviews o leitor precisa transferir muito mais
            do que o necessário. Converta com <code>rio cogeo create entrada.tif saida.tif</code>.</p>
        </div>
      </div>}
    </header>

    <div className="cog-body">
      <div className="cog-map" ref={hostRef} />
      <aside className="cog-hud">
        <h2>Estrutura</h2>
        {info ? <dl>
          <dt>Origem</dt><dd>{info.origem}</dd>
          <dt>Projeção</dt><dd>{info.projecao}</dd>
          <dt>Pixels</dt><dd>{info.pixels}</dd>
          <dt>Tile interno</dt><dd>{info.tile}</dd>
          <dt>Bandas</dt><dd>{info.bandas}</dd>
          <dt>Overviews</dt><dd>{info.niveis}</dd>
          <dt>Níveis na view</dt><dd>{info.niveisView}</dd>
          <dt>Resolução nativa</dt><dd>{info.resolucaoNativa}</dd>
          <dt>Perfil COG</dt><dd className={info.ehCog === "sim" ? "" : "cog-bad"}>{info.ehCog}</dd>
        </dl> : <p className="cog-empty">Sem arquivo.</p>}

        <h2>Ao vivo</h2>
        <dl>
          <dt>Tiles pedidos</dt><dd>{live.tilesPedidos}</dd>
          <dt>Tiles prontos</dt><dd>{live.tilesProntos}</dd>
          <dt>Tiles com erro</dt><dd className={live.tilesErro ? "cog-bad" : ""}>{live.tilesErro}</dd>
          <dt>Requisições HTTP</dt><dd>{live.requisicoes || "—"}</dd>
          <dt>Bytes transferidos</dt><dd>{live.bytes ? mb(live.bytes) : "—"}</dd>
          <dt>Escala</dt><dd>{live.escala}</dd>
          <dt>Ponteiro</dt><dd>{live.ponteiro}</dd>
          <dt>Vértices desenhados</dt><dd>{live.vertices}</dd>
        </dl>
        <p className="cog-note">
          Bytes e requisições contam só a amostra remota. Com arquivo local o geotiff.js
          fatia o Blob em memória, sem passar por rede.
        </p>
      </aside>
    </div>
  </main>;
}
