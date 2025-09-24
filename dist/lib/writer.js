import JSZip from "jszip";
export class HwpxWriter {
    async createFromPlainText(text, options) {
        const zip = new JSZip();
        // Required signature
        zip.file("mimetype", "application/owpml");
        // Minimal version
        const version = `<?xml version="1.0" encoding="UTF-8"?>\n<Version><OWPMLVersion>2.0</OWPMLVersion></Version>`;
        zip.file("version.xml", version);
        // Minimal settings
        const settings = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Settings><CaretPosition>0</CaretPosition></Settings>`;
        zip.file("settings.xml", settings);
        // Contents/content.hpf (OPF-like)
        const contentHpf = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n` +
            `<package>` +
            `<metadata>` +
            `${options?.title ? `<dc:title>${escapeXml(options.title)}</dc:title>` : ""}` +
            `${options?.creator ? `<dc:creator>${escapeXml(options.creator)}</dc:creator>` : ""}` +
            `</metadata>` +
            `<manifest>` +
            `<item id=\"header\" href=\"header.xml\" media-type=\"application/xml\"/>` +
            `<item id=\"section0\" href=\"section0.xml\" media-type=\"application/xml\"/>` +
            `</manifest>` +
            `<spine>` +
            `<itemref idref=\"section0\"/>` +
            `</spine>` +
            `</package>`;
        zip.file("Contents/content.hpf", contentHpf);
        // Contents/header.xml (very minimal)
        const header = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<header></header>`;
        zip.folder("Contents")?.file("header.xml", header);
        // Contents/section0.xml with text as plain paragraphs
        const paragraphs = text.split(/\r?\n/).map(t => `<hp:p><hp:run><hp:t>${escapeXml(t)}</hp:t></hp:run></hp:p>`).join("");
        const section0 = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<hp:section>${paragraphs}</hp:section>`;
        zip.folder("Contents")?.file("section0.xml", section0);
        const out = await zip.generateAsync({ type: "uint8array" });
        return out;
    }
}
function escapeXml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}
export default HwpxWriter;
