import { test, assert } from './helpers.mjs';
import { parseAttributes, tokenize, runTidyPipeline, straightenSmartPunctuation } from '../app.mjs';

// Divergence N. Google Docs autocorrects straight quotes to curly ones even when
// the text is HTML source, so markup copied out of a Doc arrives as
// class=“hero lede”. Before this fix parseAttributes read the value as unquoted,
// stopped at the space, and invented a bare attribute named 'lede”' that no
// cleaner matched — so it survived into the output.

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

// --- parseAttributes ---

test('curly double quotes delimit a multi-word value', () => {
  assert.deepEqual(parseAttributes('class=“hero lede”'),
    [{ name: 'class', value: 'hero lede', quote: '"' }]);
});

test('curly single quotes delimit a value', () => {
  assert.deepEqual(parseAttributes('class=‘hero’'),
    [{ name: 'class', value: 'hero', quote: "'" }]);
});

test('two opening curly quotes still delimit, since autocorrect guesses wrong', () => {
  assert.deepEqual(parseAttributes('class=“hero“'),
    [{ name: 'class', value: 'hero', quote: '"' }]);
});

test('straight quotes are unaffected', () => {
  assert.deepEqual(parseAttributes('class="hero lede"'),
    [{ name: 'class', value: 'hero lede', quote: '"' }]);
});

test('mixed straight and curly attributes in one tag', () => {
  assert.deepEqual(parseAttributes('id="a" class=“b c” data-x=‘d’'), [
    { name: 'id', value: 'a', quote: '"' },
    { name: 'class', value: 'b c', quote: '"' },
    { name: 'data-x', value: 'd', quote: "'" },
  ]);
});

test('no phantom attribute is invented from the tail of a curly value', () => {
  const attrs = parseAttributes('class=“hero lede”');
  assert.equal(attrs.length, 1);
  assert.equal(attrs.some(a => a.name.includes('”')), false);
});

// --- findTagEnd, via tokenize ---

test('a ">" inside a curly-quoted value does not truncate the tag', () => {
  const tokens = tokenize('<p class=“a > b”>Hi</p>');
  assert.equal(tokens[0].tagName, 'p');
  assert.deepEqual(tokens[0].attributes, [{ name: 'class', value: 'a > b', quote: '"' }]);
  assert.equal(tokens[1].content, 'Hi');
});

test('an unterminated curly quote does not swallow the document', () => {
  const tokens = tokenize('<p class=“broken>Hi</p>');
  assert.equal(tokens.map(t => t.raw).join(''), '<p class=“broken>Hi</p>');
});

// --- end to end: the reported symptom ---

test('a curly-quoted class is removed, not passed through mangled', () => {
  assert.equal(runTidyPipeline('<p class=“hero lede”>Hi</p>', DEFAULTS).output, '<p>Hi</p>');
});

test('a curly-quoted value that is kept is rebuilt with straight quotes', () => {
  const opts = withOpts({ removeClassesIds: false, blockNewlines: false });
  assert.equal(runTidyPipeline('<p class=“hero lede”>Hi</p>', opts).output,
    '<p class="hero lede">Hi</p>');
});

test('curly quotes in prose are left alone by the attribute fix', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<p>It’s a “big” day</p>', opts).output,
    '<p>It’s a “big” day</p>');
});

// --- opt-straighten-quotes, default OFF ---

test('straightenSmartPunctuation maps curly punctuation to ASCII', () => {
  assert.equal(straightenSmartPunctuation('It’s a “big” day…'), 'It\'s a "big" day...');
});

test('straightenSmartPunctuation mirrors option 9 on dashes', () => {
  // Option 9 maps &ndash;/&mdash; to ' - ', spaces included, so a dash that was
  // already spaced ends up doubled. The pipeline post-pass collapses the runs.
  assert.equal(straightenSmartPunctuation('a – b — c'), 'a  -  b  -  c');
});

test('the pipeline collapses the spacing that dash straightening leaves', () => {
  const opts = withOpts({ straightenQuotes: true, blockNewlines: false });
  assert.equal(runTidyPipeline('<p>a – b</p>', opts).output, '<p>a - b</p>');
});

test('the Extra is off by default, so prose typography survives', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<p>“hi”</p>', opts).output, '<p>“hi”</p>');
});

test('the Extra straightens prose when turned on', () => {
  const opts = withOpts({ straightenQuotes: true, blockNewlines: false });
  assert.equal(runTidyPipeline('<p>“hi”</p>', opts).output, '<p>"hi"</p>');
});
