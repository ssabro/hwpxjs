import JSZip from "jszip";

export interface HwpxWriteOptions {
  title?: string;
  creator?: string;
}

const NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph";
const NS_HH = "http://www.hancom.co.kr/hwpml/2011/head";
const NS_HC = "http://www.hancom.co.kr/hwpml/2011/core";
const NS_HA = "http://www.hancom.co.kr/hwpml/2011/app";
const NS_OPF = "http://www.idpf.org/2007/opf/";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_OASIS_CONTAINER = "urn:oasis:names:tc:opendocument:xmlns:container";
const NS_OASIS_MANIFEST = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";

/**
 * HWPX(OWPML) 패키지 빌더.
 *
 * OWPML 1.x 패키지 규칙(ODF/EPUB 계열):
 *   - mimetype 엔트리는 ZIP 내 첫 번째이며 STORE(무압축)로 저장.
 *   - 내용은 정확히 "application/owpml" (BOM/개행 없음).
 *   - META-INF/container.xml 가 rootfile 위치를 가리킴.
 *   - META-INF/manifest.xml 가 패키지 매니페스트(media-type 포함).
 */
export class HwpxWriter {
  async createFromPlainText(text: string, options?: HwpxWriteOptions): Promise<Uint8Array> {
    const zip = new JSZip();

    // mimetype: 반드시 첫 엔트리, STORED.
    zip.file("mimetype", "application/owpml", { compression: "STORE" });

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

    // Contents/content.hpf (OPF-like)
    const contentHpf =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<opf:package xmlns:opf="${NS_OPF}" xmlns:dc="${NS_DC}" version="1.0">` +
      `<opf:metadata>` +
      `<dc:title>${escapeXml(options?.title ?? "")}</dc:title>` +
      `<dc:creator>${escapeXml(options?.creator ?? "")}</dc:creator>` +
      `<dc:format>application/hwpml-package+xml</dc:format>` +
      `</opf:metadata>` +
      `<opf:manifest>` +
      `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>` +
      `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>` +
      `</opf:manifest>` +
      `<opf:spine>` +
      `<opf:itemref idref="section0"/>` +
      `</opf:spine>` +
      `</opf:package>`;
    zip.file("Contents/content.hpf", contentHpf);

    // Contents/header.xml — 최소 charPr 1개, paraPr 1개 정의
    const header =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<hh:head xmlns:hh="${NS_HH}" xmlns:hc="${NS_HC}">` +
      `<hh:beginNum hh:page="1" hh:footnote="1" hh:endnote="1" hh:pic="1" hh:tbl="1" hh:equation="1"/>` +
      `<hh:refList>` +
      `<hh:fontfaces hh:itemCnt="1">` +
      `<hh:fontface hh:lang="HANGUL" hh:fontCnt="1">` +
      `<hh:font hh:id="0" hh:type="TTF" hh:name="바탕"/>` +
      `</hh:fontface>` +
      `</hh:fontfaces>` +
      `<hh:charProperties hh:itemCnt="1">` +
      `<hh:charPr hh:id="0" hh:height="1000" hh:textColor="#000000" hh:shadeColor="none" hh:useFontSpace="0" hh:useKerning="0" hh:symMark="NONE" hh:borderFillIDRef="0">` +
      `<hh:fontRef hh:hangul="0" hh:latin="0" hh:hanja="0" hh:japanese="0" hh:other="0" hh:symbol="0" hh:user="0"/>` +
      `<hh:ratio hh:hangul="100" hh:latin="100" hh:hanja="100" hh:japanese="100" hh:other="100" hh:symbol="100" hh:user="100"/>` +
      `<hh:spacing hh:hangul="0" hh:latin="0" hh:hanja="0" hh:japanese="0" hh:other="0" hh:symbol="0" hh:user="0"/>` +
      `<hh:relSz hh:hangul="100" hh:latin="100" hh:hanja="100" hh:japanese="100" hh:other="100" hh:symbol="100" hh:user="100"/>` +
      `<hh:offset hh:hangul="0" hh:latin="0" hh:hanja="0" hh:japanese="0" hh:other="0" hh:symbol="0" hh:user="0"/>` +
      `</hh:charPr>` +
      `</hh:charProperties>` +
      `<hh:paraProperties hh:itemCnt="1">` +
      `<hh:paraPr hh:id="0" hh:tabPrIDRef="0" hh:condense="0" hh:fontLineHeight="0" hh:snapToGrid="0" hh:suppressLineNumbers="0" hh:checked="0">` +
      `<hh:align hh:horizontal="JUSTIFY" hh:vertical="BASELINE"/>` +
      `<hh:heading hh:type="NONE" hh:idRef="0" hh:level="0"/>` +
      `<hh:breakSetting hh:breakLatinWord="KEEP_WORD" hh:breakNonLatinWord="KEEP_WORD" hh:widowOrphan="0" hh:keepWithNext="0" hh:keepLines="0" hh:pageBreakBefore="0" hh:lineWrap="BREAK"/>` +
      `<hh:margin><hh:intent hh:value="0"/><hh:left hh:value="0"/><hh:right hh:value="0"/><hh:prev hh:value="0"/><hh:next hh:value="0"/></hh:margin>` +
      `<hh:lineSpacing hh:type="PERCENT" hh:value="160"/>` +
      `</hh:paraPr>` +
      `</hh:paraProperties>` +
      `<hh:styles hh:itemCnt="1">` +
      `<hh:style hh:id="0" hh:type="PARA" hh:name="바탕글" hh:engName="Normal" hh:paraPrIDRef="0" hh:charPrIDRef="0" hh:nextStyleIDRef="0" hh:langID="1042" hh:lockForm="0"/>` +
      `</hh:styles>` +
      `</hh:refList>` +
      `</hh:head>`;
    zip.file("Contents/header.xml", header);

    // Contents/section0.xml
    const paragraphs = text
      .split(/\r?\n/)
      .map(
        (line) =>
          `<hp:p hp:paraPrIDRef="0" hp:styleIDRef="0" hp:pageBreak="0" hp:columnBreak="0" hp:merged="0">` +
          `<hp:run hp:charPrIDRef="0">` +
          `<hp:t>${escapeXml(line)}</hp:t>` +
          `</hp:run>` +
          `<hp:linesegarray><hp:lineseg hp:textpos="0" hp:vertpos="0" hp:vertsize="1000" hp:textheight="1000" hp:baseline="850" hp:spacing="600" hp:horzpos="0" hp:horzsize="42520" hp:flags="393216"/></hp:linesegarray>` +
          `</hp:p>`
      )
      .join("");

    const section0 =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="${NS_HP}" xmlns:hh="${NS_HH}" xmlns:hc="${NS_HC}">` +
      paragraphs +
      `</hs:sec>`;
    zip.file("Contents/section0.xml", section0);

    return await zip.generateAsync({ type: "uint8array" });
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default HwpxWriter;
