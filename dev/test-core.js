'use strict';

/** Node smoke tests for media/core.js — run with `node dev/test-core.js`. */
const assert = require('assert');
const Core = require('../media/core.js');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ok  ' + name);
  } catch (err) {
    failures++;
    console.log('FAIL  ' + name + '\n      ' + err.message);
  }
}

function compile(pattern, flags) {
  return new RegExp(pattern, flags);
}

function assertNoOverlap(tokens) {
  for (let i = 1; i < tokens.length; i++) {
    assert.ok(tokens[i].s >= tokens[i - 1].e,
      'overlap at ' + JSON.stringify(tokens[i - 1]) + ' / ' + JSON.stringify(tokens[i]));
  }
  for (const t of tokens) {
    assert.ok(t.s >= 0 && t.e > t.s && t.e <= 1e9, 'bad token ' + JSON.stringify(t));
  }
}

console.log('tokenizer');

test('counts plain, non-capturing, lookaround and named groups', () => {
  const src = '(a)(?:b)(?<c>d)(?=e)(?!f)(?<=g)(?<!h)(?i:x)(?m-s:y)';
  const out = Core.tokenizePattern(src, 'g');
  assert.strictEqual(out.groupCount, 2);
  assert.deepStrictEqual(out.groupNames, { 2: 'c' });
  assertNoOverlap(out.tokens);
});

test('ignores parentheses inside classes and escapes', () => {
  assert.strictEqual(Core.tokenizePattern('[()]').groupCount, 0);
  assert.strictEqual(Core.tokenizePattern('\\\\(a)').groupCount, 1);
  assert.strictEqual(Core.tokenizePattern('[(](a)[)]').groupCount, 1);
});

test('handles \\p{...}, \\k<name>, \\x41, \\u{1F600}, \\cJ', () => {
  const src = '\\p{Script=Greek}\\k<name>\\x41\\u{1F600}\\cJ\\u0041\\0';
  const out = Core.tokenizePattern(src, 'u');
  assertNoOverlap(out.tokens);
  assert.strictEqual(out.tokens.map((t) => t.e).pop(), src.length);
});

test('handles nested v-mode classes', () => {
  const src = '[\\p{L}--[a-z]]+';
  const out = Core.tokenizePattern(src, 'v');
  assertNoOverlap(out.tokens);
  assert.strictEqual(out.tokens[out.tokens.length - 1].e, src.length);
});

test('treats [^] and [] like JavaScript does', () => {
  const a = Core.tokenizePattern('[^]x');
  assertNoOverlap(a.tokens);
  const b = Core.tokenizePattern('[]x');
  assertNoOverlap(b.tokens);
  assert.strictEqual(b.tokens[0].e, 2, '[] must be an empty class');
});

test('quantifiers include lazy suffix', () => {
  const out = Core.tokenizePattern('a*?b{2,5}?c{3}');
  assertNoOverlap(out.tokens);
  const quant = out.tokens.filter((t) => t.cls === 'p-quant');
  assert.deepStrictEqual(quant.map((t) => t.e - t.s), [2, 6, 3]);
});

console.log('scanner');

test('finds every global match', () => {
  const re = compile('a', 'g');
  const { matches } = Core.scan(re, 'aaa', 100);
  assert.deepStrictEqual(matches.map((m) => m.index), [0, 1, 2]);
});

test('respects the absence of g', () => {
  const re = compile('a', '');
  const { matches } = Core.scan(re, 'aaa', 100);
  assert.strictEqual(matches.length, 1);
});

test('terminates on zero-length matches', () => {
  const re = compile('x*', 'g');
  const { matches } = Core.scan(re, 'ab', 100);
  assert.deepStrictEqual(matches.map((m) => m.index), [0, 1, 2]);
});

test('records group indices', () => {
  const re = compile('(a)(b)?', 'g');
  const { matches } = Core.scan(re, 'ab a', 100);
  assert.deepStrictEqual(matches[0].indices[1], [0, 1]);
  assert.deepStrictEqual(matches[0].indices[2], [1, 2]);
  assert.strictEqual(matches[1].indices[2], undefined);
});

test('sticky mode only continues while consecutive', () => {
  const re = compile('a', 'y');
  const { matches } = Core.scan(re, 'aab', 100);
  assert.strictEqual(matches.length, 2);
});

test('captures outside the match (lookahead) are kept', () => {
  const re = compile('(?=(b))\\w', 'g');
  const { matches } = Core.scan(re, 'ab', 100);
  assert.strictEqual(matches.length, 1);
  assert.deepStrictEqual(matches[0].indices[1], [1, 2]);
});

