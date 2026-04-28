import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import type {
  HwpxDocumentInfo,
  HwpxFileMap,
  HwpxMetadata,
  HwpxPackageSummary,
  HwpxReaderApi as HwpxReaderInterface,
  HwpxTextExtractOptions,
  HwpxHtmlOptions,
} from "./types.js";
import { HwpxEncryptedDocumentError, HwpxNotLoadedError, InvalidHwpxFormatError } from "./errors.js";

const DECODER_UTF8 = new TextDecoder("utf-8");
const DECODER_UTF16LE = new TextDecoder("utf-16le");
const DECODER_UTF16BE = new TextDecoder("utf-16be");

function detectTextEncoding(bytes: Uint8Array): "utf-8" | "utf-16le" | "utf-16be" {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  // Heuristic: many zeros on odd/even positions → UTF-16
  let zeroEven = 0, zeroOdd = 0, sample = Math.min(bytes.length, 1024);
  for (let i = 0; i < sample; i++) {
    if (bytes[i] === 0) (i % 2 === 0 ? zeroEven++ : zeroOdd++);
  }
  if (zeroOdd > zeroEven * 2) return "utf-16le"; // LE: xx 00 xx 00
  if (zeroEven > zeroOdd * 2) return "utf-16be"; // BE: 00 xx 00 xx
  return "utf-8";
}

function decodeBytesSmart(bytes: Uint8Array): string {
  const enc = detectTextEncoding(bytes);
  // Strip BOM
  if (enc === "utf-8" && bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return DECODER_UTF8.decode(bytes.subarray(3));
  }
  if (enc === "utf-16le" && bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return DECODER_UTF16LE.decode(bytes.subarray(2));
  }
  if (enc === "utf-16be" && bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return DECODER_UTF16BE.decode(bytes.subarray(2));
  }
  if (enc === "utf-8") return DECODER_UTF8.decode(bytes);
  if (enc === "utf-16le") return DECODER_UTF16LE.decode(bytes);
  return DECODER_UTF16BE.decode(bytes);
}

function getOrEmpty<T>(value: T | undefined): T | undefined {
  return value ?? undefined;
}

/**
 * fast-xml-parser 의 텍스트 노드는 string 외에도 number/boolean 또는 객체({#text})/배열 형태로
 * 등장할 수 있다. 모든 케이스를 문자열로 정규화하여 pieces 에 추가한다.
 */
