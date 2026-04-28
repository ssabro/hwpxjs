/**
 * 바이너리 데이터 읽기 유틸리티 (커서 기반).
 * HWP 5.0 스트림은 모두 little-endian, 문자열은 UTF-16LE.
 *
 * 원작: rhwp/src/parser/byte_reader.rs (MIT, Copyright (c) 2025-2026 Edward Kim)
 */

const UTF16_LE = new TextDecoder("utf-16le");

export class ByteReader {
  private view: DataView;
  private offset: number;
  private readonly end: number;

  constructor(data: Uint8Array, offset = 0, length?: number) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.offset = offset;
    this.end = length === undefined ? data.byteLength : offset + length;
  }

  /** 현재 위치 (바이트 오프셋, 시작점 기준) */
  position(): number {
    return this.offset;
  }

  /** 남은 바이트 */
  remaining(): number {
    return Math.max(0, this.end - this.offset);
  }

  isEmpty(): boolean {
    return this.remaining() === 0;
  }

  setPosition(pos: number): void {
    if (pos < 0 || pos > this.end) {
      throw new RangeError(`setPosition out of range: ${pos} (end=${this.end})`);
    }
    this.offset = pos;
  }

  skip(n: number): void {
    if (this.offset + n > this.end) {
      throw new RangeError(`skip exceeds end: pos=${this.offset}+${n} > ${this.end}`);
    }
    this.offset += n;
  }

  readU8(): number {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  readU16(): number {
    this.ensure(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readU32(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readI8(): number {
    this.ensure(1);
    return this.view.getInt8(this.offset++);
  }

  readI16(): number {
    this.ensure(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readI32(): number {
    this.ensure(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** i64 (BigInt). HWP에서는 거의 등장하지 않지만 호환을 위해. */
  readI64(): bigint {
    this.ensure(8);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }

  /** 지정 길이 바이트를 복사하지 않고 sub-view 반환 (Uint8Array) */
  readBytes(len: number): Uint8Array {
    this.ensure(len);
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
    this.offset += len;
    return new Uint8Array(out); // 복사본 — 호출자가 외부 라이프사이클을 신경 쓸 필요 없게
  }

  /** 남은 전부 */
  readRemaining(): Uint8Array {
    return this.readBytes(this.remaining());
  }

  /**
   * HWP 문자열: [u16 charCount] + [UTF-16LE bytes * charCount].
   */
  readHwpString(): string {
    const charCount = this.readU16();
    if (charCount === 0) return "";
    return this.readUtf16(charCount);
  }

  /** 지정 글자 수의 UTF-16LE 문자열 */
  readUtf16(charCount: number): string {
    const byteLen = charCount * 2;
    this.ensure(byteLen);
    const slice = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, byteLen);
    this.offset += byteLen;
    return UTF16_LE.decode(slice);
  }

  /** ColorRef (0x00BBGGRR) — u32 그대로 */
  readColorRef(): number {
    return this.readU32();
  }

  private ensure(n: number): void {
    if (this.offset + n > this.end) {
      throw new RangeError(
        `ByteReader: not enough bytes. need=${n}, have=${this.end - this.offset}, pos=${this.offset}`
      );
    }
  }
}
