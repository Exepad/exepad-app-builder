/**
 * Ambient module declarations for @exepad/ext-* extension packages.
 *
 * These provide IDE autocomplete and type safety for extension imports.
 * Each declaration maps the @exepad/ext-* specifier to its upstream types.
 *
 * At runtime, these are resolved via the import map in index.html
 * to CDN/esm.sh URLs (dev) or cdn.exepad.com bundles (production).
 */

// --- Data Visualization ---
declare module "@exepad/ext-d3" {
  const d3: any;
  export default d3;
  export * from "d3";
}

declare module "@exepad/ext-plotly" {
  const Plotly: any;
  export default Plotly;
}

declare module "@exepad/ext-cytoscape" {
  const cytoscape: any;
  export default cytoscape;
}

// --- Code Editing ---
declare module "@exepad/ext-monaco" {
  const monaco: any;
  export default monaco;
}

declare module "@exepad/ext-codemirror" {
  export const EditorView: any;
  export const EditorState: any;
  const codemirror: any;
  export default codemirror;
}

declare module "@exepad/ext-highlight" {
  const hljs: any;
  export default hljs;
}

declare module "@exepad/ext-prism" {
  const Prism: any;
  export default Prism;
}

// --- Rich Text Editing ---
declare module "@exepad/ext-tiptap" {
  export const Editor: any;
  export const useEditor: any;
  export const EditorContent: any;
  export const BubbleMenu: any;
  export const FloatingMenu: any;
  export const StarterKit: any;
  export const Placeholder: any;
  export const Link: any;
  export const Image: any;
  const tiptap: any;
  export default tiptap;
}

declare module "@exepad/ext-slate" {
  export const createEditor: any;
  export const Slate: any;
  export const Editable: any;
  export const withReact: any;
  const slate: any;
  export default slate;
}

declare module "@exepad/ext-prosemirror" {
  export const EditorState: any;
  export const EditorView: any;
  export const Schema: any;
  const prosemirror: any;
  export default prosemirror;
}

// --- Canvas / Drawing ---
declare module "@exepad/ext-konva" {
  export const Stage: any;
  export const Layer: any;
  export const Rect: any;
  export const Circle: any;
  export const Line: any;
  export const Text: any;
  export const Transformer: any;
  const konva: any;
  export default konva;
}

declare module "@exepad/ext-fabric" {
  export const Canvas: any;
  export const Rect: any;
  export const Circle: any;
  export const Image: any;
  const fabric: any;
  export default fabric;
}

declare module "@exepad/ext-excalidraw" {
  export const Excalidraw: any;
  const excalidraw: any;
  export default excalidraw;
}

declare module "@exepad/ext-signature" {
  const SignaturePad: any;
  export default SignaturePad;
}

declare module "@exepad/ext-cropper" {
  const Cropper: any;
  export default Cropper;
}

// --- Drag and Drop ---
declare module "@exepad/ext-dnd-kit" {
  export const DndContext: any;
  export const useDraggable: any;
  export const useDroppable: any;
  export const useSortable: any;
  const dndKit: any;
  export default dndKit;
}

// --- Maps ---
declare module "@exepad/ext-mapbox" {
  export const Map: any;
  export const Marker: any;
  export const Popup: any;
  const mapbox: any;
  export default mapbox;
}

declare module "@exepad/ext-leaflet" {
  export const MapContainer: any;
  export const TileLayer: any;
  export const Marker: any;
  export const Popup: any;
  const leaflet: any;
  export default leaflet;
}

// --- 3D / WebGL ---
declare module "@exepad/ext-three" {
  export const Scene: any;
  export const PerspectiveCamera: any;
  export const WebGLRenderer: any;
  export const BoxGeometry: any;
  export const MeshStandardMaterial: any;
  export const Mesh: any;
  export const AmbientLight: any;
  export const DirectionalLight: any;
  export const Vector3: any;
  export const Color: any;
  const three: any;
  export default three;
}

declare module "@exepad/ext-pixi" {
  export const Application: any;
  export const Sprite: any;
  const pixi: any;
  export default pixi;
}

// --- Diagrams / Flows ---
declare module "@exepad/ext-reactflow" {
  export const ReactFlow: any;
  export const useNodesState: any;
  export const useEdgesState: any;
  export const addEdge: any;
  const reactflow: any;
  export default reactflow;
}

declare module "@exepad/ext-mermaid" {
  const mermaid: any;
  export default mermaid;
}

// --- Documents ---
declare module "@exepad/ext-pdf" {
  export const Document: any;
  export const Page: any;
  const reactPdf: any;
  export default reactPdf;
}

declare module "@exepad/ext-markdown" {
  const Markdown: any;
  export default Markdown;
}

declare module "@exepad/ext-katex" {
  const katex: any;
  export default katex;
}

// --- Media ---
declare module "@exepad/ext-wavesurfer" {
  const WaveSurfer: any;
  export default WaveSurfer;
}

declare module "@exepad/ext-videojs" {
  const videojs: any;
  export default videojs;
}

declare module "@exepad/ext-tone" {
  export const Synth: any;
  export const PolySynth: any;
  export const Transport: any;
  export const Destination: any;
  const Tone: any;
  export default Tone;
}

declare module "@exepad/ext-lottie" {
  const Lottie: any;
  export default Lottie;
}

// --- Advanced UI ---
declare module "@exepad/ext-ag-grid" {
  export const AgGridReact: any;
  const agGrid: any;
  export default agGrid;
}

declare module "@exepad/ext-fullcalendar" {
  const FullCalendar: any;
  export default FullCalendar;
  export const dayGridPlugin: any;
  export const timeGridPlugin: any;
  export const interactionPlugin: any;
  export const listPlugin: any;
}

declare module "@exepad/ext-tanstack-table" {
  export const useReactTable: any;
  export const getCoreRowModel: any;
  export const getSortedRowModel: any;
  export const getFilteredRowModel: any;
  export const getPaginationRowModel: any;
  export const flexRender: any;
  const tanstackTable: any;
  export default tanstackTable;
}

declare module "@exepad/ext-xterm" {
  export const Terminal: any;
  const xterm: any;
  export default xterm;
}

// --- Utilities ---
declare module "@exepad/ext-qrcode" {
  export const QRCodeCanvas: any;
  export const QRCodeSVG: any;
  const qrcode: any;
  export default qrcode;
}

declare module "@exepad/ext-barcode" {
  const Barcode: any;
  export default Barcode;
}

declare module "@exepad/ext-chess" {
  export class Chess {
    constructor(fen?: string);
    move(move: string | { from: string; to: string; promotion?: string }): any;
    fen(): string;
    isGameOver(): boolean;
    isCheckmate(): boolean;
    isDraw(): boolean;
    isStalemate(): boolean;
    isCheck(): boolean;
    turn(): string;
    moves(opts?: any): any[];
    board(): any[][];
    undo(): any;
    reset(): void;
    history(opts?: any): any[];
  }
}
