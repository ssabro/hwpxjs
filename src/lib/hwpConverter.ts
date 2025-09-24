import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HWPReader } from './hwpReader.js';

/**
 * Options for HWP to HWPX conversion
 */
export interface HwpConversionOptions {
  /** Enable verbose logging during conversion */
  verbose?: boolean;
  /** Extract images from HWP file (not implemented yet) */
  extractImages?: boolean;
  /** Preserve formatting information (not implemented yet) */
  preserveFormatting?: boolean;
}

/**
 * Result of HWP to HWPX conversion
 */
export interface HwpConversionResult {
  /** Whether the conversion was successful */
  success: boolean;
  /** Output HWPX file path if successful */
  outputPath?: string;
  /** Error message if failed */
  error?: string;
  /** Standard output from the Java process */
  stdout?: string;
  /** Standard error from the Java process */
  stderr?: string;
}

/**
 * HWP to HWPX converter using pure TypeScript implementation
 */
export class HwpConverter {
  private verbose: boolean;
  private extractImages: boolean;
  private preserveFormatting: boolean;

  constructor(options: HwpConversionOptions = {}) {
    this.verbose = options.verbose || false;
    this.extractImages = options.extractImages || false;
    this.preserveFormatting = options.preserveFormatting || false;
  }

  /**
   * Convert HWP file to HWPX format
   */
  async convertHwpToHwpx(inputPath: string, outputPath: string): Promise<HwpConversionResult> {
    try {
      if (this.verbose) {
        console.log(`Reading HWP file: ${inputPath}`);
      }

      // Read HWP file
      const inputBuffer = await readFile(resolve(inputPath));
      const hwpReader = HWPReader.fromBuffer(inputBuffer.buffer as ArrayBuffer);

      if (this.verbose) {
        console.log('Parsing HWP file structure...');
      }

      // Convert HWP to HWPX
      const hwpxBuffer = await hwpReader.convertToHWPX();

      if (this.verbose) {
        console.log(`Writing HWPX file: ${outputPath}`);
      }

      // Write HWPX file
      const { writeFile } = await import('node:fs/promises');
      await writeFile(resolve(outputPath), hwpxBuffer);

      return {
        success: true,
        outputPath: resolve(outputPath),
        stdout: this.verbose ? 'HWP to HWPX conversion completed successfully' : undefined
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Check if the HWP converter is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // For pure TypeScript implementation, always return true
      // since we don't depend on external tools
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get information about the converter setup
   */
  getInfo(): object {
    return {
      implementation: 'Pure TypeScript',
      verbose: this.verbose,
      extractImages: this.extractImages,
      preserveFormatting: this.preserveFormatting,
      features: [
        'Text extraction',
        'Basic structure preservation',
        this.extractImages ? 'Image extraction (experimental)' : 'Image extraction (disabled)',
        this.preserveFormatting ? 'Formatting preservation (experimental)' : 'Formatting preservation (disabled)'
      ]
    };
  }

  /**
   * Convert HWP file content to text
   */
  async convertHwpToText(inputPath: string): Promise<string> {
    try {
      const inputBuffer = await readFile(resolve(inputPath));
      const hwpReader = HWPReader.fromBuffer(inputBuffer.buffer as ArrayBuffer);
      const hwpFile = hwpReader.parseHWP();

      // Extract text content
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
    } catch (error) {
      throw new Error(`Failed to extract text from HWP file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}