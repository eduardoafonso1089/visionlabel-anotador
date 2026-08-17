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

export type Asset = {
  id: string;
  name: string;
  src: string;
  local?: boolean;
  missing?: boolean;
  byteSize?: number;
  width?: number;
  height?: number;
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
