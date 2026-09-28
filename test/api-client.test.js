const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getProviderConfig,
  buildProviderRequest,
  parseProviderError,
  extractResponseText,
  maskApiKey,
} = require('../api-client');

const SAMPLE_IMAGE = 'data:image/png;base64,QUJDRA==';

test('uses current multimodal defaults for Gemini and DeepSeek Flash', () => {
  const gemini = getProviderConfig('gemini');
  const deepseek = getProviderConfig('deepseek');

  assert.equal(gemini.model, 'gemini-flash-latest');
  assert.equal(gemini.supportsImages, true);
  assert.equal(deepseek.model, 'deepseek-flash');
  assert.equal(deepseek.supportsImages, true);
  assert.equal(deepseek.baseUrl, 'https://api.deepseek.com');
});

test('builds Gemini generateContent request with inline image and header-only key', () => {
  const request = buildProviderRequest({
    provider: 'gemini',
    apiKey: 'gemini-secret',
    text: 'Analyze this sentence.',
    image: { dataUrl: SAMPLE_IMAGE, mimeType: 'image/png' },
  });

  assert.equal(request.method, 'POST');
  assert.equal(request.url.includes('gemini-secret'), false);
  assert.match(request.url, /models\/gemini-flash-latest:generateContent$/);
  assert.equal(request.url.includes('gemini-3.1'), false);
  assert.equal(request.headers['x-goog-api-key'], 'gemini-secret');

  const body = JSON.parse(request.body);
  assert.equal(body.contents[0].parts[0].text, 'Analyze this sentence.');
  assert.deepEqual(body.contents[0].parts[1], {
    inline_data: { mime_type: 'image/png', data: 'QUJDRA==' },
  });
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.temperature, undefined);
});

test('builds DeepSeek Chat Completions request with mixed text and image content', () => {
  const request = buildProviderRequest({
    provider: 'deepseek',
    apiKey: 'deepseek-secret',
    text: 'Read the image and return the reading analysis JSON.',
    image: { dataUrl: SAMPLE_IMAGE, mimeType: 'image/png' },
  });

  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer deepseek-secret');

  const body = JSON.parse(request.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.messages[0].content, [
    { type: 'text', text: 'Read the image and return the reading analysis JSON.' },
    { type: 'image_url', image_url: { url: SAMPLE_IMAGE, detail: 'auto' } },
  ]);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.thinking, { type: 'disabled' });
});

test('extracts JSON text from both provider response shapes', () => {
  assert.equal(
    extractResponseText('gemini', {
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
    }),
    '{"ok":true}',
  );
  assert.equal(
    extractResponseText('deepseek', {
      choices: [{ message: { content: '{"ok":true}' } }],
    }),
    '{"ok":true}',
  );
});

test('maps common provider failures to readable messages without exposing the key', () => {
  assert.match(parseProviderError(401, { error: { message: 'invalid key' } }, 'secret-key'), /API Key/);
  assert.match(parseProviderError(429, { error: { message: 'quota exceeded' } }, 'secret-key'), /額度|quota/i);
  assert.equal(maskApiKey('abcdefghijklmnop'), 'abcd••••mnop');
  assert.equal(maskApiKey('short'), '••••');
});
