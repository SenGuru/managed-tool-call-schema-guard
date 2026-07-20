import safeRegex from 'safe-regex2';

export class JsonResourceLimitError extends Error {}
export class UnsafeSchemaPatternError extends Error {}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function assertJsonSafety(
  value: unknown,
  label: string,
  limits: { maxNodes?: number; maxDepth?: number } = {},
): void {
  const maxNodes = limits.maxNodes ?? 10_000;
  const maxDepth = limits.maxDepth ?? 64;
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    nodes += 1;
    if (nodes > maxNodes || item.depth > maxDepth)
      throw new JsonResourceLimitError(
        `${label} exceeds the ${maxNodes.toLocaleString('en-US')}-node or ${maxDepth}-level safety limit`,
      );
    const current = item.value;
    if (
      current === null ||
      typeof current === 'string' ||
      typeof current === 'number' ||
      typeof current === 'boolean'
    ) {
      if (typeof current === 'number' && !Number.isFinite(current))
        throw new TypeError(`${label} contains a non-JSON number`);
      if (typeof current === 'string' && !isWellFormedUnicode(current))
        throw new TypeError(`${label} contains ill-formed Unicode`);
      continue;
    }
    if (typeof current !== 'object') throw new TypeError(`${label} contains a non-JSON value`);
    if (seen.has(current)) throw new TypeError(`${label} contains a repeated reference or cycle`);
    seen.add(current);

    const ownKeys = Reflect.ownKeys(current);
    if (ownKeys.some((key) => typeof key === 'symbol'))
      throw new TypeError(`${label} contains a symbol-keyed property`);
    const stringKeys = ownKeys as string[];
    const descriptors = Object.getOwnPropertyDescriptors(current);
    let childKeys: string[];
    if (Array.isArray(current)) {
      childKeys = stringKeys.filter((key) => key !== 'length');
      if (
        childKeys.length !== current.length ||
        childKeys.some((key) => {
          if (!/^(?:0|[1-9]\d*)$/u.test(key)) return true;
          const index = Number(key);
          return !Number.isSafeInteger(index) || index < 0 || index >= current.length;
        })
      )
        throw new TypeError(`${label} contains a sparse array or non-index array property`);
    } else {
      const prototype: unknown = Object.getPrototypeOf(current) as unknown;
      if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError(`${label} contains a non-plain object`);
      childKeys = stringKeys;
    }
    for (const key of childKeys) {
      if (!isWellFormedUnicode(key)) throw new TypeError(`${label} contains ill-formed Unicode`);
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
        throw new TypeError(`${label} contains an accessor or non-enumerable property`);
      stack.push({ value: descriptor.value as unknown, depth: item.depth + 1 });
    }
  }
}

function assertSafePattern(pattern: string): void {
  if (pattern.length > 1024 || !safeRegex(pattern, { limit: 25 }))
    throw new UnsafeSchemaPatternError('schema contains a potentially unsafe regular expression');
}

export function assertSafeSchemaPatterns(schema: unknown): void {
  const stack: unknown[] = [schema];
  const seen = new Set<object>();
  while (stack.length) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      stack.push(...(current as unknown[]));
      continue;
    }
    const object = current as Record<string, unknown>;
    if (typeof object.pattern === 'string') assertSafePattern(object.pattern);
    if (
      object.patternProperties !== null &&
      typeof object.patternProperties === 'object' &&
      !Array.isArray(object.patternProperties)
    )
      for (const pattern of Object.keys(object.patternProperties)) assertSafePattern(pattern);
    stack.push(...Object.values(object));
  }
}
