import { JsonResourceLimitError } from './limits.js';

const JSON_PRIMITIVE = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u;

function isJsonWhitespace(token: string | undefined): boolean {
  return token === ' ' || token === '\t' || token === '\n' || token === '\r';
}

class UniqueKeyScanner {
  private index = 0;
  private nodes = 0;

  constructor(
    private readonly source: string,
    private readonly maxNodes: number,
    private readonly maxDepth: number,
  ) {}

  scan(): void {
    this.skipWhitespace();
    this.scanValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) this.invalid();
  }

  private scanValue(depth: number): void {
    this.nodes += 1;
    if (this.nodes > this.maxNodes || depth > this.maxDepth)
      throw new JsonResourceLimitError(
        `raw arguments exceed the ${this.maxNodes.toLocaleString('en-US')}-node or ${this.maxDepth}-level safety limit`,
      );
    this.skipWhitespace();
    const token = this.source[this.index];
    if (token === '{') {
      this.scanObject(depth);
      return;
    }
    if (token === '[') {
      this.scanArray(depth);
      return;
    }
    if (token === '"') {
      this.scanString();
      return;
    }
    const primitive = JSON_PRIMITIVE.exec(this.source.slice(this.index));
    if (!primitive) this.invalid();
    this.index += primitive[0].length;
  }

  private scanObject(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume('}')) return;

    const keys = new Set<string>();
    while (true) {
      if (this.source[this.index] !== '"') this.invalid();
      const key = this.scanString();
      if (keys.has(key)) throw new SyntaxError('raw_arguments contains a duplicate object member');
      keys.add(key);
      this.skipWhitespace();
      if (!this.consume(':')) this.invalid();
      this.scanValue(depth + 1);
      this.skipWhitespace();
      if (this.consume('}')) return;
      if (!this.consume(',')) this.invalid();
      this.skipWhitespace();
    }
  }

  private scanArray(depth: number): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.consume(']')) return;

    while (true) {
      this.scanValue(depth + 1);
      this.skipWhitespace();
      if (this.consume(']')) return;
      if (!this.consume(',')) this.invalid();
      this.skipWhitespace();
    }
  }

  private scanString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const token = this.source[this.index];
      if (token === '"') {
        this.index += 1;
        return JSON.parse(this.source.slice(start, this.index)) as string;
      }
      if (token === '\\') this.index += 1;
      this.index += 1;
    }
    this.invalid();
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length && isJsonWhitespace(this.source[this.index]))
      this.index += 1;
  }

  private consume(expected: string): boolean {
    if (this.source[this.index] !== expected) return false;
    this.index += 1;
    return true;
  }

  private invalid(): never {
    throw new SyntaxError(`invalid JSON at character ${this.index}`);
  }
}

export function parseUnambiguousJson(
  source: string,
  limits: { maxCharacters?: number; maxNodes?: number; maxDepth?: number } = {},
): unknown {
  const maxCharacters = limits.maxCharacters ?? 1_000_000;
  const maxNodes = limits.maxNodes ?? 10_000;
  const maxDepth = limits.maxDepth ?? 64;
  if (source.length > maxCharacters)
    throw new JsonResourceLimitError(
      `raw arguments exceed the ${maxCharacters.toLocaleString('en-US')}-character safety limit`,
    );
  new UniqueKeyScanner(source, maxNodes, maxDepth).scan();
  return JSON.parse(source) as unknown;
}
