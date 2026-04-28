/**
 * HwpDocument IR → HWPX(OWPML) 패키지 빌더 (스타일 보존 포함).
 *
 * - DocInfo 의 fontFaces / charShapes / paraShapes / styles 를 header.xml refList 로 매핑
 * - paragraph: paraPrIDRef = paraShapeId, styleIDRef = styleId
 * - run: charPrIDRef = charShapeId
 * - 표/이미지 + BinData 패키징 + manifest 등록
 *
 * 1차 포팅 한계: BorderFill/Numbering/TabDef 는 paraShape 의 참조 ID 만 보존하고
 *               실제 정의는 default(0) 로 둠. 추후 단계에서 정의 자체도 옮길 예정.
 */

import JSZip from "jszip";
import type {
  HwpDocument,
  HwpDocInfo,
  HwpCharShape,
  HwpParaShape,
  HwpStyle,
  HwpFaceName,
  HwpBorderFill,
  HwpBorderLine,
  HwpNumbering,
  HwpBullet,
  HwpTabDef,
  HwpParagraph,
  HwpRun,
  HwpControl,
  HwpTableControl,
  HwpTableCell,
} from "./types.js";
import { detectImageMime } from "./binData.js";

const NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph";
const NS_HH = "http://www.hancom.co.kr/hwpml/2011/head";
const NS_HC = "http://www.hancom.co.kr/hwpml/2011/core";
const NS_HA = "http://www.hancom.co.kr/hwpml/2011/app";
const NS_HS = "http://www.hancom.co.kr/hwpml/2011/section";
const NS_OPF = "http://www.idpf.org/2007/opf/";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_OASIS_CONTAINER = "urn:oasis:names:tc:opendocument:xmlns:container";
const NS_OASIS_MANIFEST = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";

const LANG_NAMES = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"] as const;

const DEFAULT_LINESEG =
  `<hp:linesegarray>` +
  `<hp:lineseg hp:textpos="0" hp:vertpos="0" hp:vertsize="1000" hp:textheight="1000" hp:baseline="850" hp:spacing="600" hp:horzpos="0" hp:horzsize="42520" hp:flags="393216"/>` +
  `</hp:linesegarray>`;

export interface BuildOptions {
  title?: string;
  creator?: string;
}

interface BinEntry {
  id: string;
  href: string;
  mediaType: string;
  data: Uint8Array;
}

