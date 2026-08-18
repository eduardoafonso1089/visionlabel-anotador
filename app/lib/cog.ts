// Leitura de GeoTIFF/COG e geração de recortes para o anotador.
//
// O anotador trabalha sobre um <img> num espaço de 1000 × 650. Um COG de gigapixels não
// cabe ali por dois motivos independentes: o navegador não decodifica TIFF, e o bitmap
// não caberia na memória. A saída é não tentar: o COG é lido por tiles só para o usuário
// escolher a região, e o que entra no anotador é um recorte dessa região, já em PNG e com
// tamanho limitado. Com isso toda ferramenta existente — inclusive o SAM, que envia a
// imagem inteira por data URL — continua funcionando sem alteração.
//
// O preço é guardar a referência: origem, escala e a janela recortada. É ela que devolve
// a anotação para pixel do arquivo original e para coordenada de terreno.

import type { GeoRef } from "./types";

/** Recorte maior que isso não ajuda: o anotador desenha num espaço de 1000 × 650, e o SAM
 *  recebe a imagem inteira por data URL. Acima disso só cresce memória e latência. */
export const RECORTE_LADO_MAX = 4096;
export const RECORTE_MP_MAX = 12;

export type MetadadosCog = {
  largura: number;
  altura: number;
  bandas: number;
  crs: string;
  origemX: number;
  origemY: number;
  escalaX: number;
  escalaY: number;
  larguraTile: number;
  alturaTile: number;
  overviews: number;
  /** Índices dos IFDs que são imagem de verdade, do mais fino ao mais grosso. */
  niveis: number[];
  tiled: boolean;
  semDado: number | null;
  /** "sim" | "tiled, sem overviews" | "não — por faixas" */
  perfil: string;
};

/** Só os 4 primeiros bytes. Um File dá slice, uma URL dá range request: é a checagem mais
 *  barata possível e evita entregar HTML de erro ao leitor de TIFF, que trava tentando
 *  interpretar bytes aleatórios. */
export async function primeirosBytes(origem: File | string) {
  if (typeof origem !== "string") {
    return new Uint8Array(await origem.slice(0, 4).arrayBuffer());
  }
  const resposta = await fetch(origem, { headers: { Range: "bytes=0-3" } });
  if (!resposta.ok) throw new Error(`O servidor respondeu HTTP ${resposta.status}.`);
  return new Uint8Array(await resposta.arrayBuffer());
}

export function assinaturaTiff(bytes: Uint8Array) {
  if (bytes.length < 4) return null;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!little && !big) return null;
  const magic = little ? bytes[2] | (bytes[3] << 8) : (bytes[2] << 8) | bytes[3];
  return magic === 42 ? "TIFF" : magic === 43 ? "BigTIFF" : null;
}

export function ehArquivoTiff(nome: string, tipo?: string) {
  return /\.tiff?$/i.test(nome) || tipo === "image/tiff" || tipo === "image/x-tiff";
}

type Geotiff = Awaited<ReturnType<typeof abre>>["tiff"];
type ImagemTiff = Awaited<ReturnType<Geotiff["getImage"]>>;

/** Abre o arquivo e devolve o handle junto dos metadados que as duas telas precisam. */
export async function abre(origem: File | string) {
  const { fromBlob, fromUrl } = await import("geotiff");
  const tiff = typeof origem === "string" ? await fromUrl(origem) : await fromBlob(origem);
  return { tiff, imagem: await tiff.getImage(0) };
}

/**
 * Um COG guarda mais IFDs do que os níveis da pirâmide: as máscaras internas entram como
 * imagens de resolução reduzida, com as mesmas dimensões de um overview. Escolher uma
 * delas por engano faz o leitor devolver "Invalid or unsupported photometric
 * interpretation", porque máscara é PhotometricInterpretation 4. O bit 4 de
 * NewSubfileType é o que as identifica.
 */
function ehMascara(imagem: ImagemTiff) {
  const diretorio = (imagem as unknown as {
    fileDirectory?: { getValue?: (nome: string) => unknown } & Record<string, unknown>;
  }).fileDirectory;
  const tipo = typeof diretorio?.getValue === "function"
    ? diretorio.getValue("NewSubfileType")
    : diretorio?.NewSubfileType;
  const valor = Array.isArray(tipo) ? tipo[0] : tipo;
  return typeof valor === "number" && (valor & 4) === 4;
}

