import { test, assert } from './helpers.mjs';
import { runTidyPipeline } from '../app.mjs';

// Issue #22. Measured live on 2026-09-03: prettyhtml.com returns
//   <p dir="ltr"><span>Hello</span></p>
// for a Google Docs paste. Their TinyMCE layer strips role/aria-level and the
// docs-internal-guid <b> wrapper before any option runs; dir="ltr" survives even
// on their site. We have no such layer, so opt-docs-residue covers both the
// layer-1 compensation and the better-than-parity dir strip.

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

const DOCS_PASTE =
  '<b style="font-weight:normal" id="docs-internal-guid-abc123">' +
  '<p dir="ltr" role="presentation"><span style="font-size:11pt">Hello</span></p>' +
  '<h2 dir="ltr" aria-level="2"><span style="font-weight:700">Head</span></h2></b>';

test('a Google Docs paste comes out clean with the Extra on', () => {
  assert.equal(runTidyPipeline(DOCS_PASTE, DEFAULTS).output, '<p>Hello</p>\n<h2>Head</h2>');
});

test('the Extra off leaves the residue in place', () => {
  const out = runTidyPipeline(DOCS_PASTE, withOpts({ docsResidue: false })).output;
  assert.match(out, /dir="ltr"/);
  assert.match(out, /role="presentation"/);
  assert.match(out, /aria-level="2"/);
});

test('role="presentation" is stripped but other roles are kept', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<p role="presentation">a</p>', opts).output, '<p>a</p>');
  assert.equal(runTidyPipeline('<p role="navigation">a</p>', opts).output, '<p role="navigation">a</p>');
});

test('dir="ltr" is stripped but dir="rtl" is kept', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<p dir="ltr">a</p>', opts).output, '<p>a</p>');
  assert.equal(runTidyPipeline('<p dir="rtl">a</p>', opts).output, '<p dir="rtl">a</p>');
});

test('the docs-internal-guid wrapper is unwrapped, keeping its children', () => {
  const opts = withOpts({ blockNewlines: false, removeClassesIds: false });
  assert.equal(
    runTidyPipeline('<b id="docs-internal-guid-x"><p>a</p></b>', opts).output,
    '<p>a</p>');
});

test('a real <b> is left alone', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<p>a <b>bold</b> c</p>', opts).output, '<p>a <b>bold</b> c</p>');
});

test('a real <b> nested inside the wrapper keeps its own closing tag', () => {
  const opts = withOpts({ blockNewlines: false, removeClassesIds: false });
  assert.equal(
    runTidyPipeline('<b id="docs-internal-guid-x"><p>a <b>real</b> c</p></b>', opts).output,
    '<p>a <b>real</b> c</p>');
});