export async function buildHwpxFromDocument(
  doc: HwpDocument,
  options?: BuildOptions
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/owpml", { compression: "STORE" });

  // BinData 매니페스트 항목 사전 구성
  const binEntries: BinEntry[] = [];
  for (const [storageId, { data, extension }] of doc.binData) {
    const ext = extension.toLowerCase();
    binEntries.push({
      id: `image${storageId}`,
      href: `BinData/image${storageId}.${ext}`,
      mediaType: detectImageMime(ext),
      data,
    });
  }

  // META-INF/container.xml
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<container xmlns="${NS_OASIS_CONTAINER}">` +
      `<rootfiles>` +
      `<rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>` +
      `</rootfiles>` +
      `</container>`
  );

  // META-INF/manifest.xml
  const manifestEntries: string[] = [
    `<manifest:file-entry manifest:full-path="/" manifest:media-type="application/hwpml-package+xml"/>`,
    `<manifest:file-entry manifest:full-path="version.xml" manifest:media-type="application/xml"/>`,
    `<manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="application/xml"/>`,
    `<manifest:file-entry manifest:full-path="Contents/content.hpf" manifest:media-type="application/hwpml-package+xml"/>`,
    `<manifest:file-entry manifest:full-path="Contents/header.xml" manifest:media-type="application/xml"/>`,
  ];
  for (let i = 0; i < doc.sections.length; i++) {
    manifestEntries.push(
      `<manifest:file-entry manifest:full-path="Contents/section${i}.xml" manifest:media-type="application/xml"/>`
    );
  }
  for (const e of binEntries) {
    manifestEntries.push(
      `<manifest:file-entry manifest:full-path="${e.href}" manifest:media-type="${e.mediaType}"/>`
    );
  }
  zip.file(
    "META-INF/manifest.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<manifest:manifest xmlns:manifest="${NS_OASIS_MANIFEST}">` +
      manifestEntries.join("") +
      `</manifest:manifest>`
  );

  // version.xml
  zip.file(
    "version.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<ha:HCFVersion xmlns:ha="${NS_HA}" ha:targetApplication="WORDPROCESSOR" ha:major="${doc.header.version.major}" ha:minor="${doc.header.version.minor}" ha:micro="${doc.header.version.build}" ha:buildNumber="${doc.header.version.revision}"/>`
  );

  // settings.xml
  zip.file(
    "settings.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<ha:HWPApplicationSetting xmlns:ha="${NS_HA}">` +
      `<ha:CaretPosition ha:listIDRef="0" ha:paraIDRef="0" ha:pos="0"/>` +
      `</ha:HWPApplicationSetting>`
  );

  // OPF 매니페스트 + spine
  const opfManifest: string[] = [
    `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>`,
  ];
  for (let i = 0; i < doc.sections.length; i++) {
    opfManifest.push(
      `<opf:item id="section${i}" href="Contents/section${i}.xml" media-type="application/xml"/>`
    );
  }
  for (const e of binEntries) {
    opfManifest.push(`<opf:item id="${e.id}" href="${e.href}" media-type="${e.mediaType}"/>`);
  }
  const spineRefs = doc.sections.map((_, i) => `<opf:itemref idref="section${i}"/>`).join("");
  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<opf:package xmlns:opf="${NS_OPF}" xmlns:dc="${NS_DC}" version="1.0">` +
      `<opf:metadata>` +
      `<dc:title>${escapeXml(options?.title ?? "")}</dc:title>` +
      `<dc:creator>${escapeXml(options?.creator ?? "")}</dc:creator>` +
      `<dc:format>application/hwpml-package+xml</dc:format>` +
      `</opf:metadata>` +
      `<opf:manifest>` +
      opfManifest.join("") +
      `</opf:manifest>` +
      `<opf:spine>` +
      spineRefs +
      `</opf:spine>` +
      `</opf:package>`
  );

  // header.xml — DocInfo 기반 풀 빌드
  zip.file("Contents/header.xml", buildHeaderXmlFromDocInfo(doc.docInfo));

  // 섹션
  for (let i = 0; i < doc.sections.length; i++) {
    zip.file(`Contents/section${i}.xml`, buildSectionXml(doc.sections[i].paragraphs, binEntries));
  }

  // BinData
  for (const e of binEntries) {
    zip.file(e.href, e.data);
  }

  // Preview/PrvText.txt — 다른 HWP 뷰어 호환을 위한 평문 미리보기
  zip.file("Preview/PrvText.txt", buildPrvText(doc));

  return await zip.generateAsync({ type: "uint8array" });
}

/**
 * 한컴 HWP/HWPX 의 Preview/PrvText.txt 형식을 따른 미리보기 평문 생성.
 *   - 셀은 "<셀텍스트 >" 로 감싸 행 단위로 나열
 *   - 행 사이는 \r\n
 *   - 일반 문단은 그대로
 */
function buildPrvText(doc: HwpDocument): string {
  const lines: string[] = [];
  for (const section of doc.sections) {
    for (const para of section.paragraphs) {
      collectPrvLines(para, lines);
    }
  }
  // 약 2KB 까지만 보존 (Hancom 제한)
  return lines.join("\r\n").slice(0, 2000);
}

function collectPrvLines(para: HwpParagraph, lines: string[]): void {
  if (para.text.length > 0) {
    lines.push(para.text);
  }
  for (const ctrl of para.controls) {
    if (ctrl.kind === "table") {
      // 행별로 셀을 < ... > 로 감싸 join
      const rows: HwpTableCell[][] = Array.from({ length: ctrl.rowCount }, () => []);
      for (const cell of ctrl.cells) {
        if (cell.row >= 0 && cell.row < ctrl.rowCount) rows[cell.row].push(cell);
      }
      for (const row of rows) {
        row.sort((a, b) => a.col - b.col);
        const cellTexts = row.map((cell) => {
          const inner = cell.paragraphs
            .map((q) => {
              const buf: string[] = [];
              collectPrvLines(q, buf);
              return buf.join(" ");
            })
            .join(" ");
          return `<${inner} >`;
        });
        if (cellTexts.length > 0) lines.push(cellTexts.join(""));
      }
    } else if (
      ctrl.kind === "header" ||
      ctrl.kind === "footer" ||
      ctrl.kind === "footnote"
    ) {
      for (const q of ctrl.paragraphs) collectPrvLines(q, lines);
    } else if (ctrl.kind === "equation" && ctrl.script.length > 0) {
      lines.push(ctrl.script);
    }
  }
}

// ============================================================
// header.xml 빌드 (DocInfo → refList)
// ============================================================

function buildHeaderXmlFromDocInfo(docInfo: HwpDocInfo): string {
  const fontfacesXml = buildFontfacesXml(docInfo.fontFaces);
  const borderFillsXml = buildBorderFillsXml(docInfo.borderFills);
  const charPropsXml = buildCharPropertiesXml(docInfo.charShapes);
  const tabDefsXml = buildTabDefsXml(docInfo.tabDefs);
  const numberingsXml = buildNumberingsXml(docInfo.numberings);
  const bulletsXml = buildBulletsXml(docInfo.bullets);
  const paraPropsXml = buildParaPropertiesXml(docInfo.paraShapes);
  const stylesXml = buildStylesXml(docInfo.styles);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<hh:head xmlns:hh="${NS_HH}" xmlns:hc="${NS_HC}">` +
    `<hh:beginNum hh:page="1" hh:footnote="1" hh:endnote="1" hh:pic="1" hh:tbl="1" hh:equation="1"/>` +
    `<hh:refList>` +
    fontfacesXml +
    borderFillsXml +
    charPropsXml +
    tabDefsXml +
    numberingsXml +
    bulletsXml +
    paraPropsXml +
    stylesXml +
    `</hh:refList>` +
    `</hh:head>`
  );
}

