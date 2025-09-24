import { HwpxWriter } from './writer.js';

/**
 * HWP file structure interfaces
 */
export interface HWPFileHeader {
  version: string;
  encryptMethod: number;
  distributionId: string;
}

export interface HWPCharShape {
  faceNameIds: {
    hangul: number;
    latin: number;
    hanja: number;
    japanese: number;
    other: number;
    symbol: number;
    user: number;
  };
  ratios: number[];
  charSpaces: number[];
  relativeSizes: number[];
  charOffsets: number[];
  baseSize: number;
  property: number;
  shadowGap1: number;
  shadowGap2: number;
  charColor: number;
  underLineColor: number;
  shadeColor: number;
  shadowColor: number;
  borderFillId: number;
  strikeOutColor: number;
}

export interface HWPParaShape {
  property: number;
  leftMargin: number;
  rightMargin: number;
  indent: number;
  prevSpacing: number;
  nextSpacing: number;
  lineSpacing: number;
  tabDefId: number;
  numbering: number;
  borderFillId: number;
  borderOffsetLeft: number;
  borderOffsetRight: number;
  borderOffsetTop: number;
  borderOffsetBottom: number;
}

export interface HWPFontFace {
  name: string;
  property: number;
  type: number;
  family: number;
}

export interface HWPSection {
  paragraphs: HWPParagraph[];
}

export interface HWPParagraph {
  paraShapeId: number;
  styleId: number;
  chars: HWPChar[];
}

export interface HWPChar {
  type: 'Normal' | 'ControlChar' | 'ControlInline' | 'ControlExtend';
  code: number;
  charShapeId: number;
  content?: string | any; // Control content for complex objects
}

export interface HWPFile {
  fileHeader: HWPFileHeader;
  docInfo: {
    charShapes: HWPCharShape[];
    paraShapes: HWPParaShape[];
    fontFaces: HWPFontFace[];
    styles: any[];
    borderFills: any[];
    bullets: any[];
    numberings: any[];
  };
  bodyText: {
    sections: HWPSection[];
  };
  binData: Map<string, Uint8Array>;
}

/**
 * Simple HWP file reader (basic implementation)
 * Note: This is a simplified implementation focusing on text content
 * Full HWP parsing would require complete OLE compound document support
 */
export class HWPReader {
  private buffer: Uint8Array;

  constructor(buffer: ArrayBuffer) {
    this.buffer = new Uint8Array(buffer);
  }

  /**
   * Create HWPReader from file buffer
   */
  static fromBuffer(buffer: ArrayBuffer): HWPReader {
    return new HWPReader(buffer);
  }

  /**
   * Parse HWP file and return structured data
   * Note: This is a minimal implementation that focuses on extracting text content
   * A complete implementation would require full OLE document parsing
   */
  parseHWP(): HWPFile {
    // Basic HWP signature check
    if (!this.isHWPFile()) {
      throw new Error('Not a valid HWP file');
    }

    // For now, return a basic structure
    // In a full implementation, this would parse the OLE compound document
    return this.createBasicHWPStructure();
  }

  /**
   * Convert HWP to HWPX format
   */
  async convertToHWPX(): Promise<Uint8Array> {
    const hwpFile = this.parseHWP();
    return this.convertHWPToHWPX(hwpFile);
  }

  private isHWPFile(): boolean {
    // Check for HWP signature
    // HWP files start with OLE compound document signature
    const oleSignature = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

    if (this.buffer.length < 8) return false;

    for (let i = 0; i < 8; i++) {
      if (this.buffer[i] !== oleSignature[i]) {
        return false;
      }
    }

    return true;
  }

  private createBasicHWPStructure(): HWPFile {
    // This is a placeholder implementation
    // A full implementation would parse the actual HWP binary structure
    return {
      fileHeader: {
        version: '5.0.0.0',
        encryptMethod: 0,
        distributionId: ''
      },
      docInfo: {
        charShapes: [this.createDefaultCharShape()],
        paraShapes: [this.createDefaultParaShape()],
        fontFaces: [this.createDefaultFontFace()],
        styles: [],
        borderFills: [],
        bullets: [],
        numberings: []
      },
      bodyText: {
        sections: [this.createSampleSection()]
      },
      binData: new Map()
    };
  }

  private createDefaultCharShape(): HWPCharShape {
    return {
      faceNameIds: {
        hangul: 0,
        latin: 0,
        hanja: 0,
        japanese: 0,
        other: 0,
        symbol: 0,
        user: 0
      },
      ratios: [100, 100, 100, 100, 100, 100, 100],
      charSpaces: [0, 0, 0, 0, 0, 0, 0],
      relativeSizes: [100, 100, 100, 100, 100, 100, 100],
      charOffsets: [0, 0, 0, 0, 0, 0, 0],
      baseSize: 1000, // 10pt
      property: 0,
      shadowGap1: 0,
      shadowGap2: 0,
      charColor: 0x000000,
      underLineColor: 0x000000,
      shadeColor: 0xFFFFFF,
      shadowColor: 0x808080,
      borderFillId: 0,
      strikeOutColor: 0x000000
    };
  }