export async function leMetadados(origem: File | string): Promise<MetadadosCog & { tiff: Geotiff }> {
  const assinatura = assinaturaTiff(await primeirosBytes(origem));
  if (!assinatura) throw new Error("Os primeiros bytes não são de um TIFF: esperado II* ou MM*.");
  const { tiff, imagem } = await abre(origem);
  const total = await tiff.getImageCount();
  const niveis: number[] = [];
  for (let indice = 0; indice < total; indice += 1) {
    if (!ehMascara(await tiff.getImage(indice))) niveis.push(indice);
  }
  // Num TIFF por faixas o geotiff.js devolve a largura da imagem como "tile", então
  // getTileWidth() não distingue tiled de striped. A flag isTiled vale false quando o
  // arquivo tem StripOffsets em vez de TileWidth.
  const tiled = Boolean((imagem as unknown as { isTiled?: boolean }).isTiled);
  const [escalaX, escalaY] = imagem.getResolution() as number[];
  const origemModelo = imagem.getOrigin() as number[];
  return {
    tiff,
    largura: imagem.getWidth(),
    altura: imagem.getHeight(),
    bandas: imagem.getSamplesPerPixel(),
    crs: codigoCrs(imagem),
    origemX: origemModelo[0],
    origemY: origemModelo[1],
    escalaX: Math.abs(escalaX),
    escalaY: Math.abs(escalaY),
    larguraTile: imagem.getTileWidth(),
    alturaTile: imagem.getTileHeight(),
    overviews: Math.max(0, niveis.length - 1),
    niveis,
    tiled,
    semDado: imagem.getGDALNoData(),
    perfil: tiled && niveis.length > 1 ? "sim" : tiled ? "tiled, sem overviews" : "não — por faixas",
  };
}

function codigoCrs(imagem: ImagemTiff) {
  // O geotiff.js 3.x expõe as GeoKeys por getGeoKeys(); nas versões 2.x elas eram uma
  // propriedade `geoKeys` do objeto. Aceita as duas formas.
  const alvo = imagem as unknown as {
    getGeoKeys?: () => Record<string, unknown> | null;
    geoKeys?: Record<string, unknown>;
  };
  const chaves = (typeof alvo.getGeoKeys === "function" ? alvo.getGeoKeys() : null) ?? alvo.geoKeys;
  const bruto = chaves?.ProjectedCSTypeGeoKey ?? chaves?.GeographicTypeGeoKey;
  // Algumas tags chegam como array de um elemento.
  const codigo = Array.isArray(bruto) ? bruto[0] : bruto;
  return typeof codigo === "number" && codigo > 0 && codigo < 32767 ? `EPSG:${codigo}` : "sem CRS";
}

/**
 * Decide o tamanho do recorte. A janela pedida pode ter dezenas de milhares de pixels;
 * o resultado é limitado por lado e por megapixel, preservando a proporção. Nunca
 * aumenta: recortar 300 px não gera uma imagem de 4096.
 */
export function dimensionaRecorte(janelaLargura: number, janelaAltura: number) {
  const porLado = Math.min(1, RECORTE_LADO_MAX / Math.max(janelaLargura, janelaAltura));
  const porArea = Math.min(1, Math.sqrt(RECORTE_MP_MAX * 1e6 / (janelaLargura * janelaAltura)));
  const fator = Math.min(1, porLado, porArea);
  return {
    largura: Math.max(1, Math.round(janelaLargura * fator)),
    altura: Math.max(1, Math.round(janelaAltura * fator)),
    // Quantos pixels do arquivo cabem em 1 px do recorte. 1 significa resolução nativa.
    reducao: fator ? 1 / fator : 1,
  };
}

/**
 * Escolhe o nível da pirâmide mais grosso que ainda não force ampliação. Ler a resolução
 * cheia para depois reduzir por software transferiria o arquivo inteiro; é justamente o
 * que os overviews existem para evitar.
 */
async function nivelPara(tiff: Geotiff, niveis: number[], larguraTotal: number, reducao: number) {
  let escolhido = niveis[0] ?? 0;
  let fatorEscolhido = 1;
  for (const indice of niveis) {
    const imagem = await tiff.getImage(indice);
    const fator = larguraTotal / imagem.getWidth();
    if (fator <= reducao + 1e-6 && fator > fatorEscolhido) {
      escolhido = indice;
      fatorEscolhido = fator;
    }
  }
  return { imagem: await tiff.getImage(escolhido), fator: fatorEscolhido, indice: escolhido };
}

/** Rampa das imagens de uma banda, igual à do visualizador — o recorte precisa sair com a
 *  mesma aparência da prévia, senão o usuário anota uma coisa e vê outra. */
function rampa(valor: number, min: number, max: number) {
  const t = max > min ? Math.min(1, Math.max(0, (valor - min) / (max - min))) : 0;
  const paradas: Array<[number, number, number]> = [[16, 22, 19], [104, 148, 124], [242, 246, 243]];
  const pos = t * (paradas.length - 1);
  const i = Math.min(paradas.length - 2, Math.floor(pos));
  const f = pos - i;
  return [
    paradas[i][0] + (paradas[i + 1][0] - paradas[i][0]) * f,
    paradas[i][1] + (paradas[i + 1][1] - paradas[i][1]) * f,
    paradas[i][2] + (paradas[i + 1][2] - paradas[i][2]) * f,
  ];
}

export type Recorte = {
  blob: Blob;
  largura: number;
  altura: number;
  geo: GeoRef;
};

/**
 * Lê a janela pedida e devolve um PNG pronto para virar asset do anotador, junto da
 * referência que liga cada pixel do recorte de volta ao arquivo e ao terreno.
 *
 * `janela` está em pixel do arquivo original, com y crescendo para baixo.
 */
export async function geraRecorte(
  origem: File | string,
  nomeOrigem: string,
  janela: { x: number; y: number; w: number; h: number },
  faixaBanda?: { min: number; max: number } | null,
): Promise<Recorte> {
  const meta = await leMetadados(origem);
  const { tiff } = meta;

  // Recorta contra os limites do arquivo: arrastar a vista para fora da imagem é comum,
  // e pedir pixel inexistente faz o geotiff.js devolver lixo em vez de erro.
  const x0 = Math.max(0, Math.floor(janela.x));
  const y0 = Math.max(0, Math.floor(janela.y));
  const x1 = Math.min(meta.largura, Math.ceil(janela.x + janela.w));
  const y1 = Math.min(meta.altura, Math.ceil(janela.y + janela.h));
  if (x1 <= x0 || y1 <= y0) throw new Error("A área escolhida está fora da imagem.");

  const larguraJanela = x1 - x0;
  const alturaJanela = y1 - y0;
  const alvo = dimensionaRecorte(larguraJanela, alturaJanela);
  const nivel = await nivelPara(tiff, meta.niveis, meta.largura, alvo.reducao);

  // A janela precisa ir para a escala do nível escolhido antes da leitura.
  const janelaNivel = [
    Math.floor(x0 / nivel.fator), Math.floor(y0 / nivel.fator),
    Math.ceil(x1 / nivel.fator), Math.ceil(y1 / nivel.fator),
  ] as [number, number, number, number];

  const opcoes = {
    window: janelaNivel,
    width: alvo.largura,
    height: alvo.altura,
    resampleMethod: "bilinear" as const,
  };

  const pixels = new Uint8ClampedArray(alvo.largura * alvo.altura * 4);
  if (meta.bandas >= 3) {
    // readRGB resolve photometric por conta própria — inclusive YCbCr, o formato dominante
    // em ortofoto de drone, que readRasters entregaria com Y, Cb e Cr crus nos três canais.
    // `interleave` é false por padrão no readRGB, e sem ele o retorno são três arrays
    // separados em vez de um só — o laço abaixo leria undefined e o recorte sairia preto.
    const dados = await nivel.imagem.readRGB({
      ...opcoes, interleave: true, enableAlpha: false,
    }) as unknown as ArrayLike<number>;
    for (let i = 0, p = 0; p < pixels.length; i += 3, p += 4) {
      pixels[p] = dados[i];
      pixels[p + 1] = dados[i + 1];
      pixels[p + 2] = dados[i + 2];
      pixels[p + 3] = 255;
    }
  } else {
    const rasters = await nivel.imagem.readRasters(opcoes) as unknown as Array<ArrayLike<number>>;
    const banda = rasters[0];
    const faixa = faixaBanda ?? medeFaixa(banda, meta.semDado);
    for (let i = 0, p = 0; i < banda.length; i += 1, p += 4) {
      const valor = banda[i];
      if (!Number.isFinite(valor) || valor === meta.semDado) {
        pixels[p + 3] = 0;
        continue;
      }
      const [r, g, b] = rampa(valor, faixa.min, faixa.max);
      pixels[p] = r;
      pixels[p + 1] = g;
      pixels[p + 2] = b;
      pixels[p + 3] = 255;
    }
  }

  const tela = document.createElement("canvas");
  tela.width = alvo.largura;
  tela.height = alvo.altura;
  const contexto = tela.getContext("2d");
  if (!contexto) throw new Error("O navegador não forneceu um contexto de canvas 2D.");
  contexto.putImageData(new ImageData(pixels, alvo.largura, alvo.altura), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => tela.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Não foi possível gerar o PNG do recorte.");

  return {
    blob,
    largura: alvo.largura,
    altura: alvo.altura,
    geo: {
      source: nomeOrigem,
      crs: meta.crs,
      originX: meta.origemX,
      originY: meta.origemY,
      scaleX: meta.escalaX,
      scaleY: meta.escalaY,
      sourceWidth: meta.largura,
      sourceHeight: meta.altura,
      window: { x: x0, y: y0, w: larguraJanela, h: alturaJanela },
      cropWidth: alvo.largura,
      cropHeight: alvo.altura,
    },
  };
}

export function medeFaixa(valores: ArrayLike<number>, semDado: number | null) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < valores.length; i += 1) {
    const valor = valores[i];
    if (!Number.isFinite(valor) || valor === semDado) continue;
    if (valor < min) min = valor;
    if (valor > max) max = valor;
  }
  return Number.isFinite(min) && max > min ? { min, max } : { min: 0, max: 255 };
}