function buildBorderFillsXml(borderFills: HwpBorderFill[]): string {
  const cnt = Math.max(1, borderFills.length);
  const items: string[] = [];
  for (let i = 0; i < cnt; i++) {
    items.push(buildSingleBorderFillXml(i, borderFills[i]));
  }
  return `<hh:borderFills hh:itemCnt="${cnt}">${items.join("")}</hh:borderFills>`;
}

/** HWP 너비 인덱스 → mm 매핑 (HWP 5.0 스펙) */
const BORDER_WIDTH_MM = [
  "0.1", "0.12", "0.15", "0.2", "0.25", "0.3", "0.4", "0.5",
  "0.6", "0.7", "1.0", "1.5", "2.0", "3.0", "4.0", "5.0",
];

const BORDER_LINE_TYPE_NAMES = [
  "NONE", "SOLID", "DASH", "DOT", "DASH_DOT", "DASH_DOT_DOT", "LONG_DASH", "CIRCLE",
  "DOUBLE", "THIN_THICK_DOUBLE", "THICK_THIN_DOUBLE", "THIN_THICK_THIN_TRIPLE",
  "WAVE", "DOUBLE_WAVE", "THICK_3D", "THICK_3D_REVERSE", "THIN_3D", "THIN_3D_REVERSE",
];

function lineTypeName(idx: number): string {
  return BORDER_LINE_TYPE_NAMES[idx] ?? "SOLID";
}

function widthMm(idx: number): string {
  return (BORDER_WIDTH_MM[idx] ?? "0.1") + " mm";
}

function buildBorderXml(tagName: string, line: HwpBorderLine | undefined): string {
  if (!line) {
    return `<hh:${tagName} hh:type="SOLID" hh:width="0.1 mm" hh:color="#000000"/>`;
  }
  return `<hh:${tagName} hh:type="${lineTypeName(line.lineType)}" hh:width="${widthMm(line.widthIndex)}" hh:color="${colorBgrToHex(line.color)}"/>`;
}

