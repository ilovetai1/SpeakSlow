import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const AITextProcessor = require('../src/helpers/aiTextProcessor');
const { DEFAULT_TRANSCRIPT_POLISHING_PROMPT } = require('../src/helpers/aiPrompts');
const ROOT = path.resolve(import.meta.dirname, '..');

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashFile(file) {
  try { return { path: path.relative(ROOT, file), sha256: sha256(fs.readFileSync(file)) }; }
  catch (error) { return { path: path.relative(ROOT, file), unavailable: error.code || 'read_failed' }; }
}

export function materializeInput(item) {
  if (typeof item.raw_asr === 'string') return item.raw_asr;
  const builder = item.input_builder;
  if (!builder || typeof builder.text !== 'string' || !Number.isSafeInteger(builder.repeat)
    || builder.repeat < 1 || builder.repeat > 10000) throw new Error(`invalid_input:${item.id}`);
  return builder.text.repeat(builder.repeat);
}

export function evaluateAssertions(text, assertions = {}) {
  const value = String(text ?? '');
  const missing = (assertions.must_contain_all || []).filter(fragment => !value.includes(fragment));
  const forbidden = (assertions.must_not_contain_any || []).filter(fragment => value.includes(fragment));
  const missingPatterns = (assertions.must_match_all || []).filter(pattern => !(new RegExp(pattern, 'u')).test(value));
  const forbiddenPatterns = (assertions.must_not_match_any || []).filter(pattern => (new RegExp(pattern, 'u')).test(value));
  const occurrenceDeficits = Object.entries(assertions.min_occurrences || {}).flatMap(([fragment, minimum]) => {
    if (!Number.isSafeInteger(minimum) || minimum < 1) throw new Error('invalid_min_occurrences');
    let count = 0; let offset = 0;
    while ((offset = value.indexOf(fragment, offset)) >= 0) { count += 1; offset += Math.max(1, fragment.length); }
    return count < minimum ? [{ fragment, minimum, actual: count }] : [];
  });
  return {
    passed: missing.length === 0 && forbidden.length === 0 && missingPatterns.length === 0
      && forbiddenPatterns.length === 0 && occurrenceDeficits.length === 0,
    missing,
    forbidden,
    missingPatterns,
    forbiddenPatterns,
    occurrenceDeficits,
  };
}

function argsFrom(argv) {
  const result = { providers: ['apple_on_device', 'no_polish'], timeoutMs: 60000 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];
    if (key === '--manifest') result.manifest = next, index += 1;
    else if (key === '--out') result.out = next, index += 1;
    else if (key === '--providers') result.providers = next.split(',').filter(Boolean), index += 1;
    else if (key === '--ollama-model') result.ollamaModel = next, index += 1;
    else if (key === '--ollama-digest') result.ollamaDigest = next, index += 1;
    else if (key === '--timeout-ms') result.timeoutMs = Number(next), index += 1;
    else throw new Error(`unknown_argument:${key}`);
  }
  if (!result.manifest || !result.out) throw new Error('usage: --manifest <json> --out <json> [--providers apple_on_device,no_polish,ollama]');
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs < 1 || result.timeoutMs > 60000) throw new Error('invalid_timeout');
  const allowed = new Set(['apple_on_device', 'no_polish', 'ollama']);
  if (result.providers.some(provider => !allowed.has(provider))) throw new Error('invalid_provider');
  if (result.providers.includes('ollama') && (!result.ollamaModel || !result.ollamaDigest)) {
    throw new Error('ollama_requires_fixed_model_and_digest');
  }
  return result;
}

