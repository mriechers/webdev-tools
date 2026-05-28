// formatter/tests/tag-attributes.test.mjs
import { test, assert } from './helpers.mjs';
import { removeAllTagAttributes } from '../app.mjs';

test('strips all attrs on generic tags', () => {
  assert.equal(removeAllTagAttributes('<p class="x" id="y">z</p>'), '<p>z</p>');
});

test('keeps href on anchors', () => {
  assert.equal(
    removeAllTagAttributes('<a href="https://x" class="x" target="_blank">y</a>'),
    '<a href="https://x">y</a>'
  );
});

test('first allowed attr wins on anchors — download dropped when after href', () => {
  // Real prettyhtml.com behavior: once the first kept attr's value closes
  // and a space appears, everything else in the tag gets suppressed.
  assert.equal(
    removeAllTagAttributes('<a href="x.pdf" download="file.pdf" rel="noopener">y</a>'),
    '<a href="x.pdf">y</a>'
  );
});

test('first allowed attr wins on anchors — href dropped when after download', () => {
  // Same quirk in the other order
  assert.equal(
    removeAllTagAttributes('<a download="file.pdf" href="x.pdf">y</a>'),
    '<a download="file.pdf">y</a>'
  );
});

test('keeps src on images', () => {
  assert.equal(
    removeAllTagAttributes('<img src="x.jpg" alt="y" class="z" />'),
    '<img src="x.jpg"/>'
  );
});

test('preserves comments', () => {
  assert.equal(
    removeAllTagAttributes('<!-- keep this --><p class="x">y</p>'),
    '<!-- keep this --><p>y</p>'
  );
});
