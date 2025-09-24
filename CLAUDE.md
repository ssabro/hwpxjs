# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**hwpxjs** is a TypeScript library for parsing HWPX (Korean Hancom Office document format) files. It provides both Node.js and browser APIs, plus a CLI tool for document conversion and text extraction.

## Essential Commands

```bash
# Build the project
npm run build

# Clean compiled output
npm run clean

# CLI usage examples
npx hwpxjs inspect sample.hwpx        # Document metadata
npx hwpxjs txt sample.hwpx           # Extract text
npx hwpxjs html sample.hwpx          # Convert to HTML
npx hwpxjs batch ./samples ./out     # Batch processing
```

## Architecture Overview

### Core Components

- **HwpxReader** (`src/lib/hwpxReader.ts`): Main parser handling ZIP extraction, XML processing, and text/HTML conversion
- **HwpxWriter** (`src/lib/writer.ts`): Creates HWPX files from plain text
- **CLI Tool** (`src/cli.ts`): Command-line interface with batch processing
- **Types** (`src/lib/types.ts`): Core interfaces including `HwpxMetadata`, `HwpxHtmlOptions`, `HwpxReaderApi`

### HWPX Format Structure
HWPX files are ZIP containers with XML documents. Key files include:
- `Contents/content.hpf`: Document structure
- `Contents/section*.xml`: Content sections containing `<hp:t>` text elements
- `version.xml`, `settings.xml`: Document metadata

### Encoding Handling
The library supports UTF-8, UTF-16LE, and UTF-16BE with BOM detection for proper Korean text rendering.

## Development Notes

- **ES Modules**: Uses full ESM with `.js` imports in TypeScript
- **Package Manager**: Uses pnpm (see `pnpm-lock.yaml`)
- **Target**: ES2022, Node.js >=18
- **Browser Support**: Standalone browser example in `examples/browser/`
- **No Testing Framework**: Test files are in `test/` directory but no automated testing configured
- **No Linting**: No ESLint or Prettier configuration present

## Template Processing
Supports `{{key}}` template substitution in HWPX documents using JSON data files via the CLI or programmatically through the `replaceTemplateVariables` method.