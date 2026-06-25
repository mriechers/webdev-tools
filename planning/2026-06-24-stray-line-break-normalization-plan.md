# Stray Line-Break Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip structurally-meaningless `<br>` residue (between/around block elements and inside otherwise-empty blocks) from pasted HTML, while preserving genuine in-text line breaks.

**Architecture:** A new pure function `normalizeStrayBreaks(html)` in `formatter/app.mjs` tokenizes with the existing `tokenize()`, classifies each `<br>` by block context in two passes, and rewrites stray `<br>`s — body-level runs become a single `<p>&nbsp;</p>`, `<br>`s inside text-less blocks are dropped. It runs as a **pre-pass before `tidy()`**, so its `<p>&nbsp;</p>`/`<p></p>` output is consumed by the existing default-ON "Tags with one space" and "Empty tags" cleaners. A new Extras checkbox (`opt-stray-breaks`, default ON) gates it.

**Tech Stack:** Vanilla ES module (`formatter/app.mjs`), Node.js built-in test runner, `linkedom` DOMParser shim (unused by this feature but loaded by the shared test helper).

## Global Constraints

- No frameworks, no npm runtime deps — pure client-side vanilla JS.
- New pure functions exported from `app.mjs` follow the existing pattern (`removeAllTagAttributes`, `smartNbsps`).
- Tests live in `formatter/tests/*.test.mjs`, import from `./helpers.mjs`, run via `npm test`.
- localStorage options bundle key: `htmlTidy_options`; every tidy checkbox id must appear in `TIDY_CHECKBOX_IDS` for persistence.
- Dropdown group for beyond-prettyhtml.com options: **Extras**.
- `<br>`, `<br/>`, and `<br />` all tokenize to a single `SELF_CLOSING_TAG` token with `tagName: 'br'` (verified at `app.mjs:166-167`), so all three variants are handled uniformly; the original spelling is preserved via the token's `.raw`.

---

### Task 1: `normalizeStrayBreaks` pure function + unit tests

**Files:**
- Modify: `formatter/app.mjs` — add `BLOCK_ELEMENTS` const (near the other element sets, after `INLINE_ELEMENTS` at line 56) and export `normalizeStrayBreaks` (alongside the other exported cleaners, after `smartNbsps` at line 859).
- Test: `formatter/tests/stray-breaks.test.mjs` (create)

**Interfaces:**
- Consumes: the module-internal `tokenize(html)` (returns token array; each token has `.type`, `.raw`, and for tags `.tagName`; for text `.content`) and `TokenType` enum — both already defined in `app.mjs`.
- Produces: `export function normalizeStrayBreaks(html: string): string`. Behavior contract:
  - Body-level `<br>` run (consecutive `<br>`s at depth 0, separated only by whitespace-only text) → replaced by a single `<p>&nbsp;</p>`.
  - `<br>` whose immediate enclosing block element has **no** direct non-whitespace, non-`&nbsp;` text → dropped.
  - `<br>` inside a block **with** direct text → kept verbatim (via `.raw`).
  - All other tokens emitted verbatim via `.raw`.

- [ ] **Step 1: Write the failing test**

Create `formatter/tests/stray-breaks.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `normalizeStrayBreaks` is not exported (`The requested module '../app.mjs' does not provide an export named 'normalizeStrayBreaks'`).

- [ ] **Step 3: Add the `BLOCK_ELEMENTS` constant**

In `formatter/app.mjs`, immediately after the `INLINE_ELEMENTS` set (which closes at line 56), add:

```javascript
/**
 * Block-level elements — used by normalizeStrayBreaks to tell a structural
 * <br> (between/around blocks, or inside an empty block) from a content <br>
 * (a real line break inside a block that has text).
 */
const BLOCK_ELEMENTS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'blockquote', 'section', 'article', 'header', 'footer', 'main', 'aside',
  'nav', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr',
  'td', 'th', 'dl', 'dt', 'dd', 'form', 'fieldset', 'address', 'pre',
]);
```

- [ ] **Step 4: Add the `normalizeStrayBreaks` function**

In `formatter/app.mjs`, immediately after the `smartNbsps` function (closes at line 859, before the `// OPTIONS` banner), add:

