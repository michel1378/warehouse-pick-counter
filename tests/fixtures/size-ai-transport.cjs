// Loaded ONLY by the browser test's child process through NODE_OPTIONS.
// It never enables mock behavior in the application's normal runtime.
const nativeFetch = globalThis.fetch;
const origin = process.env.WAREHOUSE_SIZE_TEST_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Missing isolated test origin');
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/responses') return nativeFetch(origin + '/mock-openai', init);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return nativeFetch(input, init);
  throw new Error('External network is disabled in the size browser test');
};
