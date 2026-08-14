export type Tool =
  | "select"
  | "pan"
  | "box"
  | "polygon"
  | "freehand"
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
  type: "box" | "polygon" | "point";
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