function buildSingleBorderFillXml(id: number, bf?: HwpBorderFill): string {
  const left = buildBorderXml("leftBorder", bf?.borders?.[0]);
  const right = buildBorderXml("rightBorder", bf?.borders?.[1]);
  const top = buildBorderXml("topBorder", bf?.borders?.[2]);
  const bottom = buildBorderXml("bottomBorder", bf?.borders?.[3]);

  // BorderFill attr u16 비트필드:
  //   bit 0: 3D, bit 1: 그림자
  //   bit 2..4 (0x1C): slash 대각선 모양 — 0=NONE, 그 외=present
  //   bit 5..7 (0xE0): backSlash 대각선 모양
  const attr = bf?.attr ?? 0;
  const slashKind = (attr >>> 2) & 0x07;
  const backSlashKind = (attr >>> 5) & 0x07;
  const diagWidth = widthMm(bf?.diagonal?.widthIndex ?? 0);
  const diagColor = colorBgrToHex(bf?.diagonal?.color ?? 0);
  const slashType = slashKind !== 0 ? "SOLID" : "NONE";
  const backSlashType = backSlashKind !== 0 ? "SOLID" : "NONE";

  // <hh:diagonal> 의 type 은 둘 중 하나라도 있으면 SOLID
  const hasDiag = slashKind !== 0 || backSlashKind !== 0;
  const diagonalEl = `<hh:diagonal hh:type="${hasDiag ? "SOLID" : "NONE"}" hh:width="${diagWidth}" hh:color="${diagColor}"/>`;

  const fillEl = bf?.fill
    ? `<hh:fillBrush>` +
      `<hh:winBrush hh:faceColor="${colorBgrToHex(bf.fill.backgroundColor)}" hh:hatchColor="${colorBgrToHex(bf.fill.patternColor)}" hh:hatchStyle="${bf.fill.patternType < 0 ? "NONE" : "HORIZONTAL"}" hh:alpha="0"/>` +
      `</hh:fillBrush>`
    : "";

  return (
    `<hh:borderFill hh:id="${id}" hh:threeD="${(attr & 0x01) !== 0 ? 1 : 0}" hh:shadow="${(attr & 0x02) !== 0 ? 1 : 0}" hh:centerLine="NONE" hh:breakCellSeparateLine="0">` +
    `<hh:slash hh:type="${slashType}" hh:Crooked="0" hh:isCounter="0"/>` +
    `<hh:backSlash hh:type="${backSlashType}" hh:Crooked="0" hh:isCounter="0"/>` +
    left +
    right +
    top +
    bottom +
    diagonalEl +
    fillEl +
    `</hh:borderFill>`
  );
}

function buildTabDefsXml(tabDefs: HwpTabDef[]): string {
  const cnt = Math.max(1, tabDefs.length);
  const items: string[] = [];
  for (let i = 0; i < cnt; i++) {
    const td = tabDefs[i];
    const al = td?.autoTabLeft ?? true ? 1 : 0;
    const ar = td?.autoTabRight ?? true ? 1 : 0;
    items.push(
      `<hh:tabPr hh:id="${i}" hh:autoTabLeft="${al}" hh:autoTabRight="${ar}">` +
        `<hh:items hh:itemCnt="0"/>` +
        `</hh:tabPr>`
    );
  }
  return `<hh:tabPrs hh:itemCnt="${cnt}">${items.join("")}</hh:tabPrs>`;
}

function buildNumberingsXml(numberings: HwpNumbering[]): string {
  if (numberings.length === 0) {
    return (
      `<hh:numberings hh:itemCnt="1">` +
      `<hh:numbering hh:id="0" hh:start="1">` +
      Array.from({ length: 7 })
        .map(
          (_, level) =>
            `<hh:paraHead hh:level="${level + 1}" hh:start="1" hh:numFormat="^${level + 1}." hh:textOffsetType="PERCENT" hh:textOffset="50" hh:numberingChar="false" hh:charPrIDRef="0">` +
            `<hh:autoNumberFormat hh:type="DIGIT" hh:userChar="" hh:prefixChar="" hh:suffixChar="."/>` +
            `</hh:paraHead>`
        )
        .join("") +
      `</hh:numbering>` +
      `</hh:numberings>`
    );
  }
  const items = numberings
    .map(
      (n, idx) =>
        `<hh:numbering hh:id="${idx}" hh:start="${n.startNumber}">` +
        n.levelFormats
          .map(
            (fmt, level) =>
              `<hh:paraHead hh:level="${level + 1}" hh:start="1" hh:numFormat="${escapeXml(fmt || "^" + (level + 1) + ".")}" hh:textOffsetType="PERCENT" hh:textOffset="50" hh:numberingChar="false" hh:charPrIDRef="0">` +
              `<hh:autoNumberFormat hh:type="DIGIT" hh:userChar="" hh:prefixChar="" hh:suffixChar="."/>` +
              `</hh:paraHead>`
          )
          .join("") +
        `</hh:numbering>`
    )
    .join("");
  return `<hh:numberings hh:itemCnt="${numberings.length}">${items}</hh:numberings>`;
}

