import { test, assert } from './helpers.mjs';
import { toPlainText } from '../app.mjs';

test('strips all tags', () => {
  assert.equal(toPlainText('<p>hello <b>world</b></p>'), 'hello world');
});

test('preserves comments', () => {
  assert.equal(toPlainText('<p>x<!-- y --></p>'), 'x<!-- y -->');
});

test('handles nested tags', () => {
  assert.equal(toPlainText('<div><span>a</span><em>b</em></div>'), 'ab');
});

test('handles tag attributes', () => {
  assert.equal(toPlainText('<p class="x" id="y">hello</p>'), 'hello');
});

test('preserves text between tags', () => {
  assert.equal(toPlainText('start <b>middle</b> end'), 'start middle end');
});

test('handles self-closing tags', () => {
  assert.equal(toPlainText('a<br/>b'), 'ab');
});
