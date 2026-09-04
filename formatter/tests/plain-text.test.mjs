import { test, assert } from './helpers.mjs';
import { toPlainText, runTidyPipeline } from '../app.mjs';

// prettyhtml.com's option 8 collapses every tag to "<>" and then substitutes a
// single space, so tag removal leaves a separator behind. Verified live against
// their pipeline on 2026-09-04:
//   "a<br/>b"                              -> "a b"
//   "<div><span>a</span><em>b</em></div>"  -> "  a  b  "
//   "<p>x<!-- y --></p>"                   -> " x<!-- y --> "
// The doubled spaces are collapsed later by the unconditional post-pass, which
// is why the pipeline-level assertions below look tidier than the raw ones.

test('substitutes a space for each stripped tag', () => {
  assert.equal(toPlainText('<p>hello <b>world</b></p>'), ' hello  world  ');
});

test('preserves comments whole', () => {
  assert.equal(toPlainText('<p>x<!-- y --></p>'), ' x<!-- y --> ');
});

test('separates adjacent nested tags', () => {
  assert.equal(toPlainText('<div><span>a</span><em>b</em></div>'), '  a  b  ');
});

test('handles tag attributes', () => {
  assert.equal(toPlainText('<p class="x" id="y">hello</p>'), ' hello ');
});

test('preserves text between tags', () => {
  assert.equal(toPlainText('start <b>middle</b> end'), 'start  middle  end');
});

test('self-closing tag becomes a word separator, not a join', () => {
  assert.equal(toPlainText('a<br/>b'), 'a b');
});

// --- pipeline level: the post-pass collapses the runs ---

const plainOpts = { plainText: true, trimWhitespace: true };

test('pipeline collapses the substituted spaces', () => {
  assert.equal(runTidyPipeline('<div><span>a</span><em>b</em></div>', plainOpts).output, ' a b ');
});

test('pipeline keeps words apart across a <br>', () => {
  assert.equal(runTidyPipeline('a<br/>b', plainOpts).output, 'a b');
});
