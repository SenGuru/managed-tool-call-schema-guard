import safeRegex from 'safe-regex2';

export class JsonResourceLimitError extends Error {}
export class UnsafeSchemaPatternError extends Error {}

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
      continue;
    }
    if (typeof current !== 'object') throw new TypeError(`${label} contains a non-JSON value`);
    if (seen.has(current)) throw new TypeError(`${label} contains a repeated reference or cycle`);
    seen.add(current);
    const children = Array.isArray(current)
      ? current
      : Object.values(current as Record<string, unknown>);
    for (const child of children) stack.push({ value: child, depth: item.depth + 1 });
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
