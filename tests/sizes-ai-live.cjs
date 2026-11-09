// Explicit opt-in REAL OpenAI calls, separate from mocks and regression tests.
// Loads the existing .env.local without printing secrets. Never connects to or changes a database.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const ts = require('typescript');
require('@next/env').loadEnvConfig(process.cwd());
let observedResponse = null;
function redact(text) {
  let result = String(text);
  for (const [name, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET/.test(name) && value?.length > 8) result = result.split(value).join('[REDACTED]');
  }
  return result.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
}
const cache = new Map();
function load(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; cache.set(filename, mod);
  const original = mod.require.bind(mod);
  mod.require = name => name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts')
    : name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')) : original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return mod.exports;
}
(async () => {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.log('BLOCKED: OPENAI_API_KEY is missing. No real API calls were made.'); process.exitCode = 2; return;
  }
  if (process.env.WAREHOUSE_SIZE_TEST_ORIGIN || /size-ai-transport/.test(process.env.NODE_OPTIONS || '')) {
    console.log('BLOCKED: mock transport detected; refusing to label this a live check.'); process.exitCode = 2; return;
  }
  // Observe a clone of real HTTP responses; URL, request and response are never replaced.
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.pathname === '/v1/responses') {
      try {
        const data = await response.clone().json();
        observedResponse = { httpStatus: response.status, status: data.status, incompleteReason: data.incomplete_details?.reason,
          text: data.output?.filter(item => item.type === 'message').flatMap(item => item.content ?? [])
            .filter(item => item.type === 'output_text' || item.type === 'refusal').map(item => item.text ?? item.refusal).join('\n') };
      } catch { observedResponse = { httpStatus: response.status }; }
    }
    return response;
  };
  const { recommendSizeWithAi, SIZE_AI_MODEL, sizeMeasurementDecision } = load('src/lib/sizes-ai.ts');
  const { hugeTrousersProfile, sizeLengthAssessment } = load('src/lib/size-profile.ts');
  const model = process.env.OPENAI_MODEL_SIZES?.trim() || SIZE_AI_MODEL;
  const OpenAI = require('openai').default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 0 });
  try { await client.models.retrieve(model); }
  catch (error) {
    console.log(JSON.stringify({ live: true, model, stage: 'model_access', status: Number(error.status) || null,
      code: /^[a-z0-9_]+$/i.test(error.code || '') ? error.code : 'request_failed' })); process.exitCode = 1; return;
  }
  console.log(JSON.stringify({ live: true, model, modelAccess: 'confirmed', chartSource: 'specified local chart; no database connection', product: 'Брюки Огромнейшие' }));
  const product = { name: 'Брюки Огромнейшие', note: 'Маломерит на размер' };
  const profile = hugeTrousersProfile();
  for (const halfWaistCm of [undefined, 39]) {
    const input = { productId: 'e5f81908-0a6a-4514-af98-54770af6d601', revision: 1, height: 175, weight: 70, fit: 'regular', ...(halfWaistCm !== undefined ? { halfWaistCm } : {}) };
    const shownInput = { heightCm: input.height, weightKg: input.weight, fit: 'Размер в размер', halfWaistCm: halfWaistCm ?? null };
    observedResponse = null;
    try {
      const result = await recommendSizeWithAi(product, profile, input);
      const localDecision = sizeMeasurementDecision(profile, input);
      console.log(JSON.stringify({ live: !localDecision, apiCalled: !localDecision, source: localDecision ? 'selected_chart' : 'real_openai', model: localDecision ? null : model,
        input: shownInput, ...(localDecision ? { chartResult: result } : { actualResponse: result }), lengthAssessment: sizeLengthAssessment(profile, result.size) }));
    } catch (error) {
      console.log(redact(JSON.stringify({ live: true, model, input: shownInput, status: Number(error.status) || null,
        errorType: error.name, detail: String(error.message || '').slice(0, 500), actualHttpResponse: observedResponse,
        code: /^[a-z0-9_]+$/i.test(error.code || '') ? error.code : 'request_or_response_validation_failed' }))); process.exitCode = 1;
    }
  }
})().catch(() => { console.error('Live verification failed; provider details hidden.'); process.exitCode = 1; });
