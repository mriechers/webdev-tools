// formatter/tests/stray-breaks.test.mjs
import { test, assert } from './helpers.mjs';
import { normalizeStrayBreaks } from '../app.mjs';

// --- Case 1: loose <br> between / around block elements ---
test('strips <br> between two paragraphs (-> spacer)', () => {
  assert.equal(
    normalizeStrayBreaks('<p>a</p><br><p>b</p>'),
    '<p>a</p><p>&nbsp;</p><p>b</p>'
  );
});

test('strips trailing <br> after a paragraph', () => {
  assert.equal(normalizeStrayBreaks('<p>a</p><br>'), '<p>a</p><p>&nbsp;</p>');
});

test('strips leading <br> before a paragraph', () => {
  assert.equal(normalizeStrayBreaks('<br><p>a</p>'), '<p>&nbsp;</p><p>a</p>');
});

test('collapses a run of consecutive loose <br>s to one spacer', () => {
  assert.equal(
    normalizeStrayBreaks('<p>a</p><br><br><p>b</p>'),
    '<p>a</p><p>&nbsp;</p><p>b</p>'
  );
});

test('preserves indentation whitespace around a loose <br>', () => {
  assert.equal(
    normalizeStrayBreaks('<p>a</p>\n<br>\n<p>b</p>'),
    '<p>a</p>\n<p>&nbsp;</p>\n<p>b</p>'
  );
});

// --- Case 2: <br>-only blocks ---
test('drops <br> inside an otherwise-empty paragraph', () => {
  assert.equal(normalizeStrayBreaks('<p><br></p>'), '<p></p>');
});

test('drops multiple <br>s inside an empty paragraph', () => {
  assert.equal(normalizeStrayBreaks('<p><br /><br /></p>'), '<p></p>');
});

test('drops <br> in a paragraph holding only &nbsp;', () => {
  assert.equal(normalizeStrayBreaks('<p>&nbsp;<br></p>'), '<p>&nbsp;</p>');
});

// --- Case 3: in-text <br> must be preserved ---
test('keeps a line-break between two words', () => {
  assert.equal(
    normalizeStrayBreaks('<p>line one<br>line two</p>'),
    '<p>line one<br>line two</p>'
  );
});

test('keeps a deliberate double line-break inside text', () => {
  assert.equal(
    normalizeStrayBreaks('<p>foo<br><br>bar</p>'),
    '<p>foo<br><br>bar</p>'
  );
});

test('keeps <br> in a div that has direct text', () => {
  assert.equal(normalizeStrayBreaks('<div>a<br>b</div>'), '<div>a<br>b</div>');
});

// --- Variant spellings ---
test('handles <br/> and <br /> the same as <br>', () => {
  assert.equal(normalizeStrayBreaks('<p>a</p><br/><p>b</p>'), '<p>a</p><p>&nbsp;</p><p>b</p>');
  assert.equal(normalizeStrayBreaks('<p>a</p><br /><p>b</p>'), '<p>a</p><p>&nbsp;</p><p>b</p>');
});

// --- End-to-end shape (the real Google-Docs paste) ---
test('the Google-Docs paste collapses its stray breaks to spacers', () => {
  const input = '<p dir="ltr">Learn.</p><br><p dir="ltr">Through.</p><br>';
  assert.equal(
    normalizeStrayBreaks(input),
    '<p dir="ltr">Learn.</p><p>&nbsp;</p><p dir="ltr">Through.</p><p>&nbsp;</p>'
  );
});

// --- Pass-through safety ---
test('leaves text with no <br> untouched', () => {
  assert.equal(normalizeStrayBreaks('<p>hello</p>'), '<p>hello</p>');
});