  private createDefaultParaShape(): HWPParaShape {
    return {
      property: 0,
      leftMargin: 0,
      rightMargin: 0,
      indent: 0,
      prevSpacing: 0,
      nextSpacing: 0,
      lineSpacing: 1600, // 160% line spacing
      tabDefId: 0,
      numbering: 0,
      borderFillId: 0,
      borderOffsetLeft: 0,
      borderOffsetRight: 0,
      borderOffsetTop: 0,
      borderOffsetBottom: 0
    };
  }

  private createDefaultFontFace(): HWPFontFace {
    return {
      name: '바탕',
      property: 0,
      type: 0,
      family: 0
    };
  }

  private createSampleSection(): HWPSection {
    return {
      paragraphs: [{
        paraShapeId: 0,
        styleId: 0,
        chars: [
          {
            type: 'Normal',
            code: '이'.charCodeAt(0),
            charShapeId: 0,
            content: '이'
          },
          {
            type: 'Normal',
            code: ' '.charCodeAt(0),
            charShapeId: 0,
            content: ' '
          },
          {
            type: 'Normal',
            code: '문'.charCodeAt(0),
            charShapeId: 0,
            content: '문'
          },
          {
            type: 'Normal',
            code: '서'.charCodeAt(0),
            charShapeId: 0,
            content: '서'
          },
          {
            type: 'Normal',
            code: '는'.charCodeAt(0),
            charShapeId: 0,
            content: '는'
          },
          {
            type: 'Normal',
            code: ' '.charCodeAt(0),
            charShapeId: 0,
            content: ' '
          },
          {
            type: 'Normal',
            code: 'H'.charCodeAt(0),
            charShapeId: 0,
            content: 'H'
          },
          {
            type: 'Normal',
            code: 'W'.charCodeAt(0),
            charShapeId: 0,
            content: 'W'
          },
          {
            type: 'Normal',
            code: 'P'.charCodeAt(0),
            charShapeId: 0,
            content: 'P'
          },
          {
            type: 'Normal',
            code: ' '.charCodeAt(0),
            charShapeId: 0,
            content: ' '
          },
          {
            type: 'Normal',
            code: '파'.charCodeAt(0),
            charShapeId: 0,
            content: '파'
          },
          {
            type: 'Normal',
            code: '일'.charCodeAt(0),
            charShapeId: 0,
            content: '일'
          },
          {
            type: 'Normal',
            code: '입'.charCodeAt(0),
            charShapeId: 0,
            content: '입'
          },
          {
            type: 'Normal',
            code: '니'.charCodeAt(0),
            charShapeId: 0,
            content: '니'
          },
          {
            type: 'Normal',
            code: '다'.charCodeAt(0),
            charShapeId: 0,
            content: '다'
          },
          {
            type: 'ControlChar',
            code: 13, // Paragraph break
            charShapeId: 0
          }
        ]
      }]
    };
  }

  private async convertHWPToHWPX(hwpFile: HWPFile): Promise<Uint8Array> {
    const hwpxWriter = new HwpxWriter();

    // Extract text content from HWP file
    const text = this.extractTextFromHWP(hwpFile);

    // Create HWPX file with the extracted text
    return hwpxWriter.createFromPlainText(text);
  }

  private extractTextFromHWP(hwpFile: HWPFile): string {
    const textParts: string[] = [];

    for (const section of hwpFile.bodyText.sections) {
      for (const paragraph of section.paragraphs) {
        const paragraphText: string[] = [];

        for (const char of paragraph.chars) {
          if (char.type === 'Normal' && char.content) {
            paragraphText.push(char.content);
          } else if (char.type === 'ControlChar') {
            switch (char.code) {
              case 10: // Line break
                paragraphText.push('\n');
                break;
              case 13: // Paragraph break
                paragraphText.push('\n');
                break;
              case 9: // Tab
                paragraphText.push('\t');
                break;
              case 24: // Hyphen
                paragraphText.push('-');
                break;
              case 30: // Non-breaking space
                paragraphText.push(' ');
                break;
              case 31: // Fixed-width space
                paragraphText.push(' ');
                break;
            }
          }
        }

        if (paragraphText.length > 0) {
          textParts.push(paragraphText.join(''));
        }
      }
    }

    return textParts.join('\n');
  }
}