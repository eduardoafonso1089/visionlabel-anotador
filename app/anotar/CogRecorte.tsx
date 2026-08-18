"use client";

// Passo de recorte para arquivos COG/GeoTIFF dentro do anotador.
//
// O anotador não consegue — e não deve — abrir um raster de gigapixels: o navegador não
// decodifica TIFF e o bitmap não caberia na memória. Aqui o arquivo é lido por tiles, só
// para o usuário escolher onde quer trabalhar; o que sai é um PNG limitado que entra na
// lista de imagens como qualquer outra. Assim todas as ferramentas já existentes, e o SAM
// junto, funcionam sem saber que o recorte veio de um COG.
//
// OpenLayers é browser-only, então entra por import() dentro do efeito.

import { useCallback, useEffect, useRef, useState } from "react";
import type OlMapa from "ol/Map.js";
import type OlDesenho from "ol/interaction/Draw.js";
import { dimensionaRecorte, ehArquivoTiff, geraRecorte, leMetadados, medeFaixa } from "../lib/cog";
import type { MetadadosCog, Recorte } from "../lib/cog";
import { fill } from "../lib/i18n";
import type { Copy } from "../lib/i18n";

type Modo = "visivel" | "retangulo";

type Janela = { x: number; y: number; w: number; h: number };

export type CogRecorteProps = {
  origem: File | string;
  nome: string;
  copy: Copy;
  onCancelar: () => void;
  onPronto: (recorte: Recorte, nome: string) => void;
};

const LIMITE_MS = 45_000;

/** Porta do helper local de conversão. O do SAM usa a 7860; esta é a vizinha. */
const CONVERSOR_PADRAO = "http://127.0.0.1:7861";
const CHAVE_CONVERSOR = "epiaka-cog-endpoint";

/** Taxas medidas nesta base com `rio cogeo create`: deflate sustenta 20–25 MP/s e JPEG
 *  cai de 7 para 5 conforme o arquivo cresce. A estimativa é deliberadamente pessimista:
 *  errar para mais irrita menos do que uma barra que estoura o prazo. */
function estimaMinutos(megapixels: number) {
  return Math.max(1, Math.ceil(megapixels / 5 / 60));
}

type Trabalho = {
  id: string;
  estado: "convertendo" | "pronto" | "erro";
  megapixels?: number;
  bytes_saida?: number;
  valido?: boolean;
  detalhe?: string;
  url?: string;
};

function comLimite<T>(promessa: Promise<T>, etapa: string) {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(
      () => reject(new Error(`Tempo esgotado (${LIMITE_MS / 1000}s) em: ${etapa}`)), LIMITE_MS);
    promessa.then(
      (valor) => { window.clearTimeout(id); resolve(valor); },
      (erro) => { window.clearTimeout(id); reject(erro); });
  });
}

/** Matriz BT.601 de faixa cheia. Ortofoto de drone quase sempre chega como JPEG com
 *  photometric=YCbCr, e o decodificador do geotiff.js entrega Y, Cb e Cr crus nos três
 *  canais quando lido por readRasters — que é o caminho do WebGLTile. Sem isto, grama
 *  sai rosa. A conversão custa zero por ir no shader. */
function corDeYCbCr() {
  const y = ["band", 1];
  const cb = ["-", ["band", 2], 128];
  const cr = ["-", ["band", 3], 128];
  return ["color",
    ["+", y, ["*", cr, 1.402]],
    ["+", y, ["*", cb, -0.344136], ["*", cr, -0.714136]],
    ["+", y, ["*", cb, 1.772]],
  ];
}

function inteiro(valor: number) {
  return Math.round(valor).toLocaleString("pt-BR");
}

