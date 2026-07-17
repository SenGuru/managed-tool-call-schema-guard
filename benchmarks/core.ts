import { performance } from 'node:perf_hooks';
import { validateToolCall } from '../packages/core/src/index.js';
const request = {
  tool_name: 'counter',
  tool_schema: { type: 'object', required: ['count'], properties: { count: { type: 'integer' } } },
  raw_arguments: { count: '42' },
} as const;
for (let i = 0; i < 1_000; i++) validateToolCall(request);
const samples: number[] = [];
for (let i = 0; i < 10_000; i++) {
  const start = performance.now();
  validateToolCall(request);
  samples.push((performance.now() - start) * 1_000);
}
samples.sort((a, b) => a - b);
const percentile = (p: number): number => samples[Math.floor(samples.length * p)] ?? 0;
console.log(
  JSON.stringify(
    {
      iterations: samples.length,
      unit: 'microseconds',
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    },
    null,
    2,
  ),
);
