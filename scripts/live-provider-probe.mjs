import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { compileToolContract, validateToolCall } from '../packages/core/dist/index.js';

const providers = ['openai', 'anthropic', 'google_gemini'];
const toolName = 'schema_guard_probe';
const schemaFor = (provider) => ({
  type: 'object',
  ...(provider === 'google_gemini' ? {} : { additionalProperties: false }),
  properties: { count: { type: 'integer' } },
  required: ['count'],
});
const prompt = 'Call schema_guard_probe exactly once with count set to the integer seven.';

function argumentsFrom(argv) {
  const options = { provider: 'all', trials: 3, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--provider') options.provider = argv[++index];
    else if (item === '--trials') options.trials = Number(argv[++index]);
    else if (item === '--output') options.output = argv[++index];
    else if (item === '--dry-run') options.dryRun = true;
    else throw new TypeError(`unknown argument: ${item}`);
  }
  if (options.provider !== 'all' && !providers.includes(options.provider))
    throw new TypeError(`provider must be all or one of ${providers.join(', ')}`);
  if (!Number.isInteger(options.trials) || options.trials < 1 || options.trials > 20)
    throw new TypeError('trials must be an integer from 1 through 20');
  return options;
}

function providerConfiguration(provider, dryRun) {
  const entries = {
    openai: {
      key: process.env.OPENAI_API_KEY,
      model: process.env.SCHEMA_GUARD_OPENAI_MODEL,
    },
    anthropic: {
      key: process.env.ANTHROPIC_API_KEY,
      model: process.env.SCHEMA_GUARD_ANTHROPIC_MODEL,
    },
    google_gemini: {
      key: process.env.GEMINI_API_KEY,
      model: process.env.SCHEMA_GUARD_GEMINI_MODEL,
    },
  }[provider];
  if (!entries) throw new TypeError(`unsupported provider: ${provider}`);
  if (dryRun)
    return {
      key: 'dry-run-key-not-sent',
      model: entries.model ?? `dry-run-${provider}-model`,
    };
  if (!entries.key || !entries.model)
    throw new TypeError(`${provider} probe requires its API key and explicit SCHEMA_GUARD_*_MODEL`);
  return entries;
}

export function requestFor(provider, configuration, declaration) {
  if (provider === 'openai')
    return {
      url: 'https://api.openai.com/v1/responses',
      headers: { authorization: `Bearer ${configuration.key}` },
      body: {
        model: configuration.model,
        input: prompt,
        tools: [{ type: 'function', ...declaration }],
        tool_choice: { type: 'function', name: toolName },
      },
    };
  if (provider === 'anthropic')
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': configuration.key,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: configuration.model,
        max_tokens: 128,
        messages: [{ role: 'user', content: prompt }],
        tools: [declaration],
        tool_choice: { type: 'tool', name: toolName },
      },
    };
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(configuration.model)}:generateContent`,
    headers: { 'x-goog-api-key': configuration.key },
    body: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ functionDeclarations: [declaration] }],
      toolConfig: {
        functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [toolName] },
      },
    },
  };
}

export function emittedCall(provider, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  if (provider === 'openai') {
    const call = Array.isArray(payload.output)
      ? payload.output.find((item) => item?.type === 'function_call' && item?.name === toolName)
      : undefined;
    if (!call || typeof call.arguments !== 'string') return undefined;
    return { name: call.name, arguments: call.arguments };
  }
  if (provider === 'anthropic') {
    const call = Array.isArray(payload.content)
      ? payload.content.find((item) => item?.type === 'tool_use' && item?.name === toolName)
      : undefined;
    if (!call || !call.input || typeof call.input !== 'object' || Array.isArray(call.input))
      return undefined;
    return { name: call.name, arguments: call.input };
  }
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const part = parts.find((item) => item?.functionCall?.name === toolName);
    if (part?.functionCall?.args && typeof part.functionCall.args === 'object')
      return { name: part.functionCall.name, arguments: part.functionCall.args };
  }
  return undefined;
}

async function liveCall(request) {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...request.headers },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(
      `provider returned HTTP ${response.status}${response.headers.get('request-id') ? ' with a request ID' : ''}`,
    );
  return response.json();
}

async function probe(provider, options) {
  const configuration = providerConfiguration(provider, options.dryRun);
  const schema = schemaFor(provider);
  const compiled = compileToolContract({
    target: provider,
    tool_name: toolName,
    tool_schema: schema,
    description: 'A no-side-effect runtime conformance probe.',
    target_version: configuration.model,
  });
  if (
    !compiled.declaration ||
    !['runtime_unverified', 'lossless_transform'].includes(compiled.status)
  )
    throw new Error(`${provider} probe contract did not compile safely (${compiled.status})`);
  const request = requestFor(provider, configuration, compiled.declaration);
  if (options.dryRun)
    return {
      provider,
      model: configuration.model,
      capability_profile: compiled.capability_profile,
      declaration_hash: compiled.compiled_declaration_hash,
      status: 'dry_run',
      trials_requested: options.trials,
      trials_passed: 0,
      decision_counts: { valid: 0, valid_with_repair: 0, rejected: 0 },
    };
  const counts = { valid: 0, valid_with_repair: 0, rejected: 0 };
  const auditHashes = [];
  for (let trial = 0; trial < options.trials; trial += 1) {
    const call = emittedCall(provider, await liveCall(request));
    if (!call) throw new Error(`${provider} did not emit the forced probe function call`);
    const decision = validateToolCall({
      tool_name: toolName,
      tool_schema: schema,
      raw_arguments: call.arguments,
    });
    counts[decision.decision] += 1;
    auditHashes.push(decision.audit.arguments_hash);
    if (decision.decision === 'rejected')
      throw new Error(`${provider} emitted arguments rejected by the canonical contract`);
  }
  return {
    provider,
    model: configuration.model,
    capability_profile: compiled.capability_profile,
    declaration_hash: compiled.compiled_declaration_hash,
    status: 'verified',
    trials_requested: options.trials,
    trials_passed: options.trials,
    decision_counts: counts,
    argument_hashes: auditHashes,
  };
}

export async function runLiveProviderProbes(argv = process.argv.slice(2)) {
  const options = argumentsFrom(argv);
  const selected = options.provider === 'all' ? providers : [options.provider];
  const results = [];
  for (const provider of selected) results.push(await probe(provider, options));
  const report = {
    report_version: '1',
    executed_at: new Date().toISOString(),
    dry_run: options.dryRun,
    passed: options.dryRun || results.every((result) => result.status === 'verified'),
    results,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) await writeFile(options.output, serialized, { mode: 0o600 });
  process.stdout.write(serialized);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runLiveProviderProbes().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ passed: false, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 1;
  });
