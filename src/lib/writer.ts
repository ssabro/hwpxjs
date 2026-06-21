import JSZip from "jszip";
import {
  MIMETYPE,
  OWPML_NS,
  DEFAULT_LINESEG,
  SEC_PR_XML,
  makeParaId,
  escapeXml,
} from "./hwp/owpml.js";

export interface HwpxWriteOptions {
  title?: string;
  creator?: string;
}

const NS_HA = "http://www.hancom.co.kr/hwpml/2011/app";
const NS_OASIS_CONTAINER = "urn:oasis:names:tc:opendocument:xmlns:container";
const NS_OASIS_MANIFEST = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";

/**
 * HWPX(OWPML) 패키지 빌더 (평문 → HWPX).
 *
 * OWPML 패키지 규칙(한컴 호환):
 *   - mimetype 엔트리는 ZIP 내 첫 번째이며 STORE(무압축), 내용은 "application/hwp+zip".
 *   - 요소만 네임스페이스 prefix(hp:/hh:), 속성은 prefix 없음.
 *   - head/sec/package 루트에 풀 네임스페이스 선언, 첫 문단에 <hp:secPr>.
 *   - META-INF/container.xml 가 rootfile 위치를 가리킴.
 *   - 공통 컨벤션 상수는 ./hwp/owpml.ts 와 공유.
 * [shyang 2026-06-21]
 */
