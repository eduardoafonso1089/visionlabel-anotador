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
  niveis: number;
  resolucaoNativa: number;
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
  const [status, setStatus] = useState("Escolha um arquivo COG ou carregue a amostra.");
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    setInfo(null);
    liveRef.current = { ...ZERO };
    setStatus("Lendo cabeçalho do COG…");
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

      const source = new GeoTIFF({
        sources: [typeof origem === "string" ? { url: origem } : { blob: origem }],
        // Sem normalização os valores chegam crus; para TCI de 8 bits o padrão serve.
        interpolate: true,
      });

      source.on("tileloadstart", () => { liveRef.current.tilesPedidos += 1; });
      source.on("tileloadend", () => { liveRef.current.tilesProntos += 1; });
      source.on("tileloaderror", () => { liveRef.current.tilesErro += 1; });

      const viewConfig = await source.getView();
      const resolutions = (viewConfig.resolutions ?? []) as number[];
      const extent = (viewConfig.extent ?? [0, 0, 0, 0]) as number[];
      const nativa = resolutions.length ? resolutions[resolutions.length - 1] : 1;
      const larguraPx = nativa ? Math.round((extent[2] - extent[0]) / nativa) : 0;
      const alturaPx = nativa ? Math.round((extent[3] - extent[1]) / nativa) : 0;

      setInfo({
        origem: typeof origem === "string" ? "amostra remota (Sentinel-2 TCI)" : origem.name,
        projecao: codigoProjecao(viewConfig.projection),
        pixels: `${larguraPx.toLocaleString("pt-BR")} × ${alturaPx.toLocaleString("pt-BR")}`,
        niveis: resolutions.length,
        resolucaoNativa: nativa,
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

      const map = new Map({
        target: hostRef.current!,
        layers: [
          new WebGLTileLayer({ source }),
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
      setStatus("Carregado. Arraste para navegar, roda para zoom, clique para desenhar.");
    } catch (error) {
      setStatus(`Falhou: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  // ?amostra=1 carrega a amostra remota sozinho — serve para demonstração e para medir
  // sem interação. O setTimeout evita setState síncrono dentro do efeito.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("amostra") !== "1") return;
    const id = window.setTimeout(() => void load(SAMPLE), 0);
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

  return <main className="cog">
    <header>
      <h1>Protótipo: COG por tiles na GPU</h1>
      <p>{status}</p>
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
    </header>

    <div className="cog-body">
      <div className="cog-map" ref={hostRef} />
      <aside className="cog-hud">
        <h2>Estrutura</h2>
        {info ? <dl>
          <dt>Origem</dt><dd>{info.origem}</dd>
          <dt>Projeção</dt><dd>{info.projecao}</dd>
          <dt>Pixels</dt><dd>{info.pixels}</dd>
          <dt>Níveis da pirâmide</dt><dd>{info.niveis}</dd>
          <dt>Resolução nativa</dt><dd>{info.resolucaoNativa.toFixed(4)} un/px</dd>
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