function escapeMd(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/([*_`~])/g, "\\$1")
    .replace(/^([#>])/gm, "\\$1");
}

function pushTextNode(t: any, pieces: string[]): void {
  if (t === undefined || t === null) return;
  if (typeof t === "string") {
    pieces.push(t);
    return;
  }
  if (typeof t === "number" || typeof t === "boolean") {
    pieces.push(String(t));
    return;
  }
  if (Array.isArray(t)) {
    for (const item of t) pushTextNode(item, pieces);
    return;
  }
  if (typeof t === "object") {
    const inner = t["#text"];
    if (inner !== undefined) pushTextNode(inner, pieces);
  }
}

export class HwpxReader implements HwpxReaderInterface {
  private zip: JSZip | null = null;
  private files: HwpxFileMap = {};
  private encryptedCache: boolean | null = null;
  private characterProperties: Map<string, any> = new Map();
  private fontFaces: Map<string, any> = new Map();

  async loadFromArrayBuffer(buffer: ArrayBuffer): Promise<void> {
    const zip = await JSZip.loadAsync(buffer);
    this.zip = zip;
    this.files = {};

    const entries = Object.keys(zip.files);
    await Promise.all(
      entries.map(async (name) => {
        const file = zip.file(name);
        if (!file) return;
        // store raw bytes for flexible processing (images, xml, etc.)
        this.files[name] = new Uint8Array(await file.async("uint8array"));
      })
    );

    // Validate mimetype (per spec: application/owpml). 다양한 변형을 수용하고, 불일치 시에도 진행.
    const mime = this.getTextFile("mimetype")?.trim();
    if (mime && !this.isLikelyHwpxMime(mime)) {
      // 엄격 차단 대신 경고성 에러로 유지하려면 throw를 피한다.
      // throw new InvalidHwpxFormatError();
    }

    // Try to locate content via META-INF/container.xml if present (not mandatory but helpful)
    const containerXml = this.getTextFile("META-INF/container.xml");
    if (containerXml) {
      const cx = this.parseXml<any>(containerXml);
      // not strictly necessary now; reserved for future rootfile discovery
      void cx;
    }

    // Parse styles from header.xml
    this.parseStyleDefinitions();
  }

  private isLikelyHwpxMime(m: string): boolean {
    const s = m.toLowerCase();
    // 허용: application/owpml, application/owpml+xml, application/vnd.hancom.hwpx(추정), hwpx/owpml 포함 케이스
    return s === "application/owpml" || s.includes("owpml") || s.includes("hwpx");
  }

  private getTextFile(path: string): string | null {
    const bytes = this.files[path];
    if (!bytes) return null;
    return decodeBytesSmart(bytes);
  }

  private findFilePathIgnoreCase(targetPath: string): string | null {
    const lower = targetPath.toLowerCase();
    for (const key of Object.keys(this.files)) {
      if (key.toLowerCase() === lower) return key;
    }
    return null;
  }

  private parseXml<T = any>(xml: string): T | null {
    try {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@",
        // 텍스트 내부 공백 보존 — `<hp:t>이것은 </hp:t>` 같은 run 사이 공백이 사라지지 않도록
        trimValues: false,
        removeNSPrefix: true,
        // 텍스트 노드 자동 타입 변환 끄기 — "1", "true" 등이 number/boolean 으로 변환되는 것을 방지
        parseTagValue: false,
        parseAttributeValue: false,
      });
      const obj = parser.parse(xml);
      return obj as T;
    } catch (_err) {
      return null;
    }
  }

  private summarizePackage(): HwpxPackageSummary {
    const hasEncryptionInfo = this.detectEncryption();
    const contentsFiles = Object.keys(this.files).filter((p) => p.startsWith("Contents/")).sort();
    const contentHpf = this.getTextFile("Contents/content.hpf");
    let manifest; 
    let spine;
    if (contentHpf) {
      const xml = this.parseXml<any>(contentHpf);
      const pkg = xml?.package ?? xml?.opf?.package;
      const man = pkg?.manifest?.item;
      if (man) {
        const items = Array.isArray(man) ? man : [man];
        manifest = items.map((it: any) => ({
          id: it?.["@id"],
          href: it?.["@href"],
          mediaType: it?.["@media-type"] ?? it?.["@mediaType"],
        }));
      }
      const sp = pkg?.spine?.itemref ?? pkg?.spine?.itemRef;
      if (sp) {
        const refs = Array.isArray(sp) ? sp : [sp];
        spine = refs.map((r: any) => r?.["@idref"] ?? r?.["@idRef"]).filter(Boolean);
      }
    }
    return { hasEncryptionInfo, contentsFiles, manifest, spine };
  }

  private getSectionPathsBySpine(): string[] | null {
    const contentHpf = this.getTextFile("Contents/content.hpf");
    if (!contentHpf) return null;
    const xml = this.parseXml<any>(contentHpf);
    const pkg = xml?.package ?? xml?.opf?.package;
    const man = pkg?.manifest?.item;
    const map = new Map<string, string>(); // id -> href
    if (man) {
      const items = Array.isArray(man) ? man : [man];
      for (const it of items) {
        const id = it?.["@id"]; const href = it?.["@href"];
        if (id && href && /Contents\/section\d+\.xml$/i.test(href)) map.set(id, href);
      }
    }
    const sp = pkg?.spine?.itemref ?? pkg?.spine?.itemRef;
    const refs = sp ? (Array.isArray(sp) ? sp : [sp]) : [];
    const paths: string[] = [];
    for (const r of refs) {
      const id = r?.["@idref"] ?? r?.["@idRef"];
      const href = id ? map.get(id) : undefined;
      if (href && this.files[href]) paths.push(href);
    }
    return paths.length ? paths : null;
  }

  private detectEncryption(): boolean {
    if (this.encryptedCache !== null) return this.encryptedCache;
    const manifestXml = this.getTextFile("META-INF/manifest.xml");
    if (!manifestXml) {
      this.encryptedCache = false;
      return false;
    }
    const obj = this.parseXml<any>(manifestXml);
    const has = this.containsEncryptionMarker(obj);
    this.encryptedCache = !!has;
    return this.encryptedCache;
  }

  private containsEncryptionMarker(node: any): boolean {
    if (!node) return false;
    if (typeof node === "string") {
      return /encrypt|cipher/i.test(node);
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        if (this.containsEncryptionMarker(item)) return true;
      }
      return false;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (/encrypt|cipher/i.test(k)) return true;
        if (typeof v === "string" && /encrypt|cipher/i.test(v)) return true;
        if (this.containsEncryptionMarker(v)) return true;
      }
    }
    return false;
  }

  private readMetadata(): HwpxMetadata {
    const contentHpf = this.getTextFile("Contents/content.hpf");
    const metadata: HwpxMetadata = {};
    if (contentHpf) {
      const xml = this.parseXml<any>(contentHpf);
      // OPF-like: package > metadata
      const md = xml?.package?.metadata;
      if (md) {
        metadata.title = getOrEmpty<string>(md["dc:title"] ?? md.title);
        metadata.creator = getOrEmpty<string>(md["dc:creator"] ?? md.creator);
        metadata.created = getOrEmpty<string>(md["dcterms:created"] ?? md.created);
        metadata.modified = getOrEmpty<string>(md["dcterms:modified"] ?? md.modified);
      }
    }

    const versionXml = this.getTextFile("version.xml");
    if (versionXml) {
      const v = this.parseXml<any>(versionXml);
      const ver = v?.Version?.OWPMLVersion ?? v?.version?.owpmlVersion;
      if (typeof ver === "string") {
        metadata.version = ver;
      }
    }
    const settingsXml = this.getTextFile("settings.xml");
    if (settingsXml) {
      const s = this.parseXml<any>(settingsXml);
      // 표준 예시: ha:HWPApplicationSetting > ha:CaretPosition(listIDRef, paraIDRef, pos)
      const app = s?.HWPApplicationSetting ?? s?.Settings ?? s?.settings;
      const caret = app?.CaretPosition ?? app?.caretPosition;
      if (caret && (caret["@listIDRef"] || caret["@paraIDRef"] || caret["@pos"])) {
        const listId = caret["@listIDRef"] ?? "0";
        const paraId = caret["@paraIDRef"] ?? "0";
        const pos = caret["@pos"] ?? "0";
        metadata.caretPosition = `${listId}:${paraId}:${pos}`;
      }
    }
    return metadata;
  }

  async getDocumentInfo(): Promise<HwpxDocumentInfo> {
    if (!this.zip) throw new HwpxNotLoadedError();
    const summary = this.summarizePackage();
    const metadata = this.readMetadata();
    return { metadata, summary };
  }

  async extractText(options?: HwpxTextExtractOptions): Promise<string> {
    if (!this.zip) throw new HwpxNotLoadedError();
    const summary = this.summarizePackage();
    if (summary.hasEncryptionInfo) {
      throw new HwpxEncryptedDocumentError();
    }
    // HWPX 본문: Contents/section*.xml 에서 hp:t 텍스트를 추출
    const joiner = options?.joinParagraphs ?? "\n";
    let sectionPaths = this.getSectionPathsBySpine() ?? Object.keys(this.files)
      .filter((p) => /^contents\/section\d+\.xml$/.test(p.toLowerCase()))
      .sort((a, b) => {
        const na = Number(a.match(/section(\d+)\.xml/)?.[1] ?? 0);
        const nb = Number(b.match(/section(\d+)\.xml/)?.[1] ?? 0);
        return na - nb;
      });

    // Fallback: 탐색에 실패하면 Contents/*.xml 중 루트가 section 인 파일을 수색
    if (sectionPaths.length === 0) {
      const candidates = Object.keys(this.files).filter((p) => p.startsWith("Contents/") && p.toLowerCase().endsWith(".xml"));
      for (const p of candidates) {
        const xmlText = this.getTextFile(p);
        if (!xmlText) continue;
        const xml = this.parseXml<any>(xmlText);
        if (xml && (xml.sec || xml.section || xml["hp:section"])) {
          sectionPaths.push(p);
        }
      }
      sectionPaths.sort((a, b) => {
        const na = Number(a.match(/section(\d+)\.xml/)?.[1] ?? 0);
        const nb = Number(b.match(/section(\d+)\.xml/)?.[1] ?? 0);
        return na - nb;
      });
    }

    const paragraphs: string[] = [];

    for (const path of sectionPaths) {
      const xmlText = this.getTextFile(path);
      if (!xmlText) continue;
      const xml = this.parseXml<any>(xmlText);
      // 구조 참고: sec > p* > run* > t, 네임스페이스 제거됨
      const section = xml?.sec ?? xml?.section ?? xml?.["hp:section"];
      if (!section) {
        const segs: string[] = [];
        this.collectAllText(xml, segs);
        if (segs.length) paragraphs.push(segs.join(""));
        continue;
      }
      const ps = section?.p ?? section?.["hp:p"];
      if (!ps) {
        const segs: string[] = [];
        this.collectAllText(section, segs);
        if (segs.length) paragraphs.push(segs.join(""));
        continue;
      }
      const paras = Array.isArray(ps) ? ps : [ps];
      for (const p of paras) {
        paragraphs.push(this.extractParagraphText(p));
      }
    }

    const combined = paragraphs.join(joiner);
    if (combined.trim().length > 0) return combined;
    // Fallback: Preview text
    const prvPath =
      this.findFilePathIgnoreCase("Preview/PrvText.txt") ||
      this.findFilePathIgnoreCase("preview/prvtext.txt");
    if (prvPath) {
      const prv = this.getTextFile(prvPath);
      if (prv && prv.trim().length > 0) return prv;
    }
    return combined;
  }

  /**
   * 한 문단(<hp:p>)에서 텍스트를 추출. 표/이미지 등 인라인 컨트롤이 있으면 셀/내부 문단을 재귀 탐색.
   *
   * 표는 셀 단위로 텍스트를 모은 후 같은 행 내 셀은 공백으로, 행 사이는 줄바꿈으로 결합한다.
   */
  private extractParagraphText(p: any): string {
    const runs = p?.run ?? p?.["hp:run"];
    if (!runs) return "";
    const runArr = Array.isArray(runs) ? runs : [runs];
    const pieces: string[] = [];
    for (const run of runArr) {
      // 섹션/컬럼 설정 같은 메타 컨트롤은 텍스트 없음 — secPr/ctrl 안에 든 자식까지 무시
      if (run?.secPr || run?.ctrl) continue;

      // 직접 텍스트
      const t = run?.t ?? run?.["hp:t"];
      pushTextNode(t, pieces);

      // 표
      const tbl = run?.tbl ?? run?.["hp:tbl"];
      if (tbl) {
        const tbls = Array.isArray(tbl) ? tbl : [tbl];
        for (const tb of tbls) {
          pieces.push(this.extractTableText(tb));
        }
      }
    }
    return pieces.join("");
  }

  private extractTableText(tbl: any): string {
    const trs = tbl?.tr ?? tbl?.["hp:tr"];
    if (!trs) return "";
    const trArr = Array.isArray(trs) ? trs : [trs];
    const rowTexts: string[] = [];
    for (const tr of trArr) {
      const tcs = tr?.tc ?? tr?.["hp:tc"];
      if (!tcs) continue;
      const tcArr = Array.isArray(tcs) ? tcs : [tcs];
      const cellTexts: string[] = [];
      for (const tc of tcArr) {
        cellTexts.push(this.extractCellText(tc));
      }
      rowTexts.push(cellTexts.join(" "));
    }
    return rowTexts.join("\n");
  }

  private extractCellText(tc: any): string {
    const sub = tc?.subList ?? tc?.["hp:subList"];
    if (!sub) return "";
    const ps = sub?.p ?? sub?.["hp:p"];
    if (!ps) return "";
    const paras = Array.isArray(ps) ? ps : [ps];
    return paras.map((q: any) => this.extractParagraphText(q)).join("\n");
  }

  /**
   * 문서 전체를 Markdown 으로 변환.
   * 표는 마크다운 표 (셀 병합은 평탄화), 이미지는 `![](BinData/...)`.
   */
  async extractMarkdown(options?: { embedImages?: boolean; imageSrcResolver?: (binPath: string) => string }): Promise<string> {
    if (!this.zip) throw new HwpxNotLoadedError();
    const summary = this.summarizePackage();
    if (summary.hasEncryptionInfo) {
      throw new HwpxEncryptedDocumentError();
    }
    let sectionPaths = this.getSectionPathsBySpine() ?? Object.keys(this.files)
      .filter((p) => /^contents\/section\d+\.xml$/.test(p.toLowerCase()))
      .sort();
    if (sectionPaths.length === 0) {
      const candidates = Object.keys(this.files).filter((p) => p.startsWith("Contents/") && p.toLowerCase().endsWith(".xml"));
      for (const p of candidates) {
        const xmlText = this.getTextFile(p);
        if (!xmlText) continue;
        const xml = this.parseXml<any>(xmlText);
        if (xml && (xml.sec || xml.section || xml["hp:section"])) sectionPaths.push(p);
      }
    }

    const blocks: string[] = [];
    for (const path of sectionPaths) {
      const xmlText = this.getTextFile(path);
      if (!xmlText) continue;
      const xml = this.parseXml<any>(xmlText);
      const section = xml?.sec ?? xml?.section ?? xml?.["hp:section"];
      if (!section) continue;
      const ps = section?.p ?? section?.["hp:p"];
      if (!ps) continue;
      const paras = Array.isArray(ps) ? ps : [ps];
      for (const p of paras) {
        const md = this.extractParagraphMarkdown(p, options);
        if (md.trim().length > 0) blocks.push(md);
      }
    }
    return blocks.join("\n\n").trim() + "\n";
  }

  private extractParagraphMarkdown(
    p: any,
    options?: { embedImages?: boolean; imageSrcResolver?: (binPath: string) => string }
  ): string {
    const runs = p?.run ?? p?.["hp:run"];
    if (!runs) return "";
    const runArr = Array.isArray(runs) ? runs : [runs];
    const parts: string[] = [];

    let textBuf = "";
    for (const run of runArr) {
      if (run?.secPr || run?.ctrl) continue;

      // 텍스트 + charPrIDRef → 굵게/기울임 적용
      const t = run?.t ?? run?.["hp:t"];
      const pieces: string[] = [];
      pushTextNode(t, pieces);
      let raw = pieces.join("");
      if (raw.length > 0) {
        const charPrId = run?.["@charPrIDRef"];
        if (charPrId !== undefined && this.characterProperties.has(String(charPrId))) {
          const cs = this.characterProperties.get(String(charPrId));
          let s = escapeMd(raw);
          if (cs?.bold) s = `**${s}**`;
          if (cs?.italic) s = `*${s}*`;
          textBuf += s;
        } else {
          textBuf += escapeMd(raw);
        }
      }

      // 표
      const tbl = run?.tbl ?? run?.["hp:tbl"];
      if (tbl) {
        if (textBuf) {
          parts.push(textBuf);
          textBuf = "";
        }
        const tbls = Array.isArray(tbl) ? tbl : [tbl];
        for (const tb of tbls) parts.push(this.extractTableMarkdown(tb, options));
      }

      // 그림
      const pic = run?.pic ?? run?.["hp:pic"];
      if (pic) {
        if (textBuf) {
          parts.push(textBuf);
          textBuf = "";
        }
        const href = pic?.["@href"];
        const img = pic?.img ?? pic?.["hc:img"];
        const ref = img?.["@binaryItemIDRef"];
        const path = typeof href === "string" ? href : ref ? `BinData/${ref}` : "";
        if (path) {
          if (options?.embedImages) {
            const data = this.files[path];
            if (data) {
              const ext = path.split(".").pop()?.toLowerCase() ?? "";
              const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : "application/octet-stream";
              parts.push(`![](data:${mime};base64,${this.toBase64(data)})`);
            } else {
              parts.push(`![](${path})`);
            }
          } else if (options?.imageSrcResolver) {
            parts.push(`![](${options.imageSrcResolver(path)})`);
          } else {
            parts.push(`![](${path})`);
          }
        }
      }
    }
    if (textBuf) parts.push(textBuf);
    return parts.join("\n\n");
  }

  private extractTableMarkdown(
    tbl: any,
    options?: { embedImages?: boolean; imageSrcResolver?: (binPath: string) => string }
  ): string {
    const trs = tbl?.tr ?? tbl?.["hp:tr"];
    if (!trs) return "";
    const trArr = Array.isArray(trs) ? trs : [trs];

    // 행/셀 텍스트 모음 (병합은 무시 — 마크다운 표 한계)
    const rows: string[][] = [];
    let maxCols = 0;
    for (const tr of trArr) {
      const tcs = tr?.tc ?? tr?.["hp:tc"];
      if (!tcs) continue;
      const tcArr = Array.isArray(tcs) ? tcs : [tcs];
      const cellTexts: string[] = [];
      for (const tc of tcArr) {
        const sub = tc?.subList ?? tc?.["hp:subList"];
        if (!sub) {
          cellTexts.push("");
          continue;
        }
        const cps = sub?.p ?? sub?.["hp:p"];
        if (!cps) {
          cellTexts.push("");
          continue;
        }
        const cellParas = Array.isArray(cps) ? cps : [cps];
        const inner = cellParas
          .map((q: any) => this.extractParagraphMarkdown(q, options))
          .join(" ")
          .replace(/\n+/g, " ")
          .replace(/\|/g, "\\|");
        cellTexts.push(inner);
      }
      if (cellTexts.length > maxCols) maxCols = cellTexts.length;
      rows.push(cellTexts);
    }
    if (rows.length === 0) return "";
    // 모든 행의 셀 수를 maxCols 로 패딩
    for (const r of rows) {
      while (r.length < maxCols) r.push("");
    }
    const fmt = (cells: string[]) => `| ${cells.map((c) => c || " ").join(" | ")} |`;
    const lines: string[] = [];
    lines.push(fmt(rows[0]));
    lines.push(fmt(new Array(maxCols).fill("---")));
    for (let i = 1; i < rows.length; i++) lines.push(fmt(rows[i]));
    return lines.join("\n");
  }

  // 아주 단순한 텍스트 템플릿 치환: {{key}} → value (문단 텍스트에만 적용)
  applyTemplateToText(raw: string, data: Record<string, unknown>): string {
    return raw.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
      const value = key.split('.').reduce<any>((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), data);
      return value === undefined || value === null ? '' : String(value);
    });
  }

  async extractHtml(options?: HwpxHtmlOptions): Promise<string> {
    if (!this.zip) throw new HwpxNotLoadedError();
    const summary = this.summarizePackage();
    if (summary.hasEncryptionInfo) {
      throw new HwpxEncryptedDocumentError();
    }
    const paragraphTag = options?.paragraphTag ?? "p";
    const enableImages = options?.renderImages ?? true;
    const enableTables = options?.renderTables ?? true;
    const enableStyles = options?.renderStyles ?? true;
    let sectionPaths = this.getSectionPathsBySpine() ?? Object.keys(this.files)
      .filter((p) => /^contents\/section\d+\.xml$/.test(p.toLowerCase()))
      .sort((a, b) => {
        const na = Number(a.match(/section(\d+)\.xml/)?.[1] ?? 0);
        const nb = Number(b.match(/section(\d+)\.xml/)?.[1] ?? 0);
        return na - nb;
      });

    if (sectionPaths.length === 0) {
      const candidates = Object.keys(this.files).filter((p) => p.startsWith("Contents/") && p.toLowerCase().endsWith(".xml"));
      for (const p of candidates) {
        const xmlText = this.getTextFile(p);
        if (!xmlText) continue;
        const xml = this.parseXml<any>(xmlText);
        if (xml && (xml.sec || xml.section || xml["hp:section"])) {
          sectionPaths.push(p);
        }
      }
      sectionPaths.sort((a, b) => {
        const na = Number(a.match(/section(\d+)\.xml/)?.[1] ?? 0);
        const nb = Number(b.match(/section(\d+)\.xml/)?.[1] ?? 0);
        return na - nb;
      });
    }

    const tableClass = options?.tableClassName ?? "hwpx-table";
    const pieces: string[] = [];
    for (const path of sectionPaths) {
      const xmlText = this.getTextFile(path);
      if (!xmlText) continue;
      const xml = this.parseXml<any>(xmlText);
      const section = xml?.sec ?? xml?.section ?? xml?.["hp:section"];
      if (!section) continue;

      // paragraphs (표가 paragraph 안의 run 에 포함되어 있을 수 있으므로 분리 추출)
      const ps = section?.p ?? section?.["hp:p"];
      if (ps) {
        const paras = Array.isArray(ps) ? ps : [ps];
        for (const p of paras) {
          // 텍스트와 이미지 등 인라인 컨텐츠
          const inner = this.renderNodeToHtml(p, { enableImages, enableStyles }, options);
          const alignStyle = this.getAlignStyle(p);
          const styleAttr = alignStyle ? ` style="${alignStyle}"` : "";
          pieces.push(`<${paragraphTag}${styleAttr}>${inner}</${paragraphTag}>`);

          // paragraph 내 표는 <p> 형제 요소로 출력 (HTML 에서 <p> 안에 <table> 불가)
          if (enableTables) {
            for (const tbl of this.collectTablesInParagraph(p)) {
              pieces.push(this.renderTableHtml(tbl, tableClass, options));
            }
          }
        }
      }

      // section 직속 tables (구식 HWPX)
      const tbls = section?.tbl ?? section?.["hp:tbl"];
      if (tbls && enableTables) {
        const tables = Array.isArray(tbls) ? tbls : [tbls];
        for (const tbl of tables) {
          pieces.push(this.renderTableHtml(tbl, tableClass, options));
        }
      }
    }

    let html = pieces.join("");
    if (html.trim().length > 0) return html;
    // Fallback: Preview text
    const prvPath =
      this.findFilePathIgnoreCase("Preview/PrvText.txt") ||
      this.findFilePathIgnoreCase("preview/prvtext.txt");
    if (prvPath) {
      const prv = this.getTextFile(prvPath);
      if (prv && prv.trim().length > 0) {
        const escaped = this.escapeHtml(prv);
        html = `<p>${escaped.replace(/\n+/g, '</p><p>')}</p>`;
      }
    }
    return html;
  }

  private collectTablesInParagraph(p: any): any[] {
    const out: any[] = [];
    const runs = p?.run ?? p?.["hp:run"];
    if (!runs) return out;
    const runArr = Array.isArray(runs) ? runs : [runs];
    for (const run of runArr) {
      if (run?.secPr || run?.ctrl) continue;
      const tbl = run?.tbl ?? run?.["hp:tbl"];
      if (!tbl) continue;
      if (Array.isArray(tbl)) out.push(...tbl);
      else out.push(tbl);
    }
    return out;
  }

  private renderTableHtml(tbl: any, tableClass: string, options?: HwpxHtmlOptions): string {
    const trs = tbl?.tr ?? tbl?.["hp:tr"];
    const rows = trs ? (Array.isArray(trs) ? trs : [trs]) : [];
    const enableImages = options?.renderImages ?? true;
    const enableStyles = options?.renderStyles ?? true;
    const rowHtml: string[] = [];
    rows.forEach((tr: any, rowIndex: number) => {
      const tcs = tr?.tc ?? tr?.["hp:tc"];
      const cells = tcs ? (Array.isArray(tcs) ? tcs : [tcs]) : [];
      const cellHtml: string[] = [];
      for (const tc of cells) {
        // 셀 안 paragraph: <hp:tc><hp:subList><hp:p>...</hp:p></hp:subList></hp:tc>
        // 또는 직접 <hp:tc><hp:p>... 둘 다 지원
        const inner = this.renderCellContentHtml(tc, { enableImages, enableStyles }, options);
        const colSpan = tc?.["@colSpan"] ?? tc?.["@colspan"] ?? tc?.["@gridSpan"];
        const rowSpan = tc?.["@rowSpan"] ?? tc?.["@rowspan"];
        const alignStyle = this.getAlignStyle(tc);
        const attrs: string[] = [];
        if (colSpan && String(colSpan) !== "1") attrs.push(` colspan="${String(colSpan)}"`);
        if (rowSpan && String(rowSpan) !== "1") attrs.push(` rowspan="${String(rowSpan)}"`);
        if (alignStyle) attrs.push(` style="${alignStyle}"`);
        const isHeader = options?.tableHeaderFirstRow && rowIndex === 0;
        const tag = isHeader ? "th" : "td";
        cellHtml.push(`<${tag}${attrs.join("")}>${inner}</${tag}>`);
      }
      rowHtml.push(`<tr>${cellHtml.join("")}</tr>`);
    });
    return `<table class="${tableClass}">${rowHtml.join("")}</table>`;
  }

  private renderCellContentHtml(
    tc: any,
    flags: { enableImages: boolean; enableStyles: boolean },
    options?: HwpxHtmlOptions
  ): string {
    // subList 우선 (현대 HWPX), 없으면 tc 자체를 노드로 처리
    const sub = tc?.subList ?? tc?.["hp:subList"];
    if (sub) return this.renderNodeToHtml(sub, flags, options);
    return this.renderNodeToHtml(tc, flags, options);
  }

  private getAlignStyle(node: any): string | "" {
    const a = node?.["@align"] ?? node?.["@textAlign"] ?? node?.paraPr?.["@align"] ?? node?.cellPr?.["@align"];
    if (typeof a !== "string") return "";
    const v = a.toLowerCase();
    if (v === "center" || v === "right" || v === "left" || v === "justify") {
      return `text-align:${v}`;
    }
    return "";
  }

  private renderNodeToHtml(node: any, flags: { enableImages: boolean; enableStyles: boolean }, options?: HwpxHtmlOptions): string {
    if (!node) return "";
    // paragraph aggregation
    const ps = node?.["hp:p"] ?? node?.p;
    if (ps) {
      const paras = Array.isArray(ps) ? ps : [ps];
      return paras.map((p: any) => this.renderNodeToHtml(p, flags, options)).join("\n");
    }
    // runs
    const runs = node?.["hp:run"] ?? node?.run;
    const runArr = runs ? (Array.isArray(runs) ? runs : [runs]) : [];
    if (runArr.length > 0) {
      return runArr.map((run: any) => this.renderRunToHtml(run, flags, options)).join("");
    }
    // direct text
    if (typeof node === "string") return this.escapeHtml(node);
    if (typeof node?.["#text"] === "string") return this.escapeHtml(node["#text"]);
    return "";
  }

  private collectAllText(node: any, out: string[]): void {
    if (node == null) return;

    // 설정 관련 노드들은 건너뛰기
    if (typeof node === "object" && (node.secPr || node.ctrl || node.linesegarray)) {
      return;
    }

    if (typeof node === "string") {
      out.push(node);
      return;
    }

    if (typeof node === "object") {
      const text = (node as any)["#text"];
      if (typeof text === "string") out.push(text);

      // 't' 속성이 있으면 직접 추출
      const t = node.t;
      if (typeof t === "string") {
        out.push(t);
        return; // t가 있으면 더 이상 탐색하지 않음
      }

      for (const [k, v] of Object.entries(node)) {
        if (k === "#text" || k === "t") continue;
        // 설정 관련 키들은 건너뛰기
        if (k === "secPr" || k === "ctrl" || k === "linesegarray") continue;
        this.collectAllText(v, out);
      }
    }
  }

  private renderRunToHtml(run: any, flags: { enableImages: boolean; enableStyles: boolean }, options?: HwpxHtmlOptions): string {
    // 섹션 설정이나 컨트롤 정보가 있는 run은 건너뛰기
    if (run?.secPr || run?.ctrl) return "";

    // Text
    const t = run?.["hp:t"] ?? run?.t;
    const text = typeof t === "string" ? t : typeof t?.["#text"] === "string" ? t["#text"] : "";
    let html = this.escapeHtml(text);

    // Image (simplified): hp:picture or hp:img-like reference to BinData
    if (flags.enableImages) {
      const binRef = this.findBinRefInRun(run);
      if (typeof binRef === "string") {
        // Resolve binaryItemIDRef through manifest if needed
        const binPath = this.resolveBinaryPath(binRef);
        if (binPath) {
          let src: string;
          if (options?.embedImages) {
            const data = this.files[binPath];
            if (data) {
              const mime = this.detectMimeType(binPath);
              const b64 = this.toBase64(data);
              src = `data:${mime};base64,${b64}`;
            } else {
              src = binPath;
            }
          } else if (options?.imageSrcResolver) {
            src = options.imageSrcResolver(binPath);
          } else {
            src = binPath;
          }
          html += `<img src="${this.escapeHtml(src)}" alt="" />`;
        }
      }
    }

    // Styles: Resolve charPrIDRef to actual character properties
    if (flags.enableStyles) {
      const charPrId = run?.["@charPrIDRef"];
      if (charPrId && this.characterProperties.has(charPrId)) {
        const charProps = this.characterProperties.get(charPrId);
        let open = "";
        let close = "";
        const styleParts: string[] = [];

        // Apply formatting
        if (charProps?.bold) {
          open += "<strong>";
          close = "</strong>" + close;
        }
        if (charProps?.italic) {
          open += "<em>";
          close = "</em>" + close;
        }

        // Handle underline
        if (charProps?.underline && charProps.underline?.["@type"] !== "NONE") {
          styleParts.push("text-decoration:underline");
        }

        // Handle color
        if (charProps?.textColor && charProps.textColor !== "#000000") {
          styleParts.push(`color:${this.normalizeColor(charProps.textColor)}`);
        }

        // Handle font size (convert HWPUNIT to points)
        if (charProps?.height) {
          const sizeInPt = this.convertHwpUnitToPoints(charProps.height);
          styleParts.push(`font-size:${sizeInPt}pt`);
        }

        // Handle background color
        if (charProps?.shadeColor && charProps.shadeColor !== "none" && charProps.shadeColor !== "#FFFFFF") {
          styleParts.push(`background-color:${this.normalizeColor(charProps.shadeColor)}`);
        }

        const styleAttr = styleParts.length ? ` style="${styleParts.join(";")}"` : "";
        if (open || styleAttr) {
          html = `${open}<span${styleAttr}>${html}</span>${close}`;
        }
      }
    }

    return html;
  }

  private findBinRefInRun(run: any): string | undefined {
    // common patterns - note: XML parser removes namespaces, so hp:pic becomes 'pic', hc:img becomes 'img'
    const pic = run?.["hp:picture"] ?? run?.picture ?? run?.pic;
    const draw = run?.["hp:draw"] ?? run?.draw;
    const img = run?.["hp:img"] ?? run?.img;
    const hcImg = run?.["hc:img"] ?? run?.["hp:hc:img"];

    const tryExtract = (node: any): string | undefined => {
      if (!node) return undefined;

      // Check for binaryItemIDRef attribute (used by hc:img)
      const binaryRef = node?.["@binaryItemIDRef"];
      if (typeof binaryRef === "string") return binaryRef;

      // For picture elements, the img may be nested inside (hc:img becomes nested img)
      const nestedImg = node?.img;
      if (nestedImg && typeof nestedImg?.["@binaryItemIDRef"] === "string") {
        return nestedImg["@binaryItemIDRef"];
      }

      // Check for traditional hp:binItem reference
      const ref = node?.["hp:binItem"]?.["@ref"] ?? node?.binItem?.["@ref"] ?? node?.["@ref"];
      if (typeof ref === "string") return ref;
      return undefined;
    };

    return tryExtract(pic) || tryExtract(draw) || tryExtract(img) || tryExtract(hcImg);
  }

  private resolveBinaryPath(binRef: string): string | undefined {
    // First, try direct path (legacy format)
    const directPath = `BinData/${binRef}`;
    if (this.files[directPath]) {
      return directPath;
    }

    // Try to resolve through manifest
    try {
      const summary = this.summarizePackage();
      if (summary.manifest) {
        const manifestItem = summary.manifest.find(item => item.id === binRef);
        if (manifestItem?.href) {
          // The href might include the full path or relative path
          const resolvedPath = manifestItem.href.startsWith('BinData/')
            ? manifestItem.href
            : `BinData/${manifestItem.href}`;
          if (this.files[resolvedPath]) {
            return resolvedPath;
          }
          // Try the href as-is
          if (this.files[manifestItem.href]) {
            return manifestItem.href;
          }
        }
      }
    } catch (e) {
      // Fall back if manifest parsing fails
    }

    // Fallback: return the direct path even if file doesn't exist
    return directPath;
  }

  private normalizeColor(c: string): string {
    const s = c.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(s)) return s.startsWith('#') ? s : `#${s}`;
    return s; // fallback as-is
  }

  private normalizeSize(sz: string | number): string {
    const n = typeof sz === 'number' ? sz : Number(sz);
    if (!isNaN(n)) return `${n}pt`;
    return String(sz);
  }

  private convertHwpUnitToPoints(hwpUnit: string | number): number {
    // HWPUNIT is approximately 1/100th of a point
    // 1000 HWPUNIT = 10 points
    const units = typeof hwpUnit === 'number' ? hwpUnit : parseInt(String(hwpUnit), 10);
    return Math.round((units / 100) * 10) / 10; // Round to 1 decimal place
  }

  private parseStyleDefinitions(): void {
    // Clear existing definitions
    this.characterProperties.clear();
    this.fontFaces.clear();

    // Find and parse header.xml
    const headerXml = this.getTextFile("Contents/header.xml");
    if (!headerXml) return;

    try {
      const header = this.parseXml<any>(headerXml);
      const root = header?.head ?? header;
      if (!root) return;

      // Character properties are in head/refList/charProperties
      const refList = root?.refList;
      if (!refList) return;

      // Parse font faces
      const fontfaces = refList?.fontfaces;
      if (fontfaces?.fontface) {
        const fonts = Array.isArray(fontfaces.fontface) ? fontfaces.fontface : [fontfaces.fontface];
        for (const font of fonts) {
          const id = font?.["@id"];
          if (id) {
            this.fontFaces.set(id, font);
          }
        }
      }

      // Parse character properties from refList
      const charProperties = refList?.charProperties;
      if (charProperties?.charPr) {
        const charPrs = Array.isArray(charProperties.charPr) ? charProperties.charPr : [charProperties.charPr];
        for (const charPr of charPrs) {
          const id = charPr?.["@id"];
          if (id) {
            this.characterProperties.set(id, this.processCharacterProperties(charPr));
          }
        }
      }
    } catch {
      // Silent fail - styles are optional
    }
  }

  private processCharacterProperties(charPr: any): any {
    // Bold is indicated by presence of <hh:bold/> element (after namespace removal, becomes 'bold')
    const hasBold = charPr?.bold !== undefined;
    const hasItalic = charPr?.italic !== undefined;

    return {
      height: charPr?.["@height"], // Font size in HWPUNIT
      textColor: charPr?.["@textColor"], // Text color
      shadeColor: charPr?.["@shadeColor"], // Background color
      bold: hasBold, // Bold formatting (element presence)
      italic: hasItalic, // Italic formatting (element presence)
      underline: charPr?.underline, // Underline info
      strikeout: charPr?.strikeout, // Strikeout info
      fontRef: charPr?.fontRef, // Font reference
      raw: charPr // Keep original for debugging
    };
  }

  private detectMimeType(path: string): string {
    const lower = path.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".bmp")) return "image/bmp";
    if (lower.endsWith(".webp")) return "image/webp";
    return "application/octet-stream";
  }

  private toBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64");
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    // btoa may not exist in Node, handled by Buffer path above
    // @ts-ignore
    return btoa(binary);
  }

  private extractTextFromNode(node: any): string {
    if (!node) return "";
    // hp:p → hp:run → hp:t
    const ps = node?.["hp:p"] ?? node?.p;
    if (ps) {
      const paras = Array.isArray(ps) ? ps : [ps];
      return paras.map((p: any) => this.extractTextFromNode(p)).join("\n");
    }
    const runs = node?.["hp:run"] ?? node?.run;
    const runArr = runs ? (Array.isArray(runs) ? runs : [runs]) : [];
    const textPieces: string[] = [];
    for (const run of runArr) {
      // 섹션 설정이나 컨트롤 정보가 있는 run은 건너뛰기
      if (run?.secPr || run?.ctrl) continue;

      const t = run?.["hp:t"] ?? run?.t;
      if (t === undefined || t === null) continue;
      if (typeof t === "string") textPieces.push(t);
      else if (typeof t?.["#text"] === "string") textPieces.push(t["#text"]);
    }
    if (textPieces.length > 0) return textPieces.join("");
    // direct text
    if (typeof node === "string") return node;
    if (typeof node?.["#text"] === "string") return node["#text"];
    return "";
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async listImages(): Promise<string[]> {
    if (!this.zip) throw new HwpxNotLoadedError();
    // 이미지: BinData/ 내 파일들 (원 규격상 다양한 바이너리 포함)
    return Object.keys(this.files)
      .filter((p) => p.startsWith("BinData/") && !p.endsWith("/"))
      .sort();
  }
}

export default HwpxReader;