export class HwpxWriter {
  async createFromPlainText(text: string, options?: HwpxWriteOptions): Promise<Uint8Array> {
    const zip = new JSZip();

    // mimetype: 반드시 첫 엔트리, STORED.
    zip.file("mimetype", MIMETYPE, { compression: "STORE" });

    // META-INF/container.xml — rootfile 위치
    const containerXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<container xmlns="${NS_OASIS_CONTAINER}">` +
      `<rootfiles>` +
      `<rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>` +
      `</rootfiles>` +
      `</container>`;
    zip.file("META-INF/container.xml", containerXml);

    // META-INF/manifest.xml — 패키지 매니페스트
    const manifestXml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<manifest:manifest xmlns:manifest="${NS_OASIS_MANIFEST}">` +
      `<manifest:file-entry manifest:full-path="/" manifest:media-type="application/hwpml-package+xml"/>` +
      `<manifest:file-entry manifest:full-path="version.xml" manifest:media-type="application/xml"/>` +
      `<manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="application/xml"/>` +
      `<manifest:file-entry manifest:full-path="Contents/content.hpf" manifest:media-type="application/hwpml-package+xml"/>` +
      `<manifest:file-entry manifest:full-path="Contents/header.xml" manifest:media-type="application/xml"/>` +
      `<manifest:file-entry manifest:full-path="Contents/section0.xml" manifest:media-type="application/xml"/>` +
      `</manifest:manifest>`;
    zip.file("META-INF/manifest.xml", manifestXml);

    // version.xml
    const version =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<ha:HCFVersion xmlns:ha="${NS_HA}" ha:targetApplication="WORDPROCESSOR" ha:major="5" ha:minor="0" ha:micro="6" ha:buildNumber="0"/>`;
    zip.file("version.xml", version);

    // settings.xml
    const settings =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<ha:HWPApplicationSetting xmlns:ha="${NS_HA}">` +
      `<ha:CaretPosition ha:listIDRef="0" ha:paraIDRef="0" ha:pos="0"/>` +
      `</ha:HWPApplicationSetting>`;
    zip.file("settings.xml", settings);

    // Contents/content.hpf (OPF-like) — spine 에 header 포함
    const contentHpf =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<opf:package ${OWPML_NS} version="" unique-identifier="" id="">` +
      `<opf:metadata>` +
      `<dc:title>${escapeXml(options?.title ?? "")}</dc:title>` +
      `<dc:creator>${escapeXml(options?.creator ?? "")}</dc:creator>` +
      `<dc:format>application/hwpml-package+xml</dc:format>` +
      `</opf:metadata>` +
      `<opf:manifest>` +
      `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>` +
      `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>` +
      `<opf:item id="settings" href="settings.xml" media-type="application/xml"/>` +
      `</opf:manifest>` +
      `<opf:spine>` +
      `<opf:itemref idref="header" linear="yes"/>` +
      `<opf:itemref idref="section0" linear="yes"/>` +
      `</opf:spine>` +
      `</opf:package>`;
    zip.file("Contents/content.hpf", contentHpf);

    // Contents/header.xml — 최소 fontface/borderFill/charPr/tabProperties/numbering/paraPr/style
    const header =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<hh:head ${OWPML_NS} version="1.5" secCnt="1">` +
      `<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>` +
      `<hh:refList>` +
      `<hh:fontfaces itemCnt="1">` +
      `<hh:fontface lang="HANGUL" fontCnt="1">` +
      `<hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0"/>` +
      `</hh:fontface>` +
      `</hh:fontfaces>` +
      `<hh:borderFills itemCnt="1">` +
      `<hh:borderFill id="0" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
      `<hh:slash type="NONE" Crooked="0" isCounter="0"/>` +
      `<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
      `<hh:leftBorder type="SOLID" width="0.1 mm" color="#000000"/>` +
      `<hh:rightBorder type="SOLID" width="0.1 mm" color="#000000"/>` +
      `<hh:topBorder type="SOLID" width="0.1 mm" color="#000000"/>` +
      `<hh:bottomBorder type="SOLID" width="0.1 mm" color="#000000"/>` +
      `<hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>` +
      `</hh:borderFill>` +
      `</hh:borderFills>` +
      `<hh:charProperties itemCnt="1">` +
      `<hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0">` +
      `<hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
      `<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>` +
      `<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
      `<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>` +
      `<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
      `</hh:charPr>` +
      `</hh:charProperties>` +
      `<hh:tabProperties itemCnt="1">` +
      `<hh:tabPr id="0" autoTabLeft="1" autoTabRight="1"><hh:items itemCnt="0"/></hh:tabPr>` +
      `</hh:tabProperties>` +
      `<hh:numberings itemCnt="1">` +
      `<hh:numbering id="0" start="1">` +
      `<hh:paraHead level="1" start="1" numFormat="^1." textOffsetType="PERCENT" textOffset="50" numberingChar="false" charPrIDRef="0">` +
      `<hh:autoNumberFormat type="DIGIT" userChar="" prefixChar="" suffixChar="."/>` +
      `</hh:paraHead>` +
      `</hh:numbering>` +
      `</hh:numberings>` +
      `<hh:paraProperties itemCnt="1">` +
      `<hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0">` +
      `<hh:align horizontal="JUSTIFY" vertical="BASELINE"/>` +
      `<hh:heading type="NONE" idRef="0" level="0"/>` +
      `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
      `<hh:margin><hh:intent value="0"/><hh:left value="0"/><hh:right value="0"/><hh:prev value="0"/><hh:next value="0"/></hh:margin>` +
      `<hh:lineSpacing type="PERCENT" value="160"/>` +
      `</hh:paraPr>` +
      `</hh:paraProperties>` +
      `<hh:styles itemCnt="1">` +
      `<hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/>` +
      `</hh:styles>` +
      `</hh:refList>` +
      `</hh:head>`;
    zip.file("Contents/header.xml", header);

    // Contents/section0.xml — 첫 문단에 secPr, 이후 평문 줄 단위 문단
    const bodyParas = text
      .split(/\r?\n/)
      .map(
        (line) =>
          `<hp:p id="${makeParaId()}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
          `<hp:run charPrIDRef="0">` +
          `<hp:t>${escapeXml(line)}</hp:t>` +
          `</hp:run>` +
          DEFAULT_LINESEG +
          `</hp:p>`
      )
      .join("");

    const secPrPara =
      `<hp:p id="${makeParaId()}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
      `<hp:run charPrIDRef="0">${SEC_PR_XML}</hp:run>` +
      `<hp:run charPrIDRef="0"><hp:t/></hp:run>` +
      DEFAULT_LINESEG +
      `</hp:p>`;

    const section0 =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<hs:sec ${OWPML_NS}>` +
      secPrPara +
      bodyParas +
      `</hs:sec>`;
    zip.file("Contents/section0.xml", section0);

    return await zip.generateAsync({ type: "uint8array" });
  }
}

export default HwpxWriter;