```javascript
/**
 * Normalize stray <br> residue (e.g. from Google Docs paste).
 *
 * - A <br> sitting at the body level between/around block elements is treated
 *   as a structural spacer: a maximal run collapses to one <p>&nbsp;</p>.
 * - A <br> inside a block that has no direct text (e.g. <p><br></p>) is dropped.
 * - A <br> inside a block that has real text is kept (genuine line break).
 *
 * The <p>&nbsp;</p>/<p></p> output is consumed by the default-ON "Tags with one
 * space" and "Empty tags" cleaners in tidy(), so stray breaks vanish entirely.
 * Pure string transform — no DOM round-trip.
 */
export function normalizeStrayBreaks(html) {
  const tokens = tokenize(html);
  const n = tokens.length;

  const isBr = (t) =>
    t.type === TokenType.SELF_CLOSING_TAG && t.tagName.toLowerCase() === 'br';
  const isBlockOpen = (t) =>
    t.type === TokenType.OPEN_TAG && BLOCK_ELEMENTS.has(t.tagName.toLowerCase());
  const isBlockClose = (t) =>
    t.type === TokenType.CLOSE_TAG && BLOCK_ELEMENTS.has(t.tagName.toLowerCase());

  // Pass A: for every token record its immediate enclosing block-open index
  // (-1 = body level), and whether that block holds direct non-blank text.
  const parentBlock = new Array(n).fill(-1);
  const hasDirectText = {};
  const stack = [];
  for (let i = 0; i < n; i++) {
    const t = tokens[i];
    const top = stack.length ? stack[stack.length - 1] : -1;
    parentBlock[i] = top;
    if (isBlockOpen(t)) {
      stack.push(i);
      hasDirectText[i] = false;
    } else if (isBlockClose(t)) {
      if (stack.length &&
          tokens[stack[stack.length - 1]].tagName.toLowerCase() === t.tagName.toLowerCase()) {
        stack.pop();
      }
    } else if (t.type === TokenType.TEXT && top !== -1) {
      const stripped = t.content.replace(/&nbsp;/g, '').replace(/ /g, '').trim();
      if (stripped) hasDirectText[top] = true;
    }
  }

  // Pass B: rebuild, rewriting stray <br>s.
  const out = [];
  let i = 0;
  while (i < n) {
    const t = tokens[i];
    if (isBr(t)) {
      const pIdx = parentBlock[i];
      if (pIdx === -1) {
        // Body-level run -> single spacer. Skip whitespace-only text between brs.
        let last = i;
        let j = i + 1;
        while (j < n) {
          const tj = tokens[j];
          if (isBr(tj) && parentBlock[j] === -1) { last = j; j++; }
          else if (tj.type === TokenType.TEXT && parentBlock[j] === -1 &&
                   tj.content.trim() === '') { j++; }
          else break;
        }
        out.push('<p>&nbsp;</p>');
        i = last + 1;
        continue;
      }
      if (!hasDirectText[pIdx]) { i++; continue; } // empty block -> drop the <br>
      // else: real line break inside text — keep it
    }
    out.push(t.raw);
    i++;
  }
  return out.join('');
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all new `stray-breaks` tests green, and the pre-existing 59 tests still pass (total now 74).

- [ ] **Step 6: Lint**

Run: `npx eslint formatter/app.mjs formatter/tests/stray-breaks.test.mjs`
Expected: no new errors introduced by these files. (Pre-existing `no-undef` config-gap errors on other files are unrelated; do not "fix" them here.)

- [ ] **Step 7: Commit**

```bash
git add formatter/app.mjs formatter/tests/stray-breaks.test.mjs
git commit -m "feat(formatter): add normalizeStrayBreaks (strip stray <br> residue)

Token-level pass: body-level <br> runs collapse to <p>&nbsp;</p>, <br> inside
empty blocks is dropped, in-text line breaks are preserved. Pure string
transform, no DOM round-trip.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HEoNPKYeyKBsCjiox6FW4U"
```

---

### Task 2: Wire the Extras checkbox and pre-pass into the UI

**Files:**
- Modify: `formatter/index.html:222-236` (Extras group) — add the checkbox.
- Modify: `formatter/app.mjs:901-908` (`TIDY_CHECKBOX_IDS`) — add the id for persistence.
- Modify: `formatter/app.mjs` Tidy button handler (`btnTidy.addEventListener`, lines 1217-1247) — run the pre-pass.

**Interfaces:**
- Consumes: `normalizeStrayBreaks(html)` from Task 1.
- Produces: a new persisted checkbox `opt-stray-breaks`, default checked, that gates the pre-pass.

- [ ] **Step 1: Add the Extras checkbox (default ON)**

In `formatter/index.html`, inside the Extras section, add as the first option (before `opt-newline-before-close` at line 224):

```html
              <label class="option-checkbox">
                <input type="checkbox" id="opt-stray-breaks" checked>
                <span title="Removes &lt;br&gt; between or around block elements and inside otherwise-empty blocks; keeps line breaks inside text.">Strip stray line breaks</span>
              </label>
```

- [ ] **Step 2: Register the id for localStorage persistence**

In `formatter/app.mjs`, in the `TIDY_CHECKBOX_IDS` array (lines 901-908), add `'opt-stray-breaks'` to the final line. The array's last line becomes:

```javascript
  'opt-plain-text', 'opt-ai-watermarks', 'opt-smart-nbsps', 'opt-stray-breaks',
```

- [ ] **Step 3: Run the pre-pass in the Tidy handler**

In `formatter/app.mjs`, in the `btnTidy` click handler, replace this block (currently lines 1226-1227):

```javascript
      var opts = getTidyOptions();
      var result = tidy(html, opts);
```

with:

```javascript
      var opts = getTidyOptions();
      var normalized = document.getElementById('opt-stray-breaks').checked
        ? normalizeStrayBreaks(html)
        : html;
      var result = tidy(normalized, opts);
```

(The existing post-`tidy()` passes for tag-attributes/plain-text/ai-watermarks/smart-nbsps at lines 1228-1239 are unchanged and continue to operate on `result.output`.)

- [ ] **Step 4: Verify the full test suite still passes**

Run: `npm test`
Expected: PASS — 74 tests, no regressions (this task changes UI wiring, not the pure functions under test).

- [ ] **Step 5: Lint**

Run: `npx eslint formatter/app.mjs`
Expected: no new errors from the handler/array edits.

- [ ] **Step 6: Manual browser verification**

The local server is already serving the working tree at `http://127.0.0.1:8099/formatter/` (it serves from disk — just hard-refresh). If it isn't running, start it: `python3 -m http.server 8099 --bind 127.0.0.1`.

1. Open `http://127.0.0.1:8099/formatter/`, hard-refresh.
2. Paste into the Source editor:
   `<p dir="ltr">Learn about adaptation.</p><br><p dir="ltr">Through discussion.</p><br>`
3. Open the Tidy dropdown — confirm **Extras → "Strip stray line breaks"** is present and **checked**.
4. Click **Tidy**.
5. Expected output (two clean paragraphs, no `<br>`, no empty `<p>`):
   ```html
   <p dir="ltr">Learn about adaptation.</p>
   <p dir="ltr">Through discussion.</p>
   ```
   (`dir="ltr"` remains unless "Tag attributes" is also ticked — that is correct, separate behavior.)
6. Uncheck "Strip stray line breaks", re-paste, Tidy again → the `<br>`s should now survive, confirming the toggle gates the behavior.
7. Reload the page → confirm the checkbox state persisted (localStorage).

- [ ] **Step 7: Commit**

```bash
git add formatter/index.html formatter/app.mjs
git commit -m "feat(formatter): add 'Strip stray line breaks' Extras option (default on)

Wires normalizeStrayBreaks as a pre-pass before tidy(), gated by a new
persisted Extras checkbox. Stray <br> residue is removed by default; the
resulting <p>&nbsp;</p>/<p></p> is cleaned by the existing one-space/empty-tag
cleaners.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HEoNPKYeyKBsCjiox6FW4U"
```

---

### Task 3: Update docs

**Files:**
- Modify: `CLAUDE.md` (the `/formatter/` bullet under "Current Tools").

- [ ] **Step 1: Note the new Extras option**

In `CLAUDE.md`, in the `/formatter/` description, extend the Extras parenthetical to mention the new option, e.g. change "and **Extras** (data-attrs, span-unwrap, etc.)" to "and **Extras** (data-attrs, span-unwrap, strip-stray-line-breaks, etc.)", and add one sentence: "`normalizeStrayBreaks` (ES module, `formatter/app.mjs`) runs as a pre-pass before `tidy()` to remove `<br>` residue between/around blocks; tests in `formatter/tests/stray-breaks.test.mjs`."

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note Strip stray line breaks formatter option

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HEoNPKYeyKBsCjiox6FW4U"
```

---

## Self-Review

**Spec coverage:**
- Behavior rules Case 1/2/3 → Task 1 function + tests. ✓
- Token-level approach (no DOM round-trip) → Task 1 implementation. ✓
- Extras group, label, `opt-stray-breaks` key, default ON, persistence → Task 2. ✓
- Pipeline ordering (pre-pass before one-space cleaner) → Task 2 Step 3. ✓
- Block-element list (deferred-to-plan in spec) → Task 1 Step 3 `BLOCK_ELEMENTS`. ✓
- `<br>`/`<br/>`/`<br />` variants → Task 1 variant test + verified tokenization note. ✓
- End-to-end Google-Docs input → Task 1 end-to-end test + Task 2 manual verification. ✓
- Out-of-scope items (forced-root-block fidelity, loose-text wrapping) → not implemented, as specified. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; commands explicit. ✓

**Type consistency:** `normalizeStrayBreaks(html: string): string` used identically in Task 1 export, Task 1 tests, and Task 2 handler. `opt-stray-breaks` id identical across index.html, `TIDY_CHECKBOX_IDS`, and the handler. ✓
