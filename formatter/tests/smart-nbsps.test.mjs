import { test, assert } from './helpers.mjs';
import { smartNbsps } from '../app.mjs';

// Phase A inserts U+00A0 (literal char) before the last short word in targeted
// elements. Phase B inserts the &nbsp; ENTITY after short words that follow
// a period or the literal string "<p>". Both phases interact on paragraph
// inputs since the serialized "<p>" prefix always triggers Phase B.

const NBSP_CHAR = '\u00A0'; // U+00A0 non-breaking space character

// Phase A — last-word in headings/paragraphs/divs
test('inserts U+00A0 before short last word in <p>', () => {
  const out = smartNbsps('<p>This is a test</p>');
  // Phase A: "test" is 4 chars < 10 -> space before "test" becomes U+00A0 char
  // Phase B: serialized "<p>This..." -> "This" (4 < 7) -> 'This&nbsp;is a[NBSP]test'
  assert.ok(out.includes('a' + NBSP_CHAR + 'test'), 'Phase A: U+00A0 before "test"');
  assert.match(out, /This&nbsp;/);        // Phase B effect: &nbsp; after "This"
});

test('long last word is left alone in Phase A', () => {
  const out = smartNbsps('<p>This is thunderstorms</p>');
  // Phase A: "thunderstorms" is 13 chars >= 10 -> no change (no U+00A0 inserted)
  // Phase B: "<p>This" -> "This" (4 < 7) -> "This&nbsp;is thunderstorms"
  assert.ok(!out.includes(NBSP_CHAR + 'thunderstorms'), 'Phase A no-op for long last word');
  assert.match(out, /This&nbsp;/);            // Phase B still fires on <p> prefix
});

test('walks headings h1-h6', () => {
  // "one" is 3 chars < 10 -> Phase A: space before "one" becomes U+00A0
  // No Phase B match: no "." or "<p>" prefix before a word + whitespace
  assert.equal(smartNbsps('<h2>Section one</h2>'), '<h2>Section' + NBSP_CHAR + 'one</h2>');
  // "news" is 4 chars < 10 -> Phase A inserts U+00A0
  assert.equal(smartNbsps('<h1>Big news</h1>'), '<h1>Big' + NBSP_CHAR + 'news</h1>');
});

test('walks div elements', () => {
  // "text" is 4 chars < 10 -> Phase A inserts U+00A0 before "text"
  assert.equal(smartNbsps('<div>Some text</div>'), '<div>Some' + NBSP_CHAR + 'text</div>');
});

// Phase B — first-word-after-period rule
test('short word after period gets &nbsp; suffix', () => {
  // "Yes" (3 chars < 7), followed by whitespace + word + whitespace.
  // Phase B: "." + " " + "Yes" + " " -> "Yes&nbsp;was"
  const out = smartNbsps('<p>End. Yes was loud here</p>');
  assert.match(out, /Yes&nbsp;/);
});

test('long word after period unaffected by Phase B', () => {
  const out = smartNbsps('<p>End. Thunderstorm came</p>');
  // "Thunderstorm" is 12 chars >= 7 -> Phase B no-op for that word
  assert.doesNotMatch(out, /Thunderstorm&nbsp;/);
});

test('short word after <p> gets &nbsp; suffix', () => {
  // Phase A: "there" (5 < 10) -> U+00A0 before "there"; then Phase B
  // sees "<p>Hi" + U+00A0 (\s+) -> "Hi&nbsp;there" (U+00A0 consumed by \s+)
  const out = smartNbsps('<p>Hi there</p>');
  assert.equal(out, '<p>Hi&nbsp;there</p>');
});

// Edge cases
test('empty paragraphs unaffected', () => {
  assert.equal(smartNbsps('<p></p>'), '<p></p>');
});

test('single-word paragraphs', () => {
  // One word, no separators to convert in Phase A; Phase B: <p> + Hi + (no \s+) -> no match
  assert.equal(smartNbsps('<p>Hello</p>'), '<p>Hello</p>');
});

