import JSZip from "jszip";
import { annotationBounds, polygonArea, scalePoints } from "./geometry";
import { EDITOR_HEIGHT, EDITOR_WIDTH } from "./geometry";
import type { Annotation, Asset, Label } from "./types";

function baseName(name: string, fallback: string) {
  const clean = name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
  return clean || fallback;
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}

export function exportCoco(assets: Asset[], labels: Label[], annotations: Annotation[]) {
  const images = assets.map((asset, index) => ({
    id: index + 1,
    file_name: asset.name,
    width: asset.width ?? 1000,
    height: asset.height ?? 650,
  }));
  const categories = labels.map((label, index) => ({
    id: index + 1,
    name: label.name,
    supercategory: "object",
  }));
  const cocoAnnotations = annotations.map((annotation, index) => {
    const imageIndex = assets.findIndex((asset) => asset.id === annotation.asset);
    const categoryIndex = labels.findIndex((label) => label.id === annotation.label);
    const image = assets[imageIndex];
    const width = image?.width ?? 1000;
    const height = image?.height ?? 650;
    const bounds = annotationBounds(annotation);
    const scaledBounds = scalePoints(
      [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height],
      width,
      height,
    );
    const segmentation =
      annotation.type === "polygon" ? [scalePoints(annotation.pts ?? [], width, height)] : [];
    // Uma polilinha não delimita região: sai em `line` (extensão), com area 0 e segmentation
    // vazia, para nenhum consumidor a interpretar como máscara.
    const line = annotation.type === "line" ? scalePoints(annotation.pts ?? [], width, height) : [];
    const area = annotation.type === "polygon"
      ? polygonArea(scalePoints(annotation.pts ?? [], width, height))
      : annotation.type === "line"
        ? 0
        : (scaledBounds[2] - scaledBounds[0]) * (scaledBounds[3] - scaledBounds[1]);
    return {
      id: index + 1,
      image_id: imageIndex + 1,
      category_id: categoryIndex + 1,
      bbox: [
        scaledBounds[0],
        scaledBounds[1],
        scaledBounds[2] - scaledBounds[0],
        scaledBounds[3] - scaledBounds[1],
      ],
      segmentation,
      line,
      keypoints:
        annotation.type === "point"
          ? scalePoints([annotation.x ?? 0, annotation.y ?? 0], width, height).concat(2)
          : [],
      num_keypoints: annotation.type === "point" ? 1 : 0,
      area,
      iscrowd: 0,
    };
  });
  downloadBlob(
    "epiaka-coco.json",
    new Blob(
      [JSON.stringify({ info: { description: "Epiaka dataset", version: "1.0" }, images, categories, annotations: cocoAnnotations }, null, 2)],
      { type: "application/json;charset=utf-8" },
    ),
  );
}

export async function exportYoloZip(assets: Asset[], labels: Label[], annotations: Annotation[], readme: string) {
  const zip = new JSZip();
  const labelFolder = zip.folder("labels");
  assets.forEach((asset, imageIndex) => {
    const lines = annotations
      .filter((annotation) => annotation.asset === asset.id)
      .flatMap((annotation) => {
        const classIndex = labels.findIndex((label) => label.id === annotation.label);
        if (annotation.type === "box") {
          const centerX = ((annotation.x ?? 0) + (annotation.w ?? 0) / 2) / 1000;
          const centerY = ((annotation.y ?? 0) + (annotation.h ?? 0) / 2) / 650;
          return [`${classIndex} ${centerX.toFixed(6)} ${centerY.toFixed(6)} ${((annotation.w ?? 0) / 1000).toFixed(6)} ${((annotation.h ?? 0) / 650).toFixed(6)}`];
        }
        if (annotation.type === "polygon") {
          const normalized = (annotation.pts ?? []).map((coordinate, index) =>
            (coordinate / (index % 2 ? 650 : 1000)).toFixed(6),
          );
          return [`${classIndex} ${normalized.join(" ")}`];
        }
        return [];
      });
    labelFolder?.file(`${baseName(asset.name, `image_${imageIndex + 1}`)}.txt`, lines.join("\n"));
  });
  zip.file("classes.txt", labels.map((label) => label.name).join("\n"));
  zip.file(
    "data.yaml",
    `path: .\ntrain: images/train\nval: images/val\nnc: ${labels.length}\nnames:\n${labels.map((label, index) => `  ${index}: ${JSON.stringify(label.name)}`).join("\n")}\n`,
  );
  zip.file(
    "README.txt",
    `${readme}\n`,
  );
  downloadBlob("epiaka-yolo.zip", await zip.generateAsync({ type: "blob" }));
}