console.log('highlight');

test('escapes HTML and nests group spans', () => {
  const re = compile('(<b>)', 'g');
  const { matches } = Core.scan(re, 'x<b>y', 100);
  const html = Core.buildHighlight('x<b>y', matches, -1);
  assert.ok(html.indexOf('&lt;b&gt;') >= 0, html);
  assert.ok(html.indexOf('class="m"') >= 0, html);
  assert.ok(html.indexOf('grp g1') >= 0, html);
});

test('marks the active match', () => {
  const re = compile('a', 'g');
  const { matches } = Core.scan(re, 'aa', 100);
  const html = Core.buildHighlight('aa', matches, 1);
  assert.strictEqual((html.match(/class="m act"/g) || []).length, 1);
});

test('tints only the line that contains a match', () => {
  const text = 'alpha\nbeta\ngamma';
  const re = compile('beta', 'g');
  const { matches } = Core.scan(re, text, 100);
  const html = Core.buildHighlight(text, matches, -1);
  assert.strictEqual(html, 'alpha\n<span class="ln"><span class="m">beta</span></span>\ngamma');
});

test('multiline mode tints each matching line separately', () => {
  const text = 'one\ntwo\nthree';
  const re = compile('^\\w+$', 'gm');
  const { matches } = Core.scan(re, text, 100);
  assert.strictEqual(matches.length, 3);
  const html = Core.buildHighlight(text, matches, -1);
  assert.strictEqual((html.match(/class="ln"/g) || []).length, 3);
  assert.strictEqual(html.replace(/<[^>]*>/g, ''), text);
});

test('merges line tints for matches on the same line', () => {
  const text = 'aaa bbb\nccc';
  const re = compile('a+|b+', 'g');
  const { matches } = Core.scan(re, text, 100);
  const html = Core.buildHighlight(text, matches, -1);
  const nextLine = html.slice(html.indexOf('\nccc'));
  assert.strictEqual(nextLine, '\nccc', html);
  assert.ok(html.indexOf('<span class="ln"><span class="m">aaa') === 0, html);
});

test('renders zero-width matches as markers', () => {
  const re = compile('(?=b)', 'g');
  const { matches } = Core.scan(re, 'ab', 100);
  const html = Core.buildHighlight('ab', matches, 0);
  assert.ok(html.indexOf('class="zero act"') >= 0, html);
  assert.strictEqual(html.replace(/<[^>]*>/g, ''), 'ab', 'plain text is preserved');
});

test('keeps all text for overlapping lookahead groups', () => {
  const re = compile('(?=(\\w+))\\w', 'g');
  const { matches } = Core.scan(re, 'abc', 100);
  const html = Core.buildHighlight('abc', matches, -1);
  const plain = html.replace(/<[^>]*>/g, '');
  assert.strictEqual(plain, 'abc');
});

test('every character survives highlighting', () => {
  const text = 'line1\n\ttabbed <tag> & more\n\u{1F600} emoji\n';
  const re = compile('\\w+', 'gu');
  const { matches } = Core.scan(re, text, 1000);
  const html = Core.buildHighlight(text, matches, 0);
  const plain = html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  assert.strictEqual(plain, text);
});

console.log('fuzz');

test('tokenizer never overlaps or loses characters on random input', () => {
  const alphabet = '()[]{}?*+|\\\\.^$:=<>!Ppkuwc123ab&~-';
  const flagsList = ['', 'g', 'v', 'u', 'gimsuv', 'gd'];
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 400; round++) {
    const len = 1 + Math.floor(rand() * 24);
    let src = '';
    for (let i = 0; i < len; i++) src += alphabet[Math.floor(rand() * alphabet.length)];
    const flags = flagsList[Math.floor(rand() * flagsList.length)];
    const out = Core.tokenizePattern(src, flags);
    assertNoOverlap(out.tokens);
    for (const t of out.tokens) {
      assert.ok(t.e <= src.length && t.s >= 0, 'out of range for ' + JSON.stringify(src));
    }
    const rendered = Core.renderPattern(out.tokens, src);
    const plain = rendered.replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    assert.strictEqual(plain, src, 'lost characters for ' + JSON.stringify(src));
  }
});

if (failures) {
  console.log('\n' + failures + ' test(s) failed');
  process.exitCode = 1;
} else {
  console.log('\nall tests passed');
}