test('plain text passes through unchanged (no targeted elements)', () => {
  // smartNbsps only walks h1-h6/p/div. Bare text isn't in those elements.
  // Phase B requires "." or "<p>" prefix, which bare text doesn't have.
  const input = 'Just some text';
  const out = smartNbsps(input);
  assert.equal(out, input);
});

// Boundary tests — defend against off-by-one in length thresholds
test('Phase A: 9-char last word triggers U+00A0 insertion', () => {
  // "ninechars" is 9 chars < 10 — Phase A fires, space before it becomes U+00A0.
  // Phase B also fires on <p> prefix: <p>a (1 char) -> a&nbsp;
  // Actual output: "<p>a&nbsp;b\u00A0ninechars</p>"
  const out = smartNbsps('<p>a b ninechars</p>');
  assert.ok(out.includes('b' + NBSP_CHAR + 'ninechars'), 'Phase A: U+00A0 before 9-char last word; got: ' + JSON.stringify(out));
});

test('Phase A: exactly 10-char last word is NOT modified', () => {
  // "nineletter" is 10 chars — >= 10, Phase A condition fails, no U+00A0 inserted.
  // Phase B fires on <p> prefix: <p>a (1 char) -> a&nbsp;
  // Actual output: "<p>a&nbsp;b nineletter</p>" (regular space before nineletter)
  const out = smartNbsps('<p>a b nineletter</p>');
  assert.ok(out.includes('b nineletter'), 'Phase A no-op for 10-char last word; got: ' + JSON.stringify(out));
  // Confirm no U+00A0 immediately before nineletter
  assert.ok(!out.includes(NBSP_CHAR + 'nineletter'), 'no U+00A0 before 10-char word; got: ' + JSON.stringify(out));
});

test('Phase A: exactly 10-char last word does not get U+00A0 (foo bar context)', () => {
  // "abcdefghij" is 10 chars — Phase A no-op; space between "bar" and it stays regular.
  // Phase B fires on <p>foo (3 < 7) -> foo&nbsp;bar
  // Actual output: "<p>foo&nbsp;bar abcdefghij</p>"
  const out = smartNbsps('<p>foo bar abcdefghij</p>');
  assert.ok(out.includes('bar abcdefghij'), 'regular space between bar and 10-char word; got: ' + JSON.stringify(out));
});

test('Phase B: exactly 7-char word after period is NOT modified', () => {
  // "Sevench" is 7 chars — NOT < 7, Phase B no-op for that word.
  // Actual output: "<p>End. Sevench was loud</p>"
  const out = smartNbsps('<p>End. Sevench was loud</p>');
  assert.doesNotMatch(out, /Sevench&nbsp;/);
});

test('Phase B: 6-char word after period gets &nbsp;', () => {
  // "Sixltr" is 6 chars — < 7, Phase B fires.
  // Actual output: "<p>End. Sixltr&nbsp;was loud here</p>"
  const out = smartNbsps('<p>End. Sixltr was loud here</p>');
  assert.match(out, /Sixltr&nbsp;/);
});

// Regression test for the [object heuristic crash bug
test('input starting with [object passes through without crashing', () => {
  // Earlier impl crashed on this input: doc.toString() in linkedom returned a serialized
  // string that was mistakenly matched as "[object ...", triggering doc.body.innerHTML
  // access which crashed. Now uses IS_BROWSER_ENV (static check) instead.
  // No <p>/<h*>/<div> elements, no "." followed by short word with trailing space — unchanged.
  // Actual output: "[object Promise] was rejected"
  const input = '[object Promise] was rejected';
  const out = smartNbsps(input);
  assert.ok(typeof out === 'string', 'should return a string, not throw');
  assert.ok(out.includes('[object Promise]'), 'should preserve [object Promise]; got: ' + JSON.stringify(out));
});