export default function CogRecorte({ origem, nome, copy, onCancelar, onPronto }: CogRecorteProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const limpaRef = useRef<(() => void) | null>(null);
  const mapaRef = useRef<OlMapa | null>(null);
  const desenhoRef = useRef<OlDesenho | null>(null);
  const metaRef = useRef<MetadadosCog | null>(null);
  const faixaRef = useRef<{ min: number; max: number } | null>(null);
  const caixaRef = useRef<Janela | null>(null);
  const modoRef = useRef<Modo>("visivel");

  const [meta, setMeta] = useState<MetadadosCog | null>(null);
  const [fase, setFase] = useState<"lendo" | "pronto" | "erro">("lendo");
  const [etapa, setEtapa] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("visivel");
  const [janela, setJanela] = useState<Janela | null>(null);
  const [gerando, setGerando] = useState(false);
  // A fonte pode trocar no meio da sessão: converter para COG substitui o File pelo
  // endereço servido pelo helper, e o visualizador remonta em cima dele.
  const [fonte, setFonte] = useState<File | string>(origem);
  const [conversor, setConversor] = useState<"desconhecido" | "ativo" | "ausente">("desconhecido");
  const [conversao, setConversao] = useState<Trabalho | null>(null);
  const [segundos, setSegundos] = useState(0);
  const endpoint = typeof window === "undefined"
    ? CONVERSOR_PADRAO
    : localStorage.getItem(CHAVE_CONVERSOR) || CONVERSOR_PADRAO;

  // Extent do mapa → janela em pixel do arquivo. É a única conversão que este componente
  // precisa fazer sozinho; o resto vive em lib/cog.
  const janelaDe = useCallback((extent: number[]): Janela | null => {
    const m = metaRef.current;
    if (!m) return null;
    const x0 = Math.max(0, (extent[0] - m.origemX) / m.escalaX);
    const x1 = Math.min(m.largura, (extent[2] - m.origemX) / m.escalaX);
    const y0 = Math.max(0, (m.origemY - extent[3]) / m.escalaY);
    const y1 = Math.min(m.altura, (m.origemY - extent[1]) / m.escalaY);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, []);

  const atualizaJanela = useCallback(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;
    if (modoRef.current === "retangulo") {
      setJanela(caixaRef.current);
      return;
    }
    const tamanho = mapa.getSize();
    if (!tamanho) return;
    setJanela(janelaDe(mapa.getView().calculateExtent(tamanho)));
  }, [janelaDe]);

  useEffect(() => () => limpaRef.current?.(), []);

  useEffect(() => {
    let cancelado = false;
    // Trocar de fonte remonta o mapa; sem descartar o anterior sobram dois canvas e dois
    // laços de render disputando a mesma div.
    limpaRef.current?.();
    limpaRef.current = null;
    (async () => {
      try {
        setEtapa(copy.cogStepLibrary);
        const [
          { default: MapaOl }, { default: View }, { default: WebGLTileLayer },
          { default: GeoTIFF }, { default: VectorLayer }, { default: VectorSource },
          { default: Draw, createBox }, { Style, Stroke, Fill }, { always },
        ] = await Promise.all([
          import("ol/Map.js"), import("ol/View.js"), import("ol/layer/WebGLTile.js"),
          import("ol/source/GeoTIFF.js"), import("ol/layer/Vector.js"), import("ol/source/Vector.js"),
          import("ol/interaction/Draw.js"), import("ol/style.js"), import("ol/events/condition.js"),
        ]);

        setEtapa(copy.cogStepHeader);
        const dados = await comLimite(leMetadados(fonte), copy.cogStepHeader);
        if (cancelado) return;
        metaRef.current = dados;
        setMeta(dados);

        // Uma banda só (elevação, NDVI, máscara) não tem mapeamento para RGB: sem uma
        // rampa explícita o WebGLTile pinta tudo preto, porque lê altitude em metros como
        // componente de cor de 0 a 255. A faixa medida aqui vale para a prévia e para o
        // recorte, senão o usuário anota uma imagem e recebe outra.
        let faixa: { min: number; max: number } | null = null;
        if (dados.bandas === 1) {
          setEtapa(copy.cogStepBand);
          // O último nível é o overview mais grosso; ler dele custa poucos KB.
          const grossa = await dados.tiff.getImage(dados.niveis[dados.niveis.length - 1]);
          const rasters = await comLimite(grossa.readRasters(), copy.cogStepBand) as unknown as Array<ArrayLike<number>>;
          faixa = medeFaixa(rasters[0], dados.semDado);
          faixaRef.current = faixa;
        }

        const diretorio = (await dados.tiff.getImage(0) as unknown as {
          fileDirectory?: { getValue?: (nome: string) => unknown } & Record<string, unknown>;
        }).fileDirectory;
        const photometric = typeof diretorio?.getValue === "function"
          ? diretorio.getValue("PhotometricInterpretation")
          : diretorio?.PhotometricInterpretation;
        const ycbcr = dados.bandas === 3 && photometric === 6;

        const base = typeof fonte === "string" ? { url: fonte } : { blob: fonte };
        const source = new GeoTIFF({
          sources: [dados.semDado !== null ? { ...base, nodata: dados.semDado } : base],
          interpolate: true,
          // A normalização padrão reescala tudo para 0–1 e desfaz a relação com a unidade
          // real, que a rampa e a matriz YCbCr precisam manter.
          ...(faixa || ycbcr ? { normalize: false } : {}),
        });

        setEtapa(copy.cogStepTiles);
        const viewConfig = await comLimite(source.getView(), copy.cogStepTiles);
        if (cancelado) return;

        const selecao = new VectorSource();
        const estilo = new Style({
          stroke: new Stroke({ color: "#44C995", width: 2.5 }),
          fill: new Fill({ color: "rgba(68,201,149,0.14)" }),
        });

        const mapa = new MapaOl({
          target: hostRef.current!,
          layers: [
            new WebGLTileLayer({
              source,
              ...(faixa ? {
                style: {
                  color: ["interpolate", ["linear"], ["band", 1],
                    faixa.min, [16, 22, 19],
                    (faixa.min + faixa.max) / 2, [104, 148, 124],
                    faixa.max, [242, 246, 243]],
                },
              } : ycbcr ? { style: { color: corDeYCbCr() } } : {}),
            }),
            new VectorLayer({ source: selecao, style: estilo }),
          ],
          view: new View(viewConfig),
        });
        mapaRef.current = mapa;

        // Caixa por arrasto. O padrão do OpenLayers pede dois cliques e deixa o arraste
        // para o pan; aqui é o contrário do que se espera de uma seleção de recorte, e o
        // usuário já enquadrou a região no modo "área visível" antes de chegar aqui.
        const desenho = new Draw({
          source: selecao, type: "Circle", geometryFunction: createBox(),
          style: estilo, freehandCondition: always,
        });
        desenho.on("drawstart", () => selecao.clear());
        desenho.on("drawend", (evento) => {
          const extent = evento.feature.getGeometry()?.getExtent();
          if (extent) {
            caixaRef.current = janelaDe(extent);
            setJanela(caixaRef.current);
          }
        });
        desenho.setActive(false);
        mapa.addInteraction(desenho);
        desenhoRef.current = desenho;

        mapa.on("moveend", atualizaJanela);
        mapa.once("rendercomplete", atualizaJanela);

        limpaRef.current = () => {
          mapaRef.current = null;
          desenhoRef.current = null;
          mapa.setTarget(undefined);
          mapa.dispose();
        };
        setFase("pronto");
        setEtapa("");
      } catch (falha) {
        if (cancelado) return;
        setErro(falha instanceof Error ? falha.message : String(falha));
        setFase("erro");
      }
    })();
    return () => { cancelado = true; };
  }, [fonte, copy, janelaDe, atualizaJanela]);

  useEffect(() => {
    modoRef.current = modo;
    desenhoRef.current?.setActive(modo === "retangulo");
    if (modo === "retangulo") setJanela(caixaRef.current);
    else atualizaJanela();
  }, [modo, atualizaJanela]);

  // Só procura o helper quando ele resolveria algo: para um COG completo a conversão
  // não muda nada, e uma sonda inútil só gera erro no console do usuário.
  useEffect(() => {
    if (!meta || meta.perfil === "sim") return;
    let vivo = true;
    const controle = new AbortController();
    const tempo = window.setTimeout(() => controle.abort(), 4000);
    fetch(`${endpoint}/health`, { signal: controle.signal })
      .then((resposta) => { if (vivo) setConversor(resposta.ok ? "ativo" : "ausente"); })
      .catch(() => { if (vivo) setConversor("ausente"); })
      .finally(() => window.clearTimeout(tempo));
    return () => { vivo = false; controle.abort(); };
  }, [meta, endpoint]);

  // Relógio da conversão: sem porcentagem real vinda do GDAL, o tempo decorrido ao lado
  // da estimativa é a informação honesta.
  useEffect(() => {
    if (conversao?.estado !== "convertendo") return;
    const id = window.setInterval(() => setSegundos((valor) => valor + 1), 1000);
    return () => window.clearInterval(id);
  }, [conversao?.estado]);

  async function converte() {
    if (typeof fonte === "string" || conversao?.estado === "convertendo") return;
    setSegundos(0);
    setErro(null);
    try {
      const corpo = new FormData();
      corpo.append("arquivo", fonte, nome);
      const resposta = await fetch(`${endpoint}/converter`, { method: "POST", body: corpo });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      let trabalho = await resposta.json() as Trabalho;
      setConversao(trabalho);
      // Sem porcentagem no GDAL, resta perguntar. Cinco segundos é curto o bastante para
      // parecer vivo e longo o bastante para não afogar o helper durante 11 minutos.
      while (trabalho.estado === "convertendo") {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        const atual = await fetch(`${endpoint}/trabalhos/${trabalho.id}`);
        if (!atual.ok) throw new Error(`HTTP ${atual.status}`);
        trabalho = await atual.json() as Trabalho;
        setConversao(trabalho);
      }
      if (trabalho.estado === "erro") throw new Error(trabalho.detalhe || "falha na conversão");
      // O helper serve o resultado com Range, então o visualizador volta a ler por tiles.
      setFase("lendo");
      setJanela(null);
      caixaRef.current = null;
      setFonte(`${endpoint}${trabalho.url}`);
    } catch (falha) {
      setConversao(null);
      setErro(falha instanceof Error ? falha.message : String(falha));
    }
  }

  const previsao = janela ? dimensionaRecorte(janela.w, janela.h) : null;

  async function confirma() {
    if (!janela || gerando) return;
    setGerando(true);
    try {
      const recorte = await geraRecorte(fonte, nome, janela, faixaRef.current);
      onPronto(recorte, nome);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : String(falha));
      setFase("erro");
    } finally {
      setGerando(false);
    }
  }

  return <div className="modal-backdrop cog-crop-backdrop">
    <section className="cog-crop" role="dialog" aria-modal="true" aria-labelledby="cog-crop-title">
      <header>
        <div>
          <h2 id="cog-crop-title">{copy.cogCropTitle}</h2>
          <p>{fase === "lendo" ? etapa : fase === "erro" ? copy.cogFailed : copy.cogCropHint}</p>
        </div>
        <button onClick={onCancelar} aria-label={copy.close}>×</button>
      </header>

      {fase === "lendo" && <div className="cog-crop-progress" role="progressbar" aria-label={etapa}><i /></div>}

      {erro && <div className="cog-crop-erro" role="alert">
        <b>{copy.cogFailed}</b>
        <p>{erro}</p>
        <p className="cog-crop-dica">{copy.cogFailedHint}</p>
      </div>}

      {meta && meta.perfil !== "sim" && <div className="cog-crop-aviso" role="status">
        <b>{fill(copy.cogNotOptimized, { profile: meta.perfil })}</b>
        <p>{copy.cogNotOptimizedHint}</p>
        {conversao?.estado === "convertendo" ? <p className="cog-crop-convertendo">
          <i className="cog-crop-girando" aria-hidden="true" />
          {fill(copy.convRunning, {
            elapsed: `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`,
            estimate: estimaMinutos(conversao.megapixels ?? 0),
          })}
        </p> : conversor === "ativo" && typeof fonte !== "string" ? <div className="cog-crop-converter">
          <button onClick={() => void converte()}>{copy.convButton}</button>
          <small>{fill(copy.convEstimate, {
            minutes: estimaMinutos((meta.largura * meta.altura) / 1e6),
          })}</small>
        </div> : conversor === "ausente" ? <p className="cog-crop-instala">
          {copy.convUnavailable} <a href="/epiaka-cog-local.py" download>epiaka-cog-local.py</a>
        </p> : null}
      </div>}

      <div className="cog-crop-corpo">
        <div className="cog-crop-mapa" ref={hostRef} />
        <aside>
          <h3>{copy.cogFileSection}</h3>
          <dl>
            <dt>{copy.cogPixels}</dt><dd>{meta ? `${inteiro(meta.largura)} × ${inteiro(meta.altura)}` : "—"}</dd>
            <dt>{copy.cogCrs}</dt><dd>{meta?.crs ?? "—"}</dd>
            <dt>{copy.cogBands}</dt><dd>{meta?.bandas ?? "—"}</dd>
            <dt>{copy.cogOverviews}</dt><dd>{meta?.overviews ?? "—"}</dd>
            <dt>{copy.cogProfile}</dt>
            <dd className={meta && meta.perfil !== "sim" ? "cog-bad" : ""}>{meta?.perfil ?? "—"}</dd>
          </dl>

          <h3>{copy.cogCropSection}</h3>
          {janela && previsao ? <dl>
            <dt>{copy.cogWindow}</dt><dd>{inteiro(janela.w)} × {inteiro(janela.h)} px</dd>
            <dt>{copy.cogResult}</dt><dd>{inteiro(previsao.largura)} × {inteiro(previsao.altura)} px</dd>
            <dt>{copy.cogDetail}</dt>
            <dd className={previsao.reducao > 1 ? "cog-warn" : ""}>
              {previsao.reducao <= 1.001
                ? copy.cogNative
                : fill(copy.cogReduced, { factor: previsao.reducao.toFixed(1) })}
            </dd>
            {meta && meta.escalaX > 0 && meta.crs !== "sem CRS" && <>
              <dt>{copy.cogGround}</dt>
              <dd>{(janela.w * meta.escalaX).toFixed(1)} × {(janela.h * meta.escalaY).toFixed(1)}</dd>
            </>}
          </dl> : <p className="cog-crop-vazio">
            {modo === "retangulo" ? copy.cogDrawPrompt : copy.cogNoWindow}
          </p>}
          <p className="cog-crop-nota">{fill(copy.cogCapNote, { side: 4096, mp: 12 })}</p>
        </aside>
      </div>

      <footer>
        <div className="cog-crop-modos">
          <button className={modo === "visivel" ? "on" : ""} onClick={() => setModo("visivel")}>
            {copy.cogModeVisible}
          </button>
          <button className={modo === "retangulo" ? "on" : ""} onClick={() => setModo("retangulo")}>
            {copy.cogModeRect}
          </button>
        </div>
        <div className="cog-crop-acoes">
          <button onClick={onCancelar}>{copy.cancel}</button>
          <button className="primary" disabled={!janela || gerando || fase !== "pronto"} onClick={() => void confirma()}>
            {gerando ? copy.cogGenerating : copy.cogUseCrop}
          </button>
        </div>
      </footer>
    </section>
  </div>;
}

export { ehArquivoTiff };