function buildBulletsXml(bullets: HwpBullet[]): string {
  if (bullets.length === 0) {
    return (
      `<hh:bullets hh:itemCnt="1">` +
      `<hh:bullet hh:id="0" hh:char="●" hh:imageBullet="0" hh:checkedChar="0">` +
      `<hh:img hh:bright="0" hh:contrast="0" hh:effect="REAL_PIC" hh:binaryItemIDRef="0"/>` +
      `</hh:bullet>` +
      `</hh:bullets>`
    );
  }
  const items = bullets
    .map(
      (b, idx) =>
        `<hh:bullet hh:id="${idx}" hh:char="${escapeXml(b.bulletChar)}" hh:imageBullet="0" hh:checkedChar="0">` +
        `<hh:img hh:bright="0" hh:contrast="0" hh:effect="REAL_PIC" hh:binaryItemIDRef="0"/>` +
        `</hh:bullet>`
    )
    .join("");
  return `<hh:bullets hh:itemCnt="${bullets.length}">${items}</hh:bullets>`;
}

function buildFontfacesXml(fontFaces: HwpFaceName[][]): string {
  // 7개 언어 그룹 — 비어있어도 lang 속성은 넣어둔다.
  // 그룹 안 폰트가 0개면 단일 fallback "바탕"
  const groups: string[] = [];
  for (let li = 0; li < 7; li++) {
    const fonts = fontFaces[li] ?? [];
    const lang = LANG_NAMES[li];
    const list = fonts.length > 0
      ? fonts.map((f, idx) => buildFontXml(idx, f)).join("")
      : `<hh:font hh:id="0" hh:type="TTF" hh:name="바탕"/>`;
    const cnt = fonts.length > 0 ? fonts.length : 1;
    groups.push(
      `<hh:fontface hh:lang="${lang}" hh:fontCnt="${cnt}">${list}</hh:fontface>`
    );
  }
  return `<hh:fontfaces hh:itemCnt="${groups.length}">${groups.join("")}</hh:fontfaces>`;
}

function buildFontXml(id: number, f: HwpFaceName): string {
  const subAttrs = f.substituteName ? ` hh:type="UNKNOWN" hh:name="${escapeXml(f.substituteName)}"` : "";
  const sub = f.substituteName ? `<hh:substFont${subAttrs}/>` : "";
  return `<hh:font hh:id="${id}" hh:type="TTF" hh:name="${escapeXml(f.name)}">${sub}</hh:font>`;
}

function buildCharPropertiesXml(charShapes: HwpCharShape[]): string {
  if (charShapes.length === 0) {
    // 최소 1개 fallback
    return (
      `<hh:charProperties hh:itemCnt="1">` +
      `<hh:charPr hh:id="0" hh:height="1000" hh:textColor="#000000" hh:shadeColor="none" hh:useFontSpace="0" hh:useKerning="0" hh:symMark="NONE" hh:borderFillIDRef="0">` +
      defaultFontGroupXml() +
      `</hh:charPr>` +
      `</hh:charProperties>`
    );
  }
  const items = charShapes.map((cs, idx) => buildCharPrXml(idx, cs)).join("");
  return `<hh:charProperties hh:itemCnt="${charShapes.length}">${items}</hh:charProperties>`;
}