function gitValue(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function sourceEvidence(manifestPath) {
  const diff = gitValue(['diff', '--binary', '--no-ext-diff', '--', '.']) || '';
  return {
    gitCommit: gitValue(['rev-parse', 'HEAD']),
    dirty: (gitValue(['status', '--porcelain']) || '').length > 0,
    trackedDiffSha256: sha256(diff),
    files: [
      manifestPath,
      path.join(ROOT, 'package.json'),
      path.join(ROOT, 'src/helpers/aiTextProcessor.js'),
      path.join(ROOT, 'src/helpers/ai/appleOnDeviceAdapter.js'),
      path.join(ROOT, 'src/helpers/ai/appleFoundationModelsManager.js'),
      path.join(ROOT, 'native/AppleFoundationModels.swift'),
      path.join(ROOT, 'native/build/apple-foundation-models'),
      path.join(ROOT, 'native/build/apple-speech'),
    ].map(hashFile),
  };
}

function createDatabase(provider, model) {
  const values = new Map(Object.entries({
    ai_provider: provider,
    ai_model: model || (provider === 'apple_on_device' ? 'system' : ''),
    enable_ai_optimization: true,
    transcript_polishing_prompt: DEFAULT_TRANSCRIPT_POLISHING_PROMPT,
    writing_profile: 'neutral',
    writing_profile_apps: {},
    context_aware_polishing_enabled: false,
  }));
  return {
    getSetting: async (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setSetting: async (key, value) => { values.set(key, value); return true; },
  };
}

const silentLogger = Object.freeze({ info() {}, warn() {}, error() {}, debug() {} });
const forbiddenAdapter = Object.freeze({ process: async () => { throw new Error('unexpected_provider_dispatch'); } });
const forbiddenRuntime = Object.freeze({
  shutdown() {},
  releaseResources: async () => {},
  fetchJson: async () => { throw new Error('unexpected_ollama_dispatch'); },
});

async function appleProcessor() {
  return new AITextProcessor(createDatabase('apple_on_device'), silentLogger, {
    ollama: forbiddenAdapter,
    openAICompatible: forbiddenAdapter,
    ollamaRuntime: forbiddenRuntime,
  });
}

async function ollamaProcessor(model, digest) {
  const processor = new AITextProcessor(createDatabase('ollama', model), silentLogger);
  await processor.ollamaRuntime.ensureServer();
  const tags = await processor.ollamaRuntime.fetchJson('/api/tags');
  const installed = tags.models?.find(item => item.name === model || item.model === model);
  if (!installed || installed.digest !== digest) {
    processor.shutdown();
    throw new Error('ollama_digest_mismatch');
  }
  return processor;
}

async function runProvider(provider, item, rawText, processor) {
  const started = process.hrtime.bigint();
  if (item.skip_polish === true) {
    return {
      provider, success: true, skipped: true, code: 'empty_asr', final_text: rawText, latency_ms: 0,
      assertions: evaluateAssertions(rawText, item.assertions),
    };
  }
  if (provider === 'no_polish') {
    return {
      provider, success: true, final_text: rawText,
      latency_ms: Number(process.hrtime.bigint() - started) / 1e6,
      assertions: evaluateAssertions(rawText, item.assertions),
    };
  }
  const result = await processor.processTextWithAI(rawText, 'optimize', null, {
    workflow: 'evaluation', requireEnabled: false,
  });
  const finalText = result.success ? result.text : rawText;
  return {
    provider,
    success: result.success === true,
    code: result.code || null,
    error: result.success ? null : result.error || 'provider_failed',
    final_text: finalText,
    provider_metadata: result.success ? {
      model: result.model || null, variant: result.variant || null, locale: result.locale || null,
      contextSize: result.contextSize || null, usage: result.usage || null,
    } : null,
    latency_ms: Number(process.hrtime.bigint() - started) / 1e6,
    assertions: result.success ? evaluateAssertions(finalText, item.assertions) : {
      passed: false, missing: [], forbidden: [], missingPatterns: [], forbiddenPatterns: [], occurrenceDeficits: [],
    },
  };
}

async function main() {
  const options = argsFrom(process.argv.slice(2));
  const manifestPath = path.resolve(options.manifest);
  const outPath = path.resolve(options.out);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.cases)) throw new Error('manifest_schema_unsupported');

  const processors = new Map();
  let appleNetworkAttempts = 0;
  if (options.providers.includes('apple_on_device')) {
    processors.set('apple_on_device', await appleProcessor());
  }
  if (options.providers.includes('ollama')) processors.set('ollama', await ollamaProcessor(options.ollamaModel, options.ollamaDigest));
  const withAppleNetworkGuard = async (run) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { appleNetworkAttempts += 1; throw new Error('apple_network_forbidden'); };
    try { return await run(); } finally { globalThis.fetch = originalFetch; }
  };

  const report = {
    schema_version: 1,
    suite: manifest.suite,
    generated_at: new Date().toISOString(),
    environment: {
      platform: process.platform, arch: process.arch, osRelease: os.release(), osVersion: os.version(),
      cpu: os.cpus()[0]?.model || null, logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(), node: process.version,
    },
    source: sourceEvidence(manifestPath),
    prompt: { sha256: sha256(DEFAULT_TRANSCRIPT_POLISHING_PROMPT), text: DEFAULT_TRANSCRIPT_POLISHING_PROMPT },
    options: {
      providers: options.providers, timeoutMs: options.timeoutMs,
      ollamaModel: options.ollamaModel || null, ollamaDigest: options.ollamaDigest || null,
    },
    privacy: { nodeAppleNetworkAttempts: appleNetworkAttempts, productLogSinkUsed: false },
    provider_status: {}, cases: [], gates: {}, cross_os_comparison: 'unverified',
  };

  if (processors.has('apple_on_device')) {
    report.provider_status.apple_on_device = await withAppleNetworkGuard(
      () => processors.get('apple_on_device').getApplePolishingStatus({ timeoutMs: options.timeoutMs }),
    );
  }

  try {
    for (const item of manifest.cases) {
      const rawText = materializeInput(item);
      const entry = {
        id: item.id, category: item.category || [], raw_asr: rawText, raw_asr_sha256: sha256(rawText),
        audio_fixture: item.audio_fixture ? hashFile(path.resolve(ROOT, item.audio_fixture)) : null, results: [],
      };
      for (const provider of options.providers) {
        const run = () => runProvider(provider, item, rawText, processors.get(provider));
        entry.results.push(provider === 'apple_on_device' ? await withAppleNetworkGuard(run) : await run());
      }
      report.cases.push(entry);
    }
  } finally {
    for (const processor of processors.values()) processor.shutdown();
  }

  const allResults = report.cases.flatMap(item => item.results.map(result => ({ item, result })));
  const criticalFailures = allResults.filter(({ item, result }) => result.provider !== 'no_polish' && item.category.includes('critical')
    && (result.success !== true || result.assertions.passed !== true));
  report.gates = {
    all_provider_runs_succeeded: allResults.every(({ result }) => result.success === true),
    all_assertions_passed: allResults.every(({ result }) => result.assertions.passed === true),
    critical_semantic_failure_count: criticalFailures.length,
    automatic_enablement_allowed: false,
    automatic_enablement_blocked_reason: criticalFailures.length > 0 ? 'critical_semantic_failure' : 'requires_separate_authorization',
  };
  report.privacy.nodeAppleNetworkAttempts = appleNetworkAttempts;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`${outPath}\n`);
  if (!report.gates.all_provider_runs_succeeded || criticalFailures.length > 0) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
