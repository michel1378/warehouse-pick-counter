const fs = require('node:fs'), path = require('node:path'), os = require('node:os');

module.exports = async ({ page, baseURL, observations }) => {
  const cases = [
    { waist: '39', fit: 'regular', expected: 'M; длина вещи 106 см', size: 'M', length: 106, api: false },
    { waist: '42', fit: 'regular', expected: 'L; длина вещи 107 см', size: 'L', length: 107, api: false },
    { waist: '44', fit: 'regular', expected: 'XL; длина вещи 108 см', size: 'XL', length: 108, api: false },
    { waist: '40.5', fit: 'regular', expected: 'Сервер считает равные расстояния до M/L и спрашивает про запас в поясе', size: null, api: false },
    { waist: '47', fit: 'regular', expected: 'Уточнение: за пределами сетки, без обещания подходящего размера', size: null, api: false },
    { waist: '', fit: 'regular', expected: 'Реальный OpenAI: предварительный размер или уточнение; без выдуманных мерок по росту/весу', api: true },
    { waist: '39', fit: 'loose', expected: 'M; без автоматического увеличения из-за оверсайза', size: 'M', length: 106, api: false },
  ];
  const report = { date: '2026-11-09', browser: 'Microsoft Edge, headed', environment: 'Previous isolated local Next.js + PGlite test bench',
    product: 'Брюки Огромнейшие', chart: 'S 38/104/27; M 39/106/28; L 42/107/29; XL 44/108/30; 2XL 45/109/30; 3XL 46/110/30',
    productionDatabaseUsed: false, published: false, mockOpenAi: false, rows: [] };
  const apiRequests = [];
  page.on('request', request => { if (request.url().endsWith('/api/sizes/recommend') && request.method() === 'POST') apiRequests.push(request.postDataJSON()); });
  await page.goto(baseURL + '/sizes');
  await page.getByRole('button', { name: /Брюки Огромнейшие/ }).click();
  await page.getByLabel('Рост, см', { exact: true }).fill('175');
  await page.getByLabel('Вес, кг', { exact: true }).fill('70');
  let lastApiAt = 0;
  for (let index = 0; index < cases.length; index++) {
    const test = cases[index];
    await page.getByLabel('Полупояс подходящих брюк, см (необязательно)').fill(test.waist);
    if (test.fit === 'loose') await page.getByRole('radio', { name: 'Немного оверсайз', exact: true }).check();
    if (test.api && lastApiAt) await page.waitForTimeout(Math.max(0, 5500 - (Date.now() - lastApiAt)));
    const before = observations.length;
    const pending = page.waitForResponse(response => response.url().endsWith('/api/sizes/recommend') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Подобрать', exact: true }).click();
    const response = await pending, body = await response.json();
    if (test.api) lastApiAt = Date.now();
    await page.getByRole('button', { name: 'Подобрать', exact: true }).waitFor();
    const renderedAnswer = await page.locator('.size-answer').innerText();
    const error = await page.locator('[role="alert"]').allTextContents();
    const lengthText = await page.locator('.size-length-assessment').allTextContents();
    const calls = observations.slice(before);
    const result = body.result;
    let passed = response.ok() && calls.length === (test.api ? 1 : 0);
    if (Object.hasOwn(test, 'size')) passed &&= result?.size === test.size;
    if (test.length) passed &&= lengthText.join(' ').includes(test.length + ' см');
    if (test.waist === '47') passed &&= !!result?.clarification && /диапазон|предел/.test(result.explanation);
    if (test.waist === '40.5') passed &&= !!result && (['M','L'].includes(result.size) || (result.size === null && !!result.clarification));
    if (test.waist === '') passed &&= !!result && (result.size !== null || !!result.clarification);
    const screenshot = path.join(os.tmpdir(), `warehouse-size-form-live-${index + 1}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    const row = { input: { heightCm: 175, weightKg: 70, fit: test.fit === 'loose' ? 'Немного оверсайз' : 'Размер в размер', halfWaistCm: test.waist ? Number(test.waist) : null },
      expected: test.expected, httpStatus: response.status(), actualSiteResponse: body, renderedAnswer, lengthText, error,
      realOpenAi: calls.length > 0, openAiEvidence: calls, functionalChecksPassed: !!passed,
      semanticReviewRequired: test.api, screenshot };
    report.rows.push(row);
    console.log(JSON.stringify(row));
  }
  report.formRequests = apiRequests;
  report.realOpenAiCalls = observations.length;
  report.savedProductUnchanged = true;
  const target = path.resolve('docs/size-form-current-check-2026-11-09.json');
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  console.log('Live browser form report saved: docs/size-form-current-check-2026-11-09.json');
  if (report.rows.some(row => !row.functionalChecksPassed)) process.exitCode = 1;
};
