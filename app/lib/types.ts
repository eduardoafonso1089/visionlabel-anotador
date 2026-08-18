export type Tool =
  | "select"
  | "pan"
  | "box"
  | "polygon"
  | "freehand"
  | "line"
  | "point"
  | "sam"
  | "split"
  | "transform"
  | "reshape";

export type Label = {
  id: string;
  name: string;
  color: string;
  key: string;
};

/**
 * Referência de um recorte de COG ao arquivo que o originou. Guardada no asset porque é
 * o que devolve a anotação — desenhada no espaço de 1000 × 650 do editor — para pixel do
 * arquivo original e para coordenada de terreno.
 */
export type GeoRef = {
  /** Nome ou URL do COG de origem. */
  source: string;
  /** Código EPSG do arquivo, ou "sem CRS". */
  crs: string;
  /** Canto superior esquerdo do arquivo, na unidade do CRS. */
  originX: number;
  originY: number;
  /** Unidades do CRS por pixel do arquivo. */
  scaleX: number;
  scaleY: number;
  sourceWidth: number;
  sourceHeight: number;
  /** A janela recortada, em pixel do arquivo de origem, com y crescendo para baixo. */
  window: { x: number; y: number; w: number; h: number };
  /** Tamanho do PNG gerado. Pode ser menor que a janela: o recorte é limitado. */
  cropWidth: number;
  cropHeight: number;
};

export type Asset = {
  id: string;
  name: string;
  src: string;
  local?: boolean;
  missing?: boolean;
  byteSize?: number;
  width?: number;
  height?: number;
  geo?: GeoRef;
};

export type Annotation = {
  id: string;
  asset: string;
  label: string;
  // "line" é uma polilinha aberta: usa `pts` como o polígono, mas sem fechar o contorno.
  type: "box" | "polygon" | "line" | "point";
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  pts?: number[];
};

export type SamPrompt = {
  x: number;
  y: number;
  label: 0 | 1;
};
