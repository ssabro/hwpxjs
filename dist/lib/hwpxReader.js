import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { HwpxEncryptedDocumentError, HwpxNotLoadedError } from "./errors.js";
const DECODER_UTF8 = new TextDecoder("utf-8");
const DECODER_UTF16LE = new TextDecoder("utf-16le");
const DECODER_UTF16BE = new TextDecoder("utf-16be");
function detectTextEncoding(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
        return "utf-8";
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
        return "utf-16le";
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
        return "utf-16be";
    // Heuristic: many zeros on odd/even positions → UTF-16
    let zeroEven = 0, zeroOdd = 0, sample = Math.min(bytes.length, 1024);
    for (let i = 0; i < sample; i++) {
        if (bytes[i] === 0)
            (i % 2 === 0 ? zeroEven++ : zeroOdd++);
    }
    if (zeroOdd > zeroEven * 2)
        return "utf-16le"; // LE: xx 00 xx 00
    if (zeroEven > zeroOdd * 2)
        return "utf-16be"; // BE: 00 xx 00 xx
    return "utf-8";
}
function decodeBytesSmart(bytes) {
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
    if (enc === "utf-8")
        return DECODER_UTF8.decode(bytes);
    if (enc === "utf-16le")
        return DECODER_UTF16LE.decode(bytes);
    return DECODER_UTF16BE.decode(bytes);
}
function getOrEmpty(value) {
    return value ?? undefined;
}
export class HwpxReader {
    zip = null;
    files = {};
    encryptedCache = null;
    async loadFromArrayBuffer(buffer) {
        const zip = await JSZip.loadAsync(buffer);
        this.zip = zip;
        this.files = {};
        const entries = Object.keys(zip.files);
        await Promise.all(entries.map(async (name) => {
            const file = zip.file(name);
            if (!file)
                return;
            // store raw bytes for flexible processing (images, xml, etc.)
            this.files[name] = new Uint8Array(await file.async("uint8array"));
        }));
        // Validate mimetype (per spec: application/owpml). 다양한 변형을 수용하고, 불일치 시에도 진행.
        const mime = this.getTextFile("mimetype")?.trim();
        if (mime && !this.isLikelyHwpxMime(mime)) {
            // 엄격 차단 대신 경고성 에러로 유지하려면 throw를 피한다.
            // throw new InvalidHwpxFormatError();
        }
        // Try to locate content via META-INF/container.xml if present (not mandatory but helpful)
        const containerXml = this.getTextFile("META-INF/container.xml");
        if (containerXml) {
            const cx = this.parseXml(containerXml);
            // not strictly necessary now; reserved for future rootfile discovery
            void cx;
        }
    }
    isLikelyHwpxMime(m) {
        const s = m.toLowerCase();
        // 허용: application/owpml, application/owpml+xml, application/vnd.hancom.hwpx(추정), hwpx/owpml 포함 케이스
        return s === "application/owpml" || s.includes("owpml") || s.includes("hwpx");
    }
    getTextFile(path) {
        const bytes = this.files[path];
        if (!bytes)
            return null;
        return decodeBytesSmart(bytes);
    }
    findFilePathIgnoreCase(targetPath) {
        const lower = targetPath.toLowerCase();
        for (const key of Object.keys(this.files)) {
            if (key.toLowerCase() === lower)
                return key;
        }
        return null;
    }
    parseXml(xml) {
        try {
            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: "@",
                trimValues: true,
                removeNSPrefix: true,
            });
            const obj = parser.parse(xml);
            return obj;
        }
        catch (_err) {
            return null;
        }
    }
    summarizePackage() {
        const hasEncryptionInfo = this.detectEncryption();
        const contentsFiles = Object.keys(this.files).filter((p) => p.startsWith("Contents/")).sort();
        const contentHpf = this.getTextFile("Contents/content.hpf");
        let manifest;
        let spine;
        if (contentHpf) {
            const xml = this.parseXml(contentHpf);
            const pkg = xml?.package ?? xml?.opf?.package;
            const man = pkg?.manifest?.item;
            if (man) {
                const items = Array.isArray(man) ? man : [man];
                manifest = items.map((it) => ({
                    id: it?.["@id"],
                    href: it?.["@href"],
                    mediaType: it?.["@media-type"] ?? it?.["@mediaType"],
                }));
            }
            const sp = pkg?.spine?.itemref ?? pkg?.spine?.itemRef;
            if (sp) {
                const refs = Array.isArray(sp) ? sp : [sp];
                spine = refs.map((r) => r?.["@idref"] ?? r?.["@idRef"]).filter(Boolean);
            }
        }
        return { hasEncryptionInfo, contentsFiles, manifest, spine };
    }
    getSectionPathsBySpine() {
        const contentHpf = this.getTextFile("Contents/content.hpf");
        if (!contentHpf)
            return null;
        const xml = this.parseXml(contentHpf);
        const pkg = xml?.package ?? xml?.opf?.package;
        const man = pkg?.manifest?.item;
        const map = new Map(); // id -> href
        if (man) {
            const items = Array.isArray(man) ? man : [man];
            for (const it of items) {
                const id = it?.["@id"];
                const href = it?.["@href"];
                if (id && href && /Contents\/section\d+\.xml$/i.test(href))
                    map.set(id, href);
            }
        }
        const sp = pkg?.spine?.itemref ?? pkg?.spine?.itemRef;
        const refs = sp ? (Array.isArray(sp) ? sp : [sp]) : [];
        const paths = [];
        for (const r of refs) {
            const id = r?.["@idref"] ?? r?.["@idRef"];
            const href = id ? map.get(id) : undefined;
            if (href && this.files[href])
                paths.push(href);
        }
        return paths.length ? paths : null;
    }
    detectEncryption() {
        if (this.encryptedCache !== null)
            return this.encryptedCache;
        const manifestXml = this.getTextFile("META-INF/manifest.xml");
        if (!manifestXml) {
            this.encryptedCache = false;
            return false;
        }
        const obj = this.parseXml(manifestXml);
        const has = this.containsEncryptionMarker(obj);
        this.encryptedCache = !!has;
        return this.encryptedCache;
    }
    containsEncryptionMarker(node) {
        if (!node)
            return false;
        if (typeof node === "string") {
            return /encrypt|cipher/i.test(node);
        }
        if (Array.isArray(node)) {
            for (const item of node) {
                if (this.containsEncryptionMarker(item))
                    return true;
            }
            return false;
        }
        if (typeof node === "object") {
            for (const [k, v] of Object.entries(node)) {
                if (/encrypt|cipher/i.test(k))
                    return true;
                if (typeof v === "string" && /encrypt|cipher/i.test(v))
                    return true;
                if (this.containsEncryptionMarker(v))
                    return true;
            }
        }
        return false;
    }
    readMetadata() {
        const contentHpf = this.getTextFile("Contents/content.hpf");
        const metadata = {};
        if (contentHpf) {
            const xml = this.parseXml(contentHpf);
            // OPF-like: package > metadata
            const md = xml?.package?.metadata;
            if (md) {
                metadata.title = getOrEmpty(md["dc:title"] ?? md.title);
                metadata.creator = getOrEmpty(md["dc:creator"] ?? md.creator);
                metadata.created = getOrEmpty(md["dcterms:created"] ?? md.created);
                metadata.modified = getOrEmpty(md["dcterms:modified"] ?? md.modified);
            }
        }
        const versionXml = this.getTextFile("version.xml");
        if (versionXml) {
            const v = this.parseXml(versionXml);
            const ver = v?.Version?.OWPMLVersion ?? v?.version?.owpmlVersion;
            if (typeof ver === "string") {
                metadata.version = ver;
            }
        }
        const settingsXml = this.getTextFile("settings.xml");
        if (settingsXml) {
            const s = this.parseXml(settingsXml);
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
    async getDocumentInfo() {
        if (!this.zip)
            throw new HwpxNotLoadedError();
        const summary = this.summarizePackage();
        const metadata = this.readMetadata();
        return { metadata, summary };
    }
    async extractText(options) {
        if (!this.zip)
            throw new HwpxNotLoadedError();
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
                if (!xmlText)
                    continue;
                const xml = this.parseXml(xmlText);
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
        const paragraphs = [];
        for (const path of sectionPaths) {
            const xmlText = this.getTextFile(path);
            if (!xmlText)
                continue;
            const xml = this.parseXml(xmlText);
            // 구조 참고: sec > p* > run* > t, 네임스페이스 제거됨
            const section = xml?.sec ?? xml?.section ?? xml?.["hp:section"];
            if (!section) {
                const segs = [];
                this.collectAllText(xml, segs);
                if (segs.length)
                    paragraphs.push(segs.join(""));
                continue;
            }
            const ps = section?.p ?? section?.["hp:p"];
            if (!ps) {
                const segs = [];
                this.collectAllText(section, segs);
                if (segs.length)
                    paragraphs.push(segs.join(""));
                continue;
            }
            const paras = Array.isArray(ps) ? ps : [ps];
            for (const p of paras) {
                const runs = p?.run ?? p?.["hp:run"];
                if (!runs) {
                    // 빈 문단 처리
                    paragraphs.push("");
                    continue;
                }
                const runArr = Array.isArray(runs) ? runs : [runs];
                const textPieces = [];
                for (const run of runArr) {
                    // 섹션 설정이나 컨트롤 정보가 있는 run은 건너뛰기
                    if (run?.secPr || run?.ctrl)
                        continue;
                    const t = run?.t ?? run?.["hp:t"];
                    if (t === undefined || t === null)
                        continue;
                    if (typeof t === "string")
                        textPieces.push(t);
                    else if (typeof t["#text"] === "string")
                        textPieces.push(t["#text"]);
                }
                paragraphs.push(textPieces.join(""));
            }
        }
        const combined = paragraphs.join(joiner);
        if (combined.trim().length > 0)
            return combined;
        // Fallback: Preview text
        const prvPath = this.findFilePathIgnoreCase("Preview/PrvText.txt") ||
            this.findFilePathIgnoreCase("preview/prvtext.txt");
        if (prvPath) {
            const prv = this.getTextFile(prvPath);
            if (prv && prv.trim().length > 0)
                return prv;
        }
        return combined;
    }
    // 아주 단순한 텍스트 템플릿 치환: {{key}} → value (문단 텍스트에만 적용)
    applyTemplateToText(raw, data) {
        return raw.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
            const value = key.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), data);
            return value === undefined || value === null ? '' : String(value);
        });
    }
    async extractHtml(options) {
        if (!this.zip)
            throw new HwpxNotLoadedError();
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
                if (!xmlText)
                    continue;
                const xml = this.parseXml(xmlText);
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
        const pieces = [];
        for (const path of sectionPaths) {
            const xmlText = this.getTextFile(path);
            if (!xmlText)
                continue;
            const xml = this.parseXml(xmlText);
            const section = xml?.sec ?? xml?.section ?? xml?.["hp:section"];
            if (!section)
                continue;
            // paragraphs
            const ps = section?.p ?? section?.["hp:p"];
            if (ps) {
                const paras = Array.isArray(ps) ? ps : [ps];
                for (const p of paras) {
                    const inner = this.renderNodeToHtml(p, { enableImages, enableStyles }, options);
                    const alignStyle = this.getAlignStyle(p);
                    const styleAttr = alignStyle ? ` style="${alignStyle}"` : "";
                    pieces.push(`<${paragraphTag}${styleAttr}>${inner}</${paragraphTag}>`);
                }
            }
            // minimal tables: hp:tbl > hp:tr > hp:tc (cells)
            const tbls = section?.tbl ?? section?.["hp:tbl"];
            if (tbls && enableTables) {
                const tableClass = options?.tableClassName ?? "hwpx-table";
                const tables = Array.isArray(tbls) ? tbls : [tbls];
                for (const tbl of tables) {
                    const trs = tbl?.tr ?? tbl?.["hp:tr"];
                    const rows = trs ? (Array.isArray(trs) ? trs : [trs]) : [];
                    const rowHtml = [];
                    rows.forEach((tr, rowIndex) => {
                        const tcs = tr?.tc ?? tr?.["hp:tc"];
                        const cells = tcs ? (Array.isArray(tcs) ? tcs : [tcs]) : [];
                        const cellHtml = [];
                        for (const tc of cells) {
                            // cell may contain paragraphs/runs
                            const inner = this.renderNodeToHtml(tc, { enableImages, enableStyles }, options);
                            const colSpan = tc?.["@colSpan"] ?? tc?.["@colspan"] ?? tc?.["@gridSpan"];
                            const rowSpan = tc?.["@rowSpan"] ?? tc?.["@rowspan"];
                            const alignStyle = this.getAlignStyle(tc);
                            const attrs = [];
                            if (colSpan && String(colSpan) !== "1")
                                attrs.push(` colspan=\"${String(colSpan)}\"`);
                            if (rowSpan && String(rowSpan) !== "1")
                                attrs.push(` rowspan=\"${String(rowSpan)}\"`);
                            if (alignStyle)
                                attrs.push(` style=\"${alignStyle}\"`);
                            const isHeader = options?.tableHeaderFirstRow && rowIndex === 0;
                            const tag = isHeader ? "th" : "td";
                            cellHtml.push(`<${tag}${attrs.join("")}>${inner}</${tag}>`);
                        }
                        rowHtml.push(`<tr>${cellHtml.join("")}</tr>`);
                    });
                    pieces.push(`<table class="${tableClass}">${rowHtml.join("")}</table>`);
                }
            }
        }
        let html = pieces.join("");
        if (html.trim().length > 0)
            return html;
        // Fallback: Preview text
        const prvPath = this.findFilePathIgnoreCase("Preview/PrvText.txt") ||
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
    getAlignStyle(node) {
        const a = node?.["@align"] ?? node?.["@textAlign"] ?? node?.paraPr?.["@align"] ?? node?.cellPr?.["@align"];
        if (typeof a !== "string")
            return "";
        const v = a.toLowerCase();
        if (v === "center" || v === "right" || v === "left" || v === "justify") {
            return `text-align:${v}`;
        }
        return "";
    }
    renderNodeToHtml(node, flags, options) {
        if (!node)
            return "";
        // paragraph aggregation
        const ps = node?.["hp:p"] ?? node?.p;
        if (ps) {
            const paras = Array.isArray(ps) ? ps : [ps];
            return paras.map((p) => this.renderNodeToHtml(p, flags, options)).join("\n");
        }
        // runs
        const runs = node?.["hp:run"] ?? node?.run;
        const runArr = runs ? (Array.isArray(runs) ? runs : [runs]) : [];
        if (runArr.length > 0) {
            return runArr.map((run) => this.renderRunToHtml(run, flags, options)).join("");
        }
        // direct text
        if (typeof node === "string")
            return this.escapeHtml(node);
        if (typeof node?.["#text"] === "string")
            return this.escapeHtml(node["#text"]);
        return "";
    }
    collectAllText(node, out) {
        if (node == null)
            return;
        // 설정 관련 노드들은 건너뛰기
        if (typeof node === "object" && (node.secPr || node.ctrl || node.linesegarray)) {
            return;
        }
        if (typeof node === "string") {
            out.push(node);
            return;
        }
        if (typeof node === "object") {
            const text = node["#text"];
            if (typeof text === "string")
                out.push(text);
            // 't' 속성이 있으면 직접 추출
            const t = node.t;
            if (typeof t === "string") {
                out.push(t);
                return; // t가 있으면 더 이상 탐색하지 않음
            }
            for (const [k, v] of Object.entries(node)) {
                if (k === "#text" || k === "t")
                    continue;
                // 설정 관련 키들은 건너뛰기
                if (k === "secPr" || k === "ctrl" || k === "linesegarray")
                    continue;
                this.collectAllText(v, out);
            }
        }
    }
    renderRunToHtml(run, flags, options) {
        // 섹션 설정이나 컨트롤 정보가 있는 run은 건너뛰기
        if (run?.secPr || run?.ctrl)
            return "";
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
                    let src;
                    if (options?.embedImages) {
                        const data = this.files[binPath];
                        if (data) {
                            const mime = this.detectMimeType(binPath);
                            const b64 = this.toBase64(data);
                            src = `data:${mime};base64,${b64}`;
                        }
                        else {
                            src = binPath;
                        }
                    }
                    else if (options?.imageSrcResolver) {
                        src = options.imageSrcResolver(binPath);
                    }
                    else {
                        src = binPath;
                    }
                    html += `<img src="${this.escapeHtml(src)}" alt="" />`;
                }
            }
        }
        // Styles (very minimal): bold/italic/underline
        if (flags.enableStyles) {
            const charPr = run?.["hp:charPr"] ?? run?.charPr;
            let open = "";
            let close = "";
            const styleParts = [];
            const bold = charPr?.["@bold"] === "true" || charPr?.["@b"] === "true";
            const italic = charPr?.["@italic"] === "true" || charPr?.["@i"] === "true";
            const underline = charPr?.["@underline"] === "true" || charPr?.["@u"] === "true";
            const color = charPr?.["@color"] ?? charPr?.["@fontColor"];
            const size = charPr?.["@sz"] ?? charPr?.["@size"];
            if (bold) {
                open += "<strong>";
                close = "</strong>" + close;
            }
            if (italic) {
                open += "<em>";
                close = "</em>" + close;
            }
            if (underline)
                styleParts.push("text-decoration:underline");
            if (typeof color === "string" && color)
                styleParts.push(`color:${this.normalizeColor(color)}`);
            if (typeof size === "string" || typeof size === "number")
                styleParts.push(`font-size:${this.normalizeSize(size)}`);
            const styleAttr = styleParts.length ? ` style="${styleParts.join(";")}"` : "";
            if (open || styleAttr) {
                html = `${open}<span${styleAttr}>${html}</span>${close}`;
            }
        }
        return html;
    }
    findBinRefInRun(run) {
        // common patterns - note: XML parser removes namespaces, so hp:pic becomes 'pic', hc:img becomes 'img'
        const pic = run?.["hp:picture"] ?? run?.picture ?? run?.pic;
        const draw = run?.["hp:draw"] ?? run?.draw;
        const img = run?.["hp:img"] ?? run?.img;
        const hcImg = run?.["hc:img"] ?? run?.["hp:hc:img"];
        const tryExtract = (node) => {
            if (!node)
                return undefined;
            // Check for binaryItemIDRef attribute (used by hc:img)
            const binaryRef = node?.["@binaryItemIDRef"];
            if (typeof binaryRef === "string")
                return binaryRef;
            // For picture elements, the img may be nested inside (hc:img becomes nested img)
            const nestedImg = node?.img;
            if (nestedImg && typeof nestedImg?.["@binaryItemIDRef"] === "string") {
                return nestedImg["@binaryItemIDRef"];
            }
            // Check for traditional hp:binItem reference
            const ref = node?.["hp:binItem"]?.["@ref"] ?? node?.binItem?.["@ref"] ?? node?.["@ref"];
            if (typeof ref === "string")
                return ref;
            return undefined;
        };
        return tryExtract(pic) || tryExtract(draw) || tryExtract(img) || tryExtract(hcImg);
    }
    resolveBinaryPath(binRef) {
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
        }
        catch (e) {
            // Fall back if manifest parsing fails
        }
        // Fallback: return the direct path even if file doesn't exist
        return directPath;
    }
    normalizeColor(c) {
        const s = c.trim();
        if (/^#?[0-9a-fA-F]{6}$/.test(s))
            return s.startsWith('#') ? s : `#${s}`;
        return s; // fallback as-is
    }
    normalizeSize(sz) {
        const n = typeof sz === 'number' ? sz : Number(sz);
        if (!isNaN(n))
            return `${n}pt`;
        return String(sz);
    }
    detectMimeType(path) {
        const lower = path.toLowerCase();
        if (lower.endsWith(".png"))
            return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
            return "image/jpeg";
        if (lower.endsWith(".gif"))
            return "image/gif";
        if (lower.endsWith(".bmp"))
            return "image/bmp";
        if (lower.endsWith(".webp"))
            return "image/webp";
        return "application/octet-stream";
    }
    toBase64(bytes) {
        if (typeof Buffer !== "undefined") {
            return Buffer.from(bytes).toString("base64");
        }
        let binary = "";
        for (let i = 0; i < bytes.length; i++)
            binary += String.fromCharCode(bytes[i]);
        // btoa may not exist in Node, handled by Buffer path above
        // @ts-ignore
        return btoa(binary);
    }
    extractTextFromNode(node) {
        if (!node)
            return "";
        // hp:p → hp:run → hp:t
        const ps = node?.["hp:p"] ?? node?.p;
        if (ps) {
            const paras = Array.isArray(ps) ? ps : [ps];
            return paras.map((p) => this.extractTextFromNode(p)).join("\n");
        }
        const runs = node?.["hp:run"] ?? node?.run;
        const runArr = runs ? (Array.isArray(runs) ? runs : [runs]) : [];
        const textPieces = [];
        for (const run of runArr) {
            // 섹션 설정이나 컨트롤 정보가 있는 run은 건너뛰기
            if (run?.secPr || run?.ctrl)
                continue;
            const t = run?.["hp:t"] ?? run?.t;
            if (t === undefined || t === null)
                continue;
            if (typeof t === "string")
                textPieces.push(t);
            else if (typeof t?.["#text"] === "string")
                textPieces.push(t["#text"]);
        }
        if (textPieces.length > 0)
            return textPieces.join("");
        // direct text
        if (typeof node === "string")
            return node;
        if (typeof node?.["#text"] === "string")
            return node["#text"];
        return "";
    }
    escapeHtml(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }
    async listImages() {
        if (!this.zip)
            throw new HwpxNotLoadedError();
        // 이미지: BinData/ 내 파일들 (원 규격상 다양한 바이너리 포함)
        return Object.keys(this.files)
            .filter((p) => p.startsWith("BinData/") && !p.endsWith("/"))
            .sort();
    }
}
export default HwpxReader;