function buildCharPrXml(id: number, cs: HwpCharShape): string {
  const ids = cs.faceNameIds;
  const fontRef =
    `<hh:fontRef hh:hangul="${ids.hangul}" hh:latin="${ids.latin}" hh:hanja="${ids.hanja}" hh:japanese="${ids.japanese}" hh:other="${ids.other}" hh:symbol="${ids.symbol}" hh:user="${ids.user}"/>`;
  const ratio = `<hh:ratio hh:hangul="100" hh:latin="100" hh:hanja="100" hh:japanese="100" hh:other="100" hh:symbol="100" hh:user="100"/>`;
  const spacing = `<hh:spacing hh:hangul="0" hh:latin="0" hh:hanja="0" hh:japanese="0" hh:other="0" hh:symbol="0" hh:user="0"/>`;
  const relSz = `<hh:relSz hh:hangul="100" hh:latin="100" hh:hanja="100" hh:japanese="100" hh:other="100" hh:symbol="100" hh:user="100"/>`;
  const offset = `<hh:offset hh:hangul="0" hh:latin="0" hh:hanja="0" hh:japanese="0" hh:other="0" hh:symbol="0" hh:user="0"/>`;
  const italic = cs.italic ? `<hh:italic/>` : "";
  const bold = cs.bold ? `<hh:bold/>` : "";
  const underline = cs.underline
    ? `<hh:underline hh:type="BOTTOM" hh:shape="SOLID" hh:color="${colorBgrToHex(cs.underlineColor)}"/>`
    : "";
  const strikeout = cs.strikeout
    ? `<hh:strikeout hh:shape="SOLID" hh:color="${colorBgrToHex(cs.textColor)}"/>`
    : "";

  const textColor = colorBgrToHex(cs.textColor);
  const shadeColor = cs.shadeColor === 0xffffff || cs.shadeColor === 0 ? "none" : colorBgrToHex(cs.shadeColor);

  return (
    `<hh:charPr hh:id="${id}" hh:height="${cs.baseSize}" hh:textColor="${textColor}" hh:shadeColor="${shadeColor}" hh:useFontSpace="0" hh:useKerning="0" hh:symMark="NONE" hh:borderFillIDRef="0">` +
    fontRef +
    ratio +
    spacing +
    relSz +
    offset +
    italic +
    bold +
    underline +
    strikeout +
    `</hh:charPr>`
  );
}

function defaultFontGroupXml(): string {
  return (
    `<hh:fontRef hh:hangul="0" hh:latin="0" hh:hanja="0" hh:japanese="0" hh:other="0" hh:symbol="0" hh:user="0"/>` +
    `<hh:ratio hh:hangul="100" hh:latin="100" hh:hanja="100" hh:japanese="100" hh:other="100" hh:symbol="100" hh:user="100"/>` +
    `<hh:spacing hh:hangul="0" hh:latin="0" hh:hanja="0" hh:japanese="0" hh:other="0" hh:symbol="0" hh:user="0"/>` +
    `<hh:relSz hh:hangul="100" hh:latin="100" hh:hanja="100" hh:japanese="100" hh:other="100" hh:symbol="100" hh:user="100"/>` +
    `<hh:offset hh:hangul="0" hh:latin="0" hh:hanja="0" hh:japanese="0" hh:other="0" hh:symbol="0" hh:user="0"/>`
  );
}

function buildParaPropertiesXml(paraShapes: HwpParaShape[]): string {
  if (paraShapes.length === 0) {
    return (
      `<hh:paraProperties hh:itemCnt="1">` +
      `<hh:paraPr hh:id="0" hh:tabPrIDRef="0" hh:condense="0" hh:fontLineHeight="0" hh:snapToGrid="0" hh:suppressLineNumbers="0" hh:checked="0">` +
      `<hh:align hh:horizontal="JUSTIFY" hh:vertical="BASELINE"/>` +
      `<hh:heading hh:type="NONE" hh:idRef="0" hh:level="0"/>` +
      `<hh:breakSetting hh:breakLatinWord="KEEP_WORD" hh:breakNonLatinWord="KEEP_WORD" hh:widowOrphan="0" hh:keepWithNext="0" hh:keepLines="0" hh:pageBreakBefore="0" hh:lineWrap="BREAK"/>` +
      `<hh:margin><hh:intent hh:value="0"/><hh:left hh:value="0"/><hh:right hh:value="0"/><hh:prev hh:value="0"/><hh:next hh:value="0"/></hh:margin>` +
      `<hh:lineSpacing hh:type="PERCENT" hh:value="160"/>` +
      `</hh:paraPr>` +
      `</hh:paraProperties>`
    );
  }
  const items = paraShapes.map((ps, idx) => buildParaPrXml(idx, ps)).join("");
  return `<hh:paraProperties hh:itemCnt="${paraShapes.length}">${items}</hh:paraProperties>`;
}

