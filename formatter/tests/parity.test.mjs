import { test, assert } from './helpers.mjs';
import { readFileSync } from 'node:fs';
import { runTidyPipeline, replaceUntilStable, tidy } from '../app.mjs';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/prettyhtml-golden.json', import.meta.url), 'utf8'),
);

// The tool's shipped defaults: prettyhtml options 1-6 on, 7-10 off, plus our
// Extras. Fixtures without an "ours" field must match prettyhtml.com exactly
// under these; the ones with it are the documented deliberate divergences.
const DEFAULTS = {
  lowercaseTags: true, lowercaseAttrs: true, sortAttrs: false,
  removeEmptyAttrs: false, fixSelfClosing: true, quoteAttrs: true,
  removeStyles: true, removeClassesIds: true, removeEmptyTags: true,
  removeOneSpaceTags: true, trimWhitespace: true, removeComments: true,
  tagAttributes: false, plainText: false, aiWatermarks: false, smartNbsps: false,
  strayBreaks: true, nestedEmpties: true, docsResidue: true, stripScripts: true,
  blockNewlines: true, straightenQuotes: false,
  removeDataAttrs: false, unwrapSpans: true,
};

const withOpts = (over) => ({ ...DEFAULTS, ...over });

// --- Golden pipeline fixtures, captured from prettyhtml.com ---

for (const f of fixtures.pipeline) {
  const expected = 'ours' in f ? f.ours : f.output;
  const label = 'ours' in f ? `${f.id} (deliberate divergence)` : `${f.id} (parity)`;
  test(`pipeline: ${label}`, () => {
    assert.equal(runTidyPipeline(f.input, DEFAULTS).output, expected);
  });
}

// --- replaceUntilStable mirrors their helyettesit() looping ---

test('replaceUntilStable collapses a run of any length', () => {
  assert.equal(replaceUntilStable('a          b', '  ', ' '), 'a b');
});

test('replaceUntilStable is a no-op when the pattern is absent', () => {
  assert.equal(replaceUntilStable('abc', 'xy', 'z'), 'abc');
});

test('replaceUntilStable does one pass when the replacement cannot converge', () => {
  // " " -> "  " re-creates its own pattern; looping would grow without bound.
  assert.equal(replaceUntilStable('a b', ' ', '  '), 'a  b');
});

test('replaceUntilStable ignores an empty pattern', () => {
  assert.equal(replaceUntilStable('abc', '', 'x'), 'abc');
});

// --- Option 5 is nbsp-only (divergence C), verified live 2026-09-04 ---

test('option 5 collapses adjacent &nbsp; entities', () => {
  assert.equal(runTidyPipeline('a&nbsp;&nbsp;b', DEFAULTS).output, 'a b');
});

test('option 5 leaves a lone &nbsp; between words alone', () => {
  assert.equal(runTidyPipeline('a&nbsp;b', DEFAULTS).output, 'a&nbsp;b');
});

test('literal whitespace runs collapse even with option 5 off', () => {
  // Theirs too: the pre/post-passes do this, not the checkbox.
  assert.equal(runTidyPipeline('a     b', withOpts({ trimWhitespace: false })).output, 'a b');
});

// --- Option 3 / option 4 boundary (divergence F) ---

test('a newline-only tag is removed by option 3, not option 4', () => {
  const opts = withOpts({ removeOneSpaceTags: false, blockNewlines: false });
  assert.equal(runTidyPipeline('<p>\n</p>', opts).output, '');
});

test('an &nbsp;-only tag is removed by option 4, not option 3', () => {
  const opts = withOpts({ removeEmptyTags: false, blockNewlines: false });
  assert.equal(runTidyPipeline('<p>&nbsp;</p>', opts).output, '');
});

test('option 3 joins the "> <" gap so a spaced-open tag still clears', () => {
  assert.equal(runTidyPipeline('<div> <p> </p> </div>', DEFAULTS).output, '');
});

// --- Divergence H: numeric nbsp spelling (deliberate improvement) ---

test('option 4 also removes a numeric &#160; tag, which theirs misses', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<p>&#160;</p>', opts).output, '');
});

// --- Divergence G: canRemove is stricter than theirs (deliberate) ---

test('mismatched tag names are not treated as an empty pair', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(tidy('<b></i>', opts).output, '<b></i>');
});

test('empty table cells survive, unlike theirs', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(tidy('<td></td>', opts).output, '<td></td>');
});

// --- Nested empties: layer-1 compensation, not optional polish ---

test('nested empty tags clear completely when the Extra is on', () => {
  assert.equal(runTidyPipeline('<section><div><p></p></div></section>', DEFAULTS).output, '');
});

test('with the Extra off, one pass leaves the outer tag — as theirs does', () => {
  const opts = withOpts({ nestedEmpties: false, blockNewlines: false });
  assert.equal(runTidyPipeline('<div><p></p></div>', opts).output, '<div></div>');
});

// --- tidy() passes whitespace through untouched ---
//
// Whitespace collapsing used to live in tidy()'s TEXT case as \s+ -> " ". It moved
// into runTidyPipeline's unconditional pre/post passes, because on prettyhtml.com
// that work is done by the passes and not by any checkbox (divergence C). These
// pin the behavior change at the unit level: every direct tidy() assertion above
// uses whitespace-free input, so nothing else would catch a regression here.

const passthroughOpts = withOpts({ blockNewlines: false });

test('tidy leaves a run of spaces in text alone', () => {
  assert.equal(tidy('<p>a     b</p>', passthroughOpts).output, '<p>a     b</p>');
});

test('tidy leaves newlines in text alone', () => {
  assert.equal(tidy('<p>a\n\nb</p>', passthroughOpts).output, '<p>a\n\nb</p>');
});

test('tidy does not collapse whitespace even with option 5 on', () => {
  // The option is nbsp-only; it must not reach literal whitespace.
  assert.equal(tidy('<p>a  b</p>', withOpts({ trimWhitespace: true, blockNewlines: false })).output,
    '<p>a  b</p>');
});

test('tidy leaves whitespace between tags alone', () => {
  assert.equal(tidy('<div>  <span>x</span>  </div>',
    withOpts({ blockNewlines: false, unwrapSpans: false })).output,
    '<div>  <span>x</span>  </div>');
});

test('the pipeline, not tidy, is what collapses those runs', () => {
  assert.equal(runTidyPipeline('<p>a     b</p>', passthroughOpts).output, '<p>a b</p>');
  assert.equal(runTidyPipeline('<p>a\n\nb</p>', passthroughOpts).output, '<p>a\nb</p>');
});
