export interface HwpxMetadata {
  title?: string;
  creator?: string;
  created?: string;
  modified?: string;
  version?: string;
  caretPosition?: string;
}

export interface HwpxTextExtractOptions {
  joinParagraphs?: string;
}

export interface HwpxHtmlOptions {
  paragraphTag?: string;
  tableClassName?: string;
  imageSrcResolver?: (binPath: string) => string;
  renderImages?: boolean;
  renderTables?: boolean;
  renderStyles?: boolean;
  embedImages?: boolean;
  tableHeaderFirstRow?: boolean;
}

export type TemplateData = Record<string, unknown>;

export interface HwpxFileMap {
  [path: string]: Uint8Array;
}

export interface HwpxManifestItem {
  id?: string;
  href?: string;
  mediaType?: string;
}

export interface HwpxPackageSummary {
  hasEncryptionInfo: boolean;
  contentsFiles: string[];
  manifest?: HwpxManifestItem[];
  spine?: string[];
}

export interface HwpxDocumentInfo {
  metadata: HwpxMetadata;
  summary: HwpxPackageSummary;
}

export interface HwpxReaderApi {
  loadFromArrayBuffer(buffer: ArrayBuffer): Promise<void>;
  getDocumentInfo(): Promise<HwpxDocumentInfo>;
  extractText(options?: HwpxTextExtractOptions): Promise<string>;
  extractHtml(options?: HwpxHtmlOptions): Promise<string>;
  listImages(): Promise<string[]>;
}