function buildParaPrXml(id: number, ps: HwpParaShape): string {
  const align = alignToOwpml(ps.alignment);
  return (
    `<hh:paraPr hh:id="${id}" hh:tabPrIDRef="0" hh:condense="0" hh:fontLineHeight="0" hh:snapToGrid="0" hh:suppressLineNumbers="0" hh:checked="0">` +
    `<hh:align hh:horizontal="${align}" hh:vertical="BASELINE"/>` +
    `<hh:heading hh:type="NONE" hh:idRef="0" hh:level="0"/>` +
    `<hh:breakSetting hh:breakLatinWord="KEEP_WORD" hh:breakNonLatinWord="KEEP_WORD" hh:widowOrphan="0" hh:keepWithNext="0" hh:keepLines="0" hh:pageBreakBefore="0" hh:lineWrap="BREAK"/>` +
    `<hh:margin>` +
    `<hh:intent hh:value="${ps.indent}"/>` +
    `<hh:left hh:value="${ps.leftMargin}"/>` +
    `<hh:right hh:value="${ps.rightMargin}"/>` +
    `<hh:prev hh:value="${ps.prevSpacing}"/>` +
    `<hh:next hh:value="${ps.nextSpacing}"/>` +
    `</hh:margin>` +
    `<hh:lineSpacing hh:type="PERCENT" hh:value="${Math.max(0, ps.lineSpacing)}"/>` +
    `</hh:paraPr>`
  );
}

function buildStylesXml(styles: HwpStyle[]): string {
  if (styles.length === 0) {
    return (
      `<hh:styles hh:itemCnt="1">` +
      `<hh:style hh:id="0" hh:type="PARA" hh:name="바탕글" hh:engName="Normal" hh:paraPrIDRef="0" hh:charPrIDRef="0" hh:nextStyleIDRef="0" hh:langID="1042" hh:lockForm="0"/>` +
      `</hh:styles>`
    );
  }
  const items = styles
    .map(
      (s, idx) =>
        `<hh:style hh:id="${idx}" hh:type="PARA" hh:name="${escapeXml(s.name || "Style" + idx)}" hh:engName="${escapeXml(s.engName ?? "")}" hh:paraPrIDRef="${s.paraShapeId}" hh:charPrIDRef="${s.charShapeId}" hh:nextStyleIDRef="${idx}" hh:langID="1042" hh:lockForm="0"/>`
    )
    .join("");
  return `<hh:styles hh:itemCnt="${styles.length}">${items}</hh:styles>`;
}

// ============================================================
// 색상 / 정렬 변환
// ============================================================

/** HWP ColorRef (u32 LE 의 0xAABBGGRR 형식) → "#RRGGBB" */
export function colorBgrToHex(color: number): string {
  const r = color & 0xff;
  const g = (color >>> 8) & 0xff;
  const b = (color >>> 16) & 0xff;
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function alignToOwpml(a: HwpParaShape["alignment"]): string {
  switch (a) {
    case "left":
      return "LEFT";
    case "right":
      return "RIGHT";
    case "center":
      return "CENTER";
    case "justify":
      return "JUSTIFY";
    case "distribute":
      return "DISTRIBUTE";
    case "distributeSpace":
      return "DISTRIBUTE_SPACE";
    default:
      return "JUSTIFY";
  }
}

// ============================================================
// section.xml 빌드
// ============================================================

function buildSectionXml(paragraphs: HwpParagraph[], binEntries: BinEntry[]): string {
  // 본 문단 + 머리말/꼬리말/각주 인라인 보강
  const parts: string[] = [];
  for (const p of paragraphs) {
    parts.push(buildParagraphXml(p, binEntries));
    // 같은 paragraph 안의 header/footer/footnote 컨트롤이 가진 paragraphs 도 본문 흐름에 평탄 출력
    for (const ctrl of p.controls) {
      if (
        ctrl.kind === "header" ||
        ctrl.kind === "footer" ||
        ctrl.kind === "footnote"
      ) {
        for (const subPara of ctrl.paragraphs) {
          parts.push(buildParagraphXml(subPara, binEntries));
        }
      }
    }
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<hs:sec xmlns:hs="${NS_HS}" xmlns:hp="${NS_HP}" xmlns:hh="${NS_HH}" xmlns:hc="${NS_HC}">` +
    parts.join("") +
    `</hs:sec>`
  );
}

function buildParagraphXml(p: HwpParagraph, binEntries: BinEntry[]): string {
  const parts: string[] = [];

  // 텍스트 run 들 (charShape 별로 분리됨)
  if (p.runs.length > 0) {
    for (const run of p.runs) {
      parts.push(buildRunXml(run));
    }
  } else if (p.text.length > 0) {
    parts.push(buildRunXml({ charShapeId: 0, text: p.text }));
  }

  // 컨트롤 (표/그림/...)
  for (const ctrl of p.controls) {
    const xml = buildControlXml(ctrl, binEntries);
    if (xml) parts.push(xml);
  }

  if (parts.length === 0) {
    parts.push(`<hp:run hp:charPrIDRef="0"/>`);
  }

  return (
    `<hp:p hp:paraPrIDRef="${p.paraShapeId}" hp:styleIDRef="${p.styleId}" hp:pageBreak="0" hp:columnBreak="0" hp:merged="0">` +
    parts.join("") +
    DEFAULT_LINESEG +
    `</hp:p>`
  );
}

function buildRunXml(run: HwpRun): string {
  return `<hp:run hp:charPrIDRef="${run.charShapeId}"><hp:t>${escapeXml(run.text)}</hp:t></hp:run>`;
}

function buildControlXml(ctrl: HwpControl, binEntries: BinEntry[]): string {
  switch (ctrl.kind) {
    case "table":
      return `<hp:run hp:charPrIDRef="0">${buildTableXml(ctrl, binEntries)}</hp:run>`;
    case "picture": {
      const entry = binEntries.find((b) => b.id === `image${ctrl.binDataId}`);
      if (!entry) return "";
      return (
        `<hp:run hp:charPrIDRef="0">` +
        `<hp:pic hp:href="${entry.href}">` +
        `<hc:img hc:binaryItemIDRef="${entry.id}"/>` +
        `</hp:pic>` +
        `</hp:run>`
      );
    }
    case "shape": {
      // 도형: 1차 포팅에서는 placeholder. line 은 좌표만 보존.
      const tag =
        ctrl.shapeType === "line"
          ? "line"
          : ctrl.shapeType === "rectangle"
            ? "rect"
            : ctrl.shapeType === "ellipse"
              ? "ellipse"
              : ctrl.shapeType === "arc"
                ? "arc"
                : ctrl.shapeType === "polygon"
                  ? "polygon"
                  : "curve";
      const coords =
        ctrl.shapeType === "line" && ctrl.x1 !== undefined
          ? `<hc:startPt x="${ctrl.x1}" y="${ctrl.y1 ?? 0}"/><hc:endPt x="${ctrl.x2 ?? 0}" y="${ctrl.y2 ?? 0}"/>`
          : "";
      return `<hp:run hp:charPrIDRef="0"><hp:${tag}>${coords}</hp:${tag}></hp:run>`;
    }
    case "equation": {
      if (ctrl.script.length === 0) return "";
      return (
        `<hp:run hp:charPrIDRef="0">` +
        `<hp:equation>` +
        `<hp:script>${escapeXml(ctrl.script)}</hp:script>` +
        `</hp:equation>` +
        `</hp:run>`
      );
    }
    case "header":
    case "footer":
    case "footnote":
    case "field":
    case "unknown":
      return "";
  }
}

function buildTableXml(t: HwpTableControl, binEntries: BinEntry[]): string {
  const rows: HwpTableCell[][] = Array.from({ length: t.rowCount }, () => []);
  for (const cell of t.cells) {
    if (cell.row >= 0 && cell.row < t.rowCount) rows[cell.row].push(cell);
  }
  for (const row of rows) row.sort((a, b) => a.col - b.col);

  const trXml = rows
    .map((row) => {
      const tcXml = row
        .map((cell) => {
          const cellInner = cell.paragraphs
            .map((q) => buildParagraphXml(q, binEntries))
            .join("");
          const colSpanAttr = cell.colSpan > 1 ? ` hp:colSpan="${cell.colSpan}"` : "";
          const rowSpanAttr = cell.rowSpan > 1 ? ` hp:rowSpan="${cell.rowSpan}"` : "";
          return (
            `<hp:tc${colSpanAttr}${rowSpanAttr}>` +
            `<hp:subList>${cellInner || `<hp:p hp:paraPrIDRef="0" hp:styleIDRef="0"><hp:run hp:charPrIDRef="0"/>${DEFAULT_LINESEG}</hp:p>`}</hp:subList>` +
            `</hp:tc>`
          );
        })
        .join("");
      return `<hp:tr>${tcXml}</hp:tr>`;
    })
    .join("");

  return `<hp:tbl hp:rowCnt="${t.rowCount}" hp:colCnt="${t.colCount}">${trXml}</hp:tbl>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
