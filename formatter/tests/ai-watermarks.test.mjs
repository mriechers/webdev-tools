import { test, assert } from './helpers.mjs';
import { removeAiWatermarks } from '../app.mjs';

// Phase 1 — HTML entities
test('replaces &ldquo;/&rdquo; with straight quotes', () => {
  assert.equal(removeAiWatermarks('&ldquo;hi&rdquo;'), '"hi"');
});

test('replaces &lsquo;/&rsquo; with straight apostrophes', () => {
  assert.equal(removeAiWatermarks("don&rsquo;t"), "don't");
});

test('replaces &mdash; with spaced hyphen', () => {
  assert.equal(removeAiWatermarks('a&mdash;b'), 'a - b');
});

test('replaces &ndash; with spaced hyphen', () => {
  assert.equal(removeAiWatermarks('a&ndash;b'), 'a - b');
});

test('replaces &hellip; with three dots', () => {
  assert.equal(removeAiWatermarks('wait&hellip;'), 'wait...');
});

test('replaces &nbsp; entity with space', () => {
  assert.equal(removeAiWatermarks('a&nbsp;b'), 'a b');
});

test('replaces &#160; with space', () => {
  assert.equal(removeAiWatermarks('a&#160;b'), 'a b');
});

// Phase 2 — invisible/zero-width entities
test('strips &zwj;, &zwnj;, &shy; entities', () => {
  assert.equal(removeAiWatermarks('a&zwj;b&zwnj;c&shy;d'), 'abcd');
});

test('strips numeric zero-width entities', () => {
  assert.equal(removeAiWatermarks('a&#8203;b&#8204;c&#8205;d&#8288;e&#65279;f'), 'abcdef');
});

// Phase 2 — invisible/zero-width literal codepoints
test('strips literal U+200B zero-width space', () => {
  assert.equal(removeAiWatermarks('a​b'), 'ab');
});

test('strips literal U+200C zero-width non-joiner', () => {
  assert.equal(removeAiWatermarks('a‌b'), 'ab');
});

test('strips literal U+200D zero-width joiner', () => {
  assert.equal(removeAiWatermarks('a‍b'), 'ab');
});

test('strips literal U+2060 word joiner', () => {
  assert.equal(removeAiWatermarks('a⁠b'), 'ab');
});

test('strips literal U+FEFF BOM', () => {
  assert.equal(removeAiWatermarks('a﻿b'), 'ab');
});

test('strips literal U+00AD soft hyphen', () => {
  assert.equal(removeAiWatermarks('a­b'), 'ab');
});

// Phase 4 — real NBSP (U+00A0) becomes regular space
test('replaces U+00A0 (real NBSP) with regular space', () => {
  assert.equal(removeAiWatermarks('a b'), 'a b');
});

// Phase 3 — mojibake character classes (literal port from prettyhtml.com)
//
// The original aiWatermarkFixer() uses regex character classes where each byte
// in the JS source (UTF-8) becomes one Unicode codepoint in the class.
//
// Opening curly-quote mojibake class contains these Unicode chars:
//   U+00E2 (â), U+20AC (€), U+0153 (œ), U+009D, U+017E (ž),
//   U+00C2 (Â), U+00AB («), U+00BB (»)
// Each matched char is independently replaced with a straight double-quote.
//
// Closing curly-quote mojibake class contains these Unicode chars:
//   U+00E2 (â), U+20AC (€), U+02DC (˜), U+2122 (™),
//   U+0161 (š), U+00B9 (¹), U+00BA (º)
// Each matched char is independently replaced with a straight apostrophe.
// Note: U+00E2 and U+20AC appear in both classes — open class runs first.

// Test individual chars from the open class (that aren't also in close class)
test('replaces mojibake open-quote char U+0153 (œ) with double-quote', () => {
  assert.equal(removeAiWatermarks('œ'), '"');
});

test('replaces mojibake open-quote char U+017E (ž) with double-quote', () => {
  assert.equal(removeAiWatermarks('ž'), '"');
});

test('replaces mojibake open-quote char U+00C2 (Â) with double-quote', () => {
  assert.equal(removeAiWatermarks('Â'), '"');
});

test('replaces mojibake open-quote char U+00AB («) with double-quote', () => {
  assert.equal(removeAiWatermarks('«'), '"');
});

test('replaces mojibake open-quote char U+00BB (») with double-quote', () => {
  assert.equal(removeAiWatermarks('»'), '"');
});

// Test individual chars from the close class (that aren't also in open class)
test('replaces mojibake close-quote char U+02DC (˜) with apostrophe', () => {
  assert.equal(removeAiWatermarks('˜'), "'");
});

test('replaces mojibake close-quote char U+2122 (™) with apostrophe', () => {
  assert.equal(removeAiWatermarks('™'), "'");
});

test('replaces mojibake close-quote char U+0161 (š) with apostrophe', () => {
  assert.equal(removeAiWatermarks('š'), "'");
});

test('replaces mojibake close-quote char U+00B9 (¹) with apostrophe', () => {
  assert.equal(removeAiWatermarks('¹'), "'");
});

test('replaces mojibake close-quote char U+00BA (º) with apostrophe', () => {
  assert.equal(removeAiWatermarks('º'), "'");
});

// Test chars shared between open and close classes (open runs first -> double-quote)
test('shared mojibake char U+00E2 (â) replaced by open class with double-quote', () => {
  assert.equal(removeAiWatermarks('â'), '"');
});

test('shared mojibake char U+20AC (€) replaced by open class with double-quote', () => {
  assert.equal(removeAiWatermarks('€'), '"');
});

// Full mojibake sequence for opening curly quote: U+00E2 U+20AC U+0153
// Each char gets independently replaced: â->" €->" œ->"
// Result: """ (three double quotes, not one)
test('full mojibake opening-quote sequence (â€œ) each char replaced individually', () => {
  assert.equal(removeAiWatermarks('â€œhelloâ€'), '"""hello"""');
});

// Sanity: unrelated characters pass through unchanged
test('ordinary ASCII text is not modified', () => {
  assert.equal(removeAiWatermarks('Hello, world!'), 'Hello, world!');
});

test('real double quotes are not modified', () => {
  assert.equal(removeAiWatermarks('"hello"'), '"hello"');
});
