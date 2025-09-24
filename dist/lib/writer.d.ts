export interface HwpxWriteOptions {
    title?: string;
    creator?: string;
}
export declare class HwpxWriter {
    createFromPlainText(text: string, options?: HwpxWriteOptions): Promise<Uint8Array>;
}
export default HwpxWriter;
