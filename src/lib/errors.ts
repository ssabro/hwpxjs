export class HwpxNotLoadedError extends Error {
  constructor() {
    super("HWPX가 로드되지 않았습니다. loadFromArrayBuffer를 먼저 호출하세요.");
    this.name = "HwpxNotLoadedError";
  }
}

export class HwpxEncryptedDocumentError extends Error {
  constructor(message = "암호화된 HWPX 문서는 현재 지원하지 않습니다.") {
    super(message);
    this.name = "HwpxEncryptedDocumentError";
  }
}

export class InvalidHwpxFormatError extends Error {
  constructor(message = "유효한 HWPX(mimetype: application/owpml) 문서가 아닙니다.") {
    super(message);
    this.name = "InvalidHwpxFormatError";
  }
}

