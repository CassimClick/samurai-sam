// Shapes of the data produced by tools/build-data.mjs.

/** [a, b, c, d, tx, ty] — same layout as CanvasRenderingContext2D.setTransform. */
export type Matrix = [number, number, number, number, number, number];
/** Color transform: [rMult, gMult, bMult, aMult, rAdd, gAdd, bAdd, aAdd] (adds in 0..255). */
export type ColorTransform = [number, number, number, number, number, number, number, number];
export type Rect = [number, number, number, number];

export interface PlaceOp {
  o: 'p' | 'r';
  d: number;
  c?: number;
  mv?: 1;
  m?: Matrix;
  cx?: ColorTransform;
  n?: string;
  r?: number;
  cd?: number;
  bm?: number;
  ev?: Record<string, string[]>;
}

export interface FrameSound {
  id: number;
  stop?: 1;
  noMultiple?: 1;
  loops?: number;
}

export interface FrameDef {
  ops: PlaceOp[];
  labels?: string[];
  as?: string[];
  sounds?: FrameSound[];
}

export interface TimelineDef {
  frames: FrameDef[];
  labels: Record<string, number>;
  /** Lazily computed display-list snapshots for gotoAndPlay/gotoAndStop. */
  $states?: Map<number, PlaceState>[];
}

export interface PlaceState {
  c: number;
  born: number;
  m?: Matrix;
  cx?: ColorTransform;
  n?: string;
  r?: number;
  cd?: number;
  bm?: number;
  ev?: Record<string, string[]>;
}

export interface SpriteChar extends TimelineDef {
  t: 'sprite';
  x?: string;
}
export interface ShapeChar {
  t: 'shape';
  b: Rect;
  text?: 1;
  x?: string;
}
export interface MorphChar {
  t: 'morph';
  b: Rect;
  b2: Rect;
}
export interface ButtonRecord {
  c: number;
  d: number;
  m?: Matrix;
  cx?: ColorTransform;
  s: string;
}
export interface ButtonChar {
  t: 'button';
  records: ButtonRecord[];
  menu: 0 | 1;
  actions: Record<string, string[]>;
  x?: string;
}
export interface EditTextChar {
  t: 'edit';
  b: Rect;
  font?: number;
  size: number;
  color: [number, number, number, number];
  align: number;
  leading: number;
  leftMargin: number;
  rightMargin: number;
  indent: number;
  html: 0 | 1;
  text: string;
  variable?: string;
  multiline: 0 | 1;
  wordWrap: 0 | 1;
  outlines: 0 | 1;
  border: 0 | 1;
  selectable: 0 | 1;
  autoSize: 0 | 1;
  password: 0 | 1;
}
export interface FontChar {
  t: 'font';
  name: string;
  bold: 0 | 1;
  italic: 0 | 1;
  ascent?: number;
  descent?: number;
  file?: string;
}
export interface SoundChar {
  t: 'sound';
  file?: string;
  x?: string;
}
export interface BitmapChar {
  t: 'bitmap';
}

export type CharDef = SpriteChar | ShapeChar | MorphChar | ButtonChar | EditTextChar | FontChar | SoundChar | BitmapChar;

export interface SwfData {
  width: number;
  height: number;
  frameRate: number;
  bg: [number, number, number];
  chars: Record<string, CharDef>;
  exports: Record<string, number>;
  root: TimelineDef;
}

// Vector draw lists (tools/lib/svg.mjs)
export type SolidFill = ['c', number, number, number, number];
export type GradientStop = [number, number, number, number, number];
export type LinearFill = ['l', GradientStop[], Matrix, number, number, number, number, string];
export type RadialFill = ['r', GradientStop[], Matrix, number, number, number, number, number, string];
export type BitmapFill = ['b', string, Matrix, number, number, number];
export type Fill = SolidFill | LinearFill | RadialFill | BitmapFill;

export interface DrawItem {
  d: string;
  d2?: string;
  t?: Matrix;
  f?: Fill;
  f2?: [number, number, number, number];
  fo2?: number;
  nz?: 1;
  s?: { w: number; c: [number, number, number, number]; cap: string; join: string; ml?: number; c2?: [number, number, number, number]; w2?: number };
}

export type ShapeLibraryData = Record<string, DrawItem[]>;
