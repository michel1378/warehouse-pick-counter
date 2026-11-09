// Live-form test only. All OpenAI requests go to the real official endpoint, unchanged.
// Only allow local fixture traffic and the intended real Responses API. Never record credentials.
const nativeFetch = globalThis.fetch;
const origin = process.env.WAREHOUSE_SIZE_TEST_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Missing isolated test origin');
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin === 'https://api.openai.com' && url.pathname === '/v1/responses') {
    const response = await nativeFetch(input, init);
    let observation = { origin: url.origin, httpStatus: response.status, requestId: response.headers.get('x-request-id') };
    try {
      const sent = JSON.parse(init.body), body = await response.clone().json();
      observation = { ...observation, requestedModel: sent.model, actualModel: body.model, status: body.status,
        customer: JSON.parse(sent.input).customer,
        text: (body.output ?? []).filter(item => item.type === 'message').flatMap(item => item.content ?? [])
          .filter(item => item.type === 'output_text' || item.type === 'refusal').map(item => item.text ?? item.refusal).join('\n') };
    } catch { /* Preserve status evidence without logging provider internals. */ }
    await nativeFetch(origin + '/real-openai-observation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(observation) });
    return response;
  }
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return nativeFetch(input, init);
  throw new Error('Unexpected external request blocked by live-form test');
};
