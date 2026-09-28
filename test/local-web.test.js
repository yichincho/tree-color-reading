const test = require('node:test');
const assert = require('node:assert/strict');

const { segmentSentence, renderSentence } = require('../ThreeColorReading/static/app.js');

const sentence = {
  original: 'The committee formed to investigate the financial scandal involving senior officials submitted its final report yesterday.',
  subject: 'The committee',
  main_verb: 'submitted',
  object: 'its final report',
  complement: '',
  modifiers: [
    { text: 'involving senior officials', target: 'the financial scandal', type: 'participial_modifier', explanation: '' },
    { text: 'formed to investigate the financial scandal involving senior officials', target: 'The committee', type: 'reduced_relative_clause', explanation: '說明是哪個委員會' },
  ],
  translation: '',
  skeleton_zh: '',
};

test('marks the longest modifier and the skeleton in reading order', () => {
  const segments = segmentSentence(sentence).filter((segment) => segment.kind);
  assert.deepEqual(segments.map((segment) => [segment.kind, segment.text]), [
    ['subj', 'The committee'],
    ['mod', 'formed to investigate the financial scandal involving senior officials'],
    ['verb', 'submitted'],
    ['obj', 'its final report'],
  ]);
  assert.equal(segmentSentence(sentence).map((segment) => segment.text).join(''), sentence.original);
});

test('finds the main verb after the subject instead of inside a modifier', () => {
  const segments = segmentSentence({
    original: 'The man who is tall is my teacher.',
    subject: 'The man',
    main_verb: 'is',
    object: '',
    complement: 'my teacher',
    modifiers: [{ text: 'who is tall', target: 'The man' }],
  });
  const verb = segments.find((segment) => segment.kind === 'verb');
  const before = segments.slice(0, segments.indexOf(verb)).map((segment) => segment.text).join('');
  assert.equal(before, 'The man who is tall ');
});

test('does not match a word inside a longer word', () => {
  const segments = segmentSentence({ original: 'This is it.', subject: 'This', main_verb: 'is', object: 'it', modifiers: [] });
  assert.deepEqual(segments.filter((s) => s.kind).map((s) => s.text), ['This', 'is', 'it']);
});

test('escapes model output in every mode', () => {
  const unsafe = { ...sentence, original: '<img src=x onerror=alert(1)> ran.', subject: '<img src=x onerror=alert(1)>', modifiers: [] };
  for (const mode of ['dehydrate', 'skeleton', 'reattach']) {
    assert.equal(renderSentence(unsafe, 0, mode).includes('<img'), false, mode);
  }
});

test('reattach mode lists each modifier with its target', () => {
  const html = renderSentence(sentence, 0, 'reattach');
  assert.match(html, /修飾：<strong>The committee<\/strong>/);
  assert.match(html, /省略關係子句/);
  assert.match(html, /class="modifier"/);
});