// ---------------------------------------------------------------------------
// GeoJSON
//
// Só faz sentido para asset que veio de um COG: é o `geo` dele que carrega a origem, a
// escala e a janela recortada. Sem isso a anotação existe apenas em pixel, e um GeoJSON
// com coordenada de pixel seria pior que nenhum, porque parece georreferenciado.
// ---------------------------------------------------------------------------

/**
 * Espaço do editor (1000 × 650) → pixel do recorte → pixel do arquivo → coordenada do CRS.
 * O y do editor cresce para baixo e o do CRS para cima; a inversão acontece no último passo.
 */
function paraCoordenada(asset: Asset, x: number, y: number): [number, number] {
  const geo = asset.geo!;
  const recorteX = x / EDITOR_WIDTH * geo.cropWidth;
  const recorteY = y / EDITOR_HEIGHT * geo.cropHeight;
  const arquivoX = geo.window.x + recorteX * (geo.window.w / geo.cropWidth);
  const arquivoY = geo.window.y + recorteY * (geo.window.h / geo.cropHeight);
  return [geo.originX + arquivoX * geo.scaleX, geo.originY - arquivoY * geo.scaleY];
}

function anel(asset: Asset, pontos: number[]) {
  const saida: Array<[number, number]> = [];
  for (let index = 0; index < pontos.length; index += 2) {
    const ponto = paraCoordenada(asset, pontos[index], pontos[index + 1]);
    // O duplo clique que encerra um polígono no editor grava um vértice em cima do
    // anterior. Em pixel isso é invisível; num GeoJSON vira segmento de comprimento zero,
    // que validador de geometria reprova.
    const ultimo = saida.at(-1);
    if (ultimo && ultimo[0] === ponto[0] && ultimo[1] === ponto[1]) continue;
    saida.push(ponto);
  }
  return saida;
}

function geometriaDe(asset: Asset, annotation: Annotation) {
  if (annotation.type === "point") {
    return { type: "Point", coordinates: paraCoordenada(asset, annotation.x ?? 0, annotation.y ?? 0) };
  }
  if (annotation.type === "box") {
    const x = annotation.x ?? 0;
    const y = annotation.y ?? 0;
    const w = annotation.w ?? 0;
    const h = annotation.h ?? 0;
    const caixa = anel(asset, [x, y, x + w, y, x + w, y + h, x, y + h]);
    return { type: "Polygon", coordinates: [[...caixa, caixa[0]]] };
  }
  const pontos = anel(asset, annotation.pts ?? []);
  if (pontos.length < 2) return null;
  if (annotation.type === "line") return { type: "LineString", coordinates: pontos };
  // O anel de um polígono GeoJSON precisa fechar repetindo o primeiro vértice.
  return pontos.length >= 3 ? { type: "Polygon", coordinates: [[...pontos, pontos[0]]] } : null;
}

export function annotationsToGeoJson(assets: Asset[], labels: Label[], annotations: Annotation[]) {
  const comGeo = assets.filter((asset) => asset.geo);
  const features = annotations.flatMap((annotation) => {
    const asset = comGeo.find((item) => item.id === annotation.asset);
    if (!asset) return [];
    const geometry = geometriaDe(asset, annotation);
    if (!geometry) return [];
    const label = labels.find((item) => item.id === annotation.label);
    return [{
      type: "Feature",
      geometry,
      properties: {
        id: annotation.id,
        classe: label?.name ?? annotation.label,
        classe_id: annotation.label,
        cor: label?.color ?? null,
        forma: annotation.type,
        recorte: asset.name,
        origem: asset.geo!.source,
        crs: asset.geo!.crs,
      },
    }];
  });

  // Todos os recortes de uma exportação precisam falar o mesmo CRS: misturar UTM de zonas
  // diferentes num arquivo só produziria geometria sobreposta sem aviso.
  const crsUsados = [...new Set(comGeo.map((asset) => asset.geo!.crs))];
  return {
    colecao: {
      type: "FeatureCollection",
      // Membro `crs` saiu da especificação em 2016, mas QGIS e GDAL continuam lendo, e é
      // a única forma de não perder a projeção sem reprojetar para WGS84 aqui.
      ...(crsUsados.length === 1 && crsUsados[0] !== "sem CRS"
        ? { crs: { type: "name", properties: { name: `urn:ogc:def:crs:EPSG::${crsUsados[0].replace("EPSG:", "")}` } } }
        : {}),
      features,
    },
    crsUsados,
    total: features.length,
    semGeo: annotations.length - features.length,
  };
}

export function exportGeoJson(assets: Asset[], labels: Label[], annotations: Annotation[]) {
  const resultado = annotationsToGeoJson(assets, labels, annotations);
  downloadBlob(
    "epiaka-anotacoes.geojson",
    new Blob([JSON.stringify(resultado.colecao, null, 2)], { type: "application/geo+json;charset=utf-8" }),
  );
  return resultado;
}
