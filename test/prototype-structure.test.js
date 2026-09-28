const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'three_color_reading_ui_prototype.html'), 'utf8');

test('prototype includes the Provider client and required settings controls', () => {
  assert.match(html, /<script\s+src="api-client\.js"><\/script>/);
  for (const id of [
    'openSettingsButton',
    'settingsModal',
    'apiKeyInput',
    'modelInput',
    'endpointLabel',
    'imageInput',
    'startAnalysisButton',
    'readingBox',
  ]) {
    const occurrences = html.match(new RegExp(`id="${id}"`, 'g')) || [];
    assert.equal(occurrences.length, 1, `${id} should appear exactly once`);
  }
});

test('prototype does not contain a real-looking API key', () => {
  assert.doesNotMatch(html, /sk-[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(html, /AIza[A-Za-z0-9_-]{20,}/);
});
