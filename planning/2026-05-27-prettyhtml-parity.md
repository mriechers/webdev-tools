# prettyhtml.com Functional Parity Implementation Plan

> **⚠️ Partially superseded (2026-09-03).** This plan's option-by-option mapping and its literal-port transcriptions (options 7, 9, 10) still stand. Its **Algorithm Snapshot appendix is incomplete** — it captured the individual cleaners but not the pipeline that surrounds them (pre-pass, post-pass loop, unconditional script/style removal, option dispatch order, Prettify/Compress). For the complete and corrected spec, read **`2026-09-03-prettyhtml-complete-capture.md`** first; that document is authoritative where the two disagree.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/formatter/` a functional replacement for prettyhtml.com — every option that exists there is available here, with the same labels and defaults, so the user is insulated from prettyhtml.com disappearing or changing hands.

**Architecture:** Keep the existing vanilla-JS / zero-build pipeline (tokenize → indent → tidy → compress), the existing mature CSS, the existing dual-editor UI, and the existing 15 options. **Add** 4 new cleaners for the genuinely missing functionality. **Rename/regroup** 6 existing options so the dropdown's middle section reads identically to prettyhtml.com. **Enhance** 1 existing option (inline styles also kills valign/align). **Split** 1 existing option into 2 (empty tags + one-space tags) so the labels match.

**Tech Stack:** HTML / CSS / vanilla JS (no build step); `mammoth.js` lazy-loaded from CDN for optional DOCX import; Node.js built-in test runner for the new cleaners. Everything stays GitHub-Pages-deployable.

---

## Context (read this before touching code)

### What prettyhtml.com actually is

The user depends on **prettyhtml.com** — a TinyMCE + CodeMirror + jQuery formatter run by Ruwix Services SRL (one-person Hungarian operation; variable names like `helyettesit`, `gondolkodobaesett` give it away). It is **not** the open-source `@starptech/prettyhtml` library at `prettyhtml.netlify.app` — they share a name but are unrelated. Library research is irrelevant.

prettyhtml.com exposes 10 cleaning toggles (defaults: 1-6 ON, 7-10 OFF, cookie-persisted), plus a Prettify button, a Compress button, dual visual/source editor, and a file drop zone accepting `.docx/.doc/.html/.htm`.

### Mapping table — current option → prettyhtml.com option

| Our current option | prettyhtml.com label | Status |
|---|---|---|
| `opt-remove-styles` | **#1 Inline styles** | Match — but theirs also kills `valign=` and `align=` (Task 2) |
| `opt-remove-classes` + `opt-remove-ids` | **#2 Classes & IDs** | Merge two into one (Task 3) |
| `opt-remove-empty-tags` (case 1: `<x></x>`) | **#3 Empty tags** | Split out from current bundled option (Task 4) |
| `opt-remove-empty-tags` (case 2: `<x>&nbsp;</x>`) | **#4 Tags with 1 space** | Split out from current bundled option (Task 4) |
| `opt-trim-whitespace` | **#5 Successive spaces** | Just rename label (Task 5) |
| `opt-remove-comments` | **#6 Comments** | Just rename label (Task 5) |
| *(no equivalent)* | **#7 Tag attributes** | NEW — strip-all-attrs except `<a href\|download>` and `<img src>` (Task 6) |
| *(no equivalent)* | **#8 To plain text** | NEW — strip all tags but preserve comments (Task 7) |
| *(no equivalent)* | **#9 AI Watermarks** | NEW — strip invisibles + mojibake. **Literal port.** (Task 8) |
| *(no equivalent)* | **#10 Smart &nbsp;s** | NEW — typographic NBSP insertion. **Literal port.** (Task 9) |

**Our extras with no prettyhtml.com counterpart** (these stay in a third "Extras" section of the dropdown): `opt-lowercase-tags`, `opt-lowercase-attrs`, `opt-sort-attrs`, `opt-remove-empty-attrs`, `opt-fix-self-closing`, `opt-unquoted-to-quoted`, `opt-newline-before-close`, `opt-remove-data-attrs`, `opt-unwrap-spans`.

### Source-of-truth files (already gathered, 2026-05-27 snapshot)

**These `/tmp` paths are gone** — `/tmp` did not survive. A fresh capture was taken on 2026-09-03 and now lives in `planning/captures/` (gitignored, local-only; see the legal note in `2026-09-03-prettyhtml-complete-capture.md`). The original list, for the record:
- `/tmp/prettyhtml-home.html` — full HTML of prettyhtml.com (33 KB)
- `/tmp/prettyhtml.js` — cleaning logic (73 KB minified)
- `/tmp/prettyhtml-pretty.js` — naively pretty-printed (1133 lines)
- `/tmp/prettyhtml.css` — UI styles (33 KB)

If those are gone, the **Algorithm Snapshot** appendix at the bottom of this plan has every cleaning algorithm transcribed verbatim — the literal-port tasks (8, 9) can be implemented from that appendix alone.

---

## File Structure

```
formatter/
├── index.html            # MODIFY — relabel existing checkboxes, add 4 new ones, regroup dropdown
├── styles.css            # UNCHANGED (or trivial tweaks only)
├── app.js                # MODIFY — split empty-tags logic, merge classes/ids, enhance inline-styles,
│                         #          add 4 new cleaners (inline in this file), wire new checkboxes
├── docx.js               # CREATE (OPTIONAL — Task 10) — lazy-loaded mammoth.js wrapper
└── tests/                # CREATE
    ├── ai-watermarks.test.mjs    # snapshot tests for the literal port
    ├── smart-nbsps.test.mjs      # snapshot tests for the literal port
    ├── tag-attributes.test.mjs   # state-machine tests
    ├── plain-text.test.mjs       # smoke tests
    └── helpers.mjs               # minimal DOM shim (linkedom) and test runner glue
```

**Why no `cleaners/` directory:** the simple cleaners (1-6) are already implemented in `app.js`'s existing `tidy()` function — we keep that logic and just split/rename/enhance in place. Only the 4 new algorithms need new code, and they're small enough to live alongside `tidy()`. The existing CSS is untouched.

---

## Tasks

### Task 1: Lock in the mapping decision

**Files:** none — read-only.

Re-read the **Mapping table** above. Convince yourself:
- Every prettyhtml.com option has either an existing equivalent (renamed/enhanced) or a new task.
- Every existing option still has a home (renamed, merged, split, or moved to "Extras").
- No prettyhtml.com behavior is silently lost.

- [ ] **Step 1: If any cell in the mapping table feels wrong, fix it before writing code.**

The Mapping table is the spec — every subsequent task implements exactly one row.

---

### Task 2: Enhance Inline styles — also strip valign and align

prettyhtml.com's option 1 strips not just `style="..."` but also `valign="..."` and `align="..."` — both are Word-doc residue. Our `opt-remove-styles` currently only handles `style`.

**Files:**
- Modify: `formatter/app.js` — find the inline-style stripping inside `buildTidyTag()` (line 400-439) and the `removeStyles` block

- [ ] **Step 1: Locate the existing code**

```bash
grep -n 'removeStyles\|opt-remove-styles' formatter/app.js
```

Expected hits: `app.js:409` (the `if (opts.removeStyles && lowerAttrName === 'style')` check), `app.js:516` (same check in the span-unwrap branch), `app.js:668`, `app.js:687`.

- [ ] **Step 2: Update the attribute-drop check to include valign and align**

In `formatter/app.js:409`, change:
```javascript
if (opts.removeStyles && lowerAttrName === 'style') return null;
```
to:
```javascript
if (opts.removeStyles && (lowerAttrName === 'style' || lowerAttrName === 'valign' || lowerAttrName === 'align')) return null;
```

And the matching check inside the span-unwrap branch at `app.js:516`:
```javascript
if (opts.removeStyles && an === 'style') return false;
```
to:
```javascript
if (opts.removeStyles && (an === 'style' || an === 'valign' || an === 'align')) return false;
```

- [ ] **Step 3: Smoke test in browser**

```bash
npx serve .
```

Open `/formatter/`, paste:
```html
<table valign="top" align="center"><tr><td style="color:red" valign="middle">x</td></tr></table>
```
With "Remove inline styles" checked, click Tidy. Expected output: `<table><tr><td>x</td></tr></table>`.

- [ ] **Step 4: Commit**

```bash
git add formatter/app.js
git commit -m "feat(formatter): inline-styles cleaner also strips valign and align (Word residue)

Matches prettyhtml.com option #1 behavior."
```

---

### Task 3: Merge classes + ids into a single "Classes & IDs" option

prettyhtml.com bundles class/id removal under one checkbox; we currently have two. The user wants the dropdown to read like prettyhtml.com.

**Files:**
- Modify: `formatter/index.html:201-208` (the two `<label>` elements for `opt-remove-classes` and `opt-remove-ids`)
- Modify: `formatter/app.js` — `getTidyOptions()`, the option dispatch in `buildTidyTag()`, `TIDY_CHECKBOX_IDS`

- [ ] **Step 1: Replace the two checkboxes with one in index.html**

In `formatter/index.html`, replace lines 200-205:
```html
<label class="option-checkbox">
  <input type="checkbox" id="opt-remove-classes">
  <span>Remove classes</span>
</label>
<label class="option-checkbox">
  <input type="checkbox" id="opt-remove-ids">
  <span>Remove id attributes</span>
</label>
```
with:
```html
<label class="option-checkbox">
  <input type="checkbox" id="opt-classes-ids">
  <span>Classes &amp; IDs</span>
</label>
```

- [ ] **Step 2: Update getTidyOptions() in app.js**

Find `app.js:656-674` (the `getTidyOptions()` function) and replace:
```javascript
removeClasses: document.getElementById('opt-remove-classes').checked,
...
removeIds: document.getElementById('opt-remove-ids').checked,
```
with:
```javascript
removeClassesIds: document.getElementById('opt-classes-ids').checked,
```

- [ ] **Step 3: Update buildTidyTag() to use the unified flag**

Find `app.js:411-412`:
```javascript
if (opts.removeClasses && lowerAttrName === 'class') return null;
if (opts.removeIds && lowerAttrName === 'id') return null;
```
Replace with:
```javascript
if (opts.removeClassesIds && (lowerAttrName === 'class' || lowerAttrName === 'id')) return null;
```

And the equivalent checks in the span-unwrap branch at `app.js:517-518`.

- [ ] **Step 4: Update TIDY_CHECKBOX_IDS**

Find `app.js:683-689` and replace `'opt-remove-classes'` and `'opt-remove-ids'` with the single `'opt-classes-ids'`.

- [ ] **Step 5: Smoke test**

Paste `<p class="x" id="y">text</p>`, check "Classes & IDs", click Tidy. Expected: `<p>text</p>`.

- [ ] **Step 6: Commit**

```bash
git add formatter/index.html formatter/app.js
git commit -m "refactor(formatter): merge Remove Classes + Remove IDs into Classes & IDs

Matches prettyhtml.com option #2 label."
```

---

### Task 4: Split empty-tags into "Empty tags" + "Tags with 1 space"

Currently `opt-remove-empty-tags` handles BOTH `<x></x>` and `<x>&nbsp;</x>` in one option (see `app.js:484-510`, case 1 and case 2). prettyhtml.com splits these into two. The dropdown needs both checkboxes; the existing case-1 branch maps to "Empty tags", case-2 maps to "Tags with 1 space".

**Files:**
- Modify: `formatter/index.html:181` (the single `opt-remove-empty-tags` checkbox)
- Modify: `formatter/app.js` — split case 1 from case 2 logic; update `getTidyOptions()`

- [ ] **Step 1: Replace the checkbox with two**

In `formatter/index.html`, replace the existing `opt-remove-empty-tags` label with:
```html
<label class="option-checkbox">
  <input type="checkbox" id="opt-empty-tags" checked>
  <span>Empty tags</span>
</label>
<label class="option-checkbox">
  <input type="checkbox" id="opt-one-space-tags" checked>
  <span>Tags with 1 space</span>
</label>
```

- [ ] **Step 2: Update getTidyOptions()**

In `app.js`, replace:
```javascript
removeEmptyTags: document.getElementById('opt-remove-empty-tags').checked,
```
with:
```javascript
removeEmptyTags: document.getElementById('opt-empty-tags').checked,
removeOneSpaceTags: document.getElementById('opt-one-space-tags').checked,
```

- [ ] **Step 3: Split the dispatch in tidy()**

In `formatter/app.js:484-510` (the `OPEN_TAG` case 1 and case 2 inside `tidy()`), change the guards:

```javascript
// Case 1: <tag></tag> — directly empty
if (canRemove && opts.removeEmptyTags && nextToken &&
    nextToken.type === TokenType.CLOSE_TAG &&
    nextToken.tagName.toLowerCase() === lowerName) {
  fixCount++;
  i++;
  break;
}

// Case 2: <tag>&nbsp;</tag> — contains only &nbsp; / whitespace
if (canRemove && opts.removeOneSpaceTags && nextToken && nextToken.type === TokenType.TEXT) {
  const stripped = nextToken.content.replace(/&nbsp;/g, '').trim();
  const closeToken = tokens[i + 2];
  if (!stripped &&
      closeToken && closeToken.type === TokenType.CLOSE_TAG &&
      closeToken.tagName.toLowerCase() === lowerName) {
    fixCount++;
    i += 2;
    break;
  }
}
```

(The outer `if (opts.removeEmptyTags)` wrapping both cases gets removed; each case now has its own opt guard.)

- [ ] **Step 4: Update TIDY_CHECKBOX_IDS**

Replace `'opt-remove-empty-tags'` with `'opt-empty-tags', 'opt-one-space-tags'`.

- [ ] **Step 5: Smoke test**

Paste `<p></p><div>&nbsp;</div><span>x</span>`, check both new options, click Tidy. Expected: `<span>x</span>`.

Then uncheck "Tags with 1 space" and re-paste/Tidy. Expected: `<div>&nbsp;</div><span>x</span>`.

- [ ] **Step 6: Commit**

```bash
git add formatter/index.html formatter/app.js
git commit -m "refactor(formatter): split empty-tags into Empty tags + Tags with 1 space

Matches prettyhtml.com options #3 and #4 — two distinct toggles."
```

---

### Task 5: Relabel + reorder Successive spaces and Comments

These two already work; just relabel.

**Files:**
- Modify: `formatter/index.html` (the labels for `opt-remove-comments` and `opt-trim-whitespace`)

- [ ] **Step 1: Rename labels**

In `formatter/index.html`, change:
- `<span>Remove comments</span>` → `<span>Comments</span>`
- `<span>Trim extra whitespace</span>` → `<span>Successive spaces</span>`

The IDs (`opt-remove-comments`, `opt-trim-whitespace`) stay — only the visible text changes. localStorage keys keep working.

- [ ] **Step 2: Commit**

```bash
git add formatter/index.html
git commit -m "ui(formatter): rename labels to match prettyhtml.com (Comments, Successive spaces)"
```

---

### Task 6: NEW cleaner — Tag attributes (option #7)

Strips all attributes except `<a href|download>` and `<img src>`. Literal port of prettyhtml.com's `removeTagAttributes()` byte-level state machine.

**Files:**
- Modify: `formatter/app.js` — add `removeAllTagAttributes()` function, add checkbox handler, run before tidy() in the pipeline
- Modify: `formatter/index.html` — add checkbox
- Create: `formatter/tests/tag-attributes.test.mjs`
- Create: `formatter/tests/helpers.mjs`

- [ ] **Step 1: Create test harness**

```javascript
// formatter/tests/helpers.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { DOMParser } from 'linkedom';

globalThis.DOMParser = DOMParser;

export { test, assert };
```

Add `linkedom` as a dev dep:
```bash
cd /Users/mriechers/Developer/personal/webdev-tools
npm install --save-dev linkedom
```

Add to `package.json` scripts:
```json
"test": "node --test formatter/tests/"
```

- [ ] **Step 2: Write the failing test**

```javascript
// formatter/tests/tag-attributes.test.mjs
import { test, assert } from './helpers.mjs';
import { removeAllTagAttributes } from '../app.js';
// NOTE: requires app.js to export this function — see Step 4.

test('strips all attrs on generic tags', () => {
  assert.equal(removeAllTagAttributes('<p class="x" id="y">z</p>'), '<p>z</p>');
});

test('keeps href on anchors', () => {
  assert.equal(
    removeAllTagAttributes('<a href="https://x" class="x" target="_blank">y</a>'),
    '<a href="https://x">y</a>'
  );
});

test('keeps download on anchors', () => {
  assert.match(
    removeAllTagAttributes('<a href="x.pdf" download="file.pdf" rel="noopener">y</a>'),
    /<a href="x\.pdf" download="file\.pdf">y<\/a>/
  );
});

test('keeps src on images', () => {
  assert.match(
    removeAllTagAttributes('<img src="x.jpg" alt="y" class="z" />'),
    /<img src="x\.jpg".*\/?>/
  );
});

test('preserves comments', () => {
  assert.equal(
    removeAllTagAttributes('<!-- keep this --><p class="x">y</p>'),
    '<!-- keep this --><p>y</p>'
  );
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test
```

Expected: FAIL — `removeAllTagAttributes` not exported.

- [ ] **Step 4: Implement (literal port of the state machine)**

Add to `formatter/app.js`, immediately after `compress()`:

```javascript
// ============================================================
// TAG ATTRIBUTES — prettyhtml.com option #7
// Literal port of removeTagAttributes() — byte-level state machine.
// Preserves: <a href|download>, <img src>. Strips everything else.
// ============================================================

/**
 * State legend:
 *   1  = outside tag (emitting)
 *   2  = inside tag name (until first space)
 *   3  = inside tag, suppressing
 *   4  = inside <a > tag name region
 *   5  = inside <a >, after name (looking for href/download)
 *   6  = inside the kept anchor attr name (e.g. href= seen)
 *   7  = waiting for opening quote of kept attr
 *   8  = inside kept anchor attr value
 *   14 = inside <img > tag name region
 *   15 = inside <img >, after name (looking for src)
 *   16 = inside the kept src attr name
 *   17 = waiting for opening quote of src
 *   18 = inside src attr value
 */
export function removeAllTagAttributes(text) {
  const e = [...text];
  const out = [];
  let a = 1;
  const len = e.length;
  const EMIT_STATES = new Set([1, 2, 4, 6, 7, 8, 14, 16, 17, 18]);

  for (let o = 0; o < len; o++) {
    if (e[o] === '<') {
      a = 2;
      if (e[o + 1] === '!' && e[o + 2] === '-' && e[o + 3] === '-') a = 1;
      if (e[o + 1] === 'a' && e[o + 2] === ' ') a = 4;
      if (e[o + 1] === 'i' && e[o + 2] === 'm' && e[o + 3] === 'g' && e[o + 4] === ' ') a = 14;
    }
    if (e[o] === ' ') {
      if (a === 2) a = 3;
      if (a === 4 || a === 5) {
        if (e[o + 1] === 'h' && e[o + 2] === 'r' && e[o + 3] === 'e' && e[o + 4] === 'f') a = 6;
        if (e[o + 1] === 'd' && e[o + 2] === 'o' && e[o + 3] === 'w' && e[o + 4] === 'n' &&
            e[o + 5] === 'l' && e[o + 6] === 'o' && e[o + 7] === 'a' && e[o + 8] === 'd') a = 6;
      }
      if (a === 14 || a === 15) {
        if (e[o + 1] === 's' && e[o + 2] === 'r' && e[o + 3] === 'c') a = 16;
      }
      if (a === 4) a = 5;
      if (a === 8) a = 3;
      if (a === 14) a = 15;
      if (a === 18) a = 3;
    }
    if (e[o] === '"' && a === 7) a = 8;
    if (e[o] === '"' && a === 6) a = 7;
    if (e[o] === '"' && a === 17) a = 18;
    if (e[o] === '"' && a === 16) a = 17;
    if (e[o] === '>' || (e[o] === '/' && e[o + 1] === '>')) a = 1;

    if (EMIT_STATES.has(a)) out.push(e[o]);
  }
  return out.join('');
}
```

**Important:** `app.js` currently uses non-module loading (`<script src="app.js">`, not `type="module"`). For the test file to import from it, we have two options:
1. **Recommended:** Add ES-module-style `export` keywords in `app.js` AND update `formatter/index.html:342` to `<script src="app.js" type="module">`. This needs no build step — modern browsers handle ES modules natively.
2. **Alternative:** Keep `app.js` non-module; duplicate the function into a separate file `formatter/cleaners.js` that the test imports. Less DRY but no script-tag change.

Pick option 1 for cleanness — it's a one-line HTML change and the rest of the codebase already uses modules (the shell does).

- [ ] **Step 5: Run tests — expected PASS**

```bash
npm test
```

- [ ] **Step 6: Add the checkbox to index.html**

In `formatter/index.html`, in the second dropdown section (cleaning options), insert:
```html
<label class="option-checkbox">
  <input type="checkbox" id="opt-tag-attributes">
  <span>Tag attributes</span>
</label>
```

Add `'opt-tag-attributes'` to `TIDY_CHECKBOX_IDS` in `app.js`.

- [ ] **Step 7: Wire it into the tidy flow**

In the `btn-tidy` click handler (currently `app.js:998-1016`), AFTER calling `tidy(html, opts)`, check the new option and conditionally run the new cleaner:

```javascript
let result = tidy(html, opts);
if (document.getElementById('opt-tag-attributes').checked) {
  result.output = removeAllTagAttributes(result.output);
}
updateEditors(result.output);
```

- [ ] **Step 8: Smoke test**

Paste `<p class="x"><a href="https://x" target="_blank">y</a></p>`. Check ONLY "Tag attributes". Click Tidy.
Expected: `<p><a href="https://x">y</a></p>`.

- [ ] **Step 9: Commit**

```bash
git add formatter/app.js formatter/index.html formatter/tests/tag-attributes.test.mjs formatter/tests/helpers.mjs package.json package-lock.json
git commit -m "feat(formatter): add Tag attributes cleaner (prettyhtml.com option #7)

Literal port of the byte-level state machine.
Strips all attrs except <a href|download> and <img src>."
```

---

### Task 7: NEW cleaner — To plain text (option #8)

Strips all HTML tags while preserving comment contents.

**Files:**
- Modify: `formatter/app.js`
- Modify: `formatter/index.html`
- Create: `formatter/tests/plain-text.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// formatter/tests/plain-text.test.mjs
import { test, assert } from './helpers.mjs';
import { toPlainText } from '../app.js';

test('strips all tags', () => {
  assert.equal(toPlainText('<p>hello <b>world</b></p>'), 'hello world');
});

test('preserves comments', () => {
  assert.equal(toPlainText('<p>x<!-- y --></p>'), 'x<!-- y -->');
});

test('handles nested tags', () => {
  assert.equal(toPlainText('<div><span>a</span><em>b</em></div>'), 'ab');
});
```

- [ ] **Step 2: Run — expected FAIL.**

- [ ] **Step 3: Implement**

Add to `formatter/app.js` after `removeAllTagAttributes`:

```javascript
// ============================================================
// PLAIN TEXT — prettyhtml.com option #8
// Strips all tags, preserves comment bodies.
// ============================================================

export function toPlainText(text) {
  const SENTINEL = ' COMMENT ';  // any unlikely string; we restore later
  // Save comments
  const comments = [];
  let t = text.replace(/<!--[\s\S]*?-->/g, m => {
    comments.push(m);
    return SENTINEL;
  });
  // Strip all remaining tags
  t = t.replace(/<[^>]*>/g, '');
  // Restore comments
  t = t.replace(new RegExp(SENTINEL, 'g'), () => comments.shift());
  return t;
}
```

> **Note:** prettyhtml.com's version uses byte-scan `torolTagbanKettoKozt("<", ">")` which preserves the bracket chars then collapses `<>` orphans with a space. The regex `/<[^>]*>/g` is byte-equivalent for well-formed HTML; if you find a real input where they diverge, fall back to the literal port using `deleteBetweenInTag` from the Algorithm Snapshot.

- [ ] **Step 4: Run — expected PASS.**

- [ ] **Step 5: Add the checkbox to index.html**

```html
<label class="option-checkbox">
  <input type="checkbox" id="opt-plain-text">
  <span>To plain text</span>
</label>
```

Add to `TIDY_CHECKBOX_IDS`.

- [ ] **Step 6: Wire into the tidy flow** (in the same conditional block as Task 6, Step 7)

```javascript
if (document.getElementById('opt-plain-text').checked) {
  result.output = toPlainText(result.output);
}
```

- [ ] **Step 7: Commit**

```bash
git add formatter/app.js formatter/index.html formatter/tests/plain-text.test.mjs
git commit -m "feat(formatter): add To plain text cleaner (prettyhtml.com option #8)"
```

---

### Task 8: NEW cleaner — AI Watermarks (option #9) — LITERAL PORT

This is the high-value cleaner. Strips zero-width chars, mojibake, and AI-introduced smart-punctuation. Replacements run in the exact prettyhtml.com order — ordering matters when one substitution can mask another.

**Files:**
- Modify: `formatter/app.js`
- Modify: `formatter/index.html`
- Create: `formatter/tests/ai-watermarks.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// formatter/tests/ai-watermarks.test.mjs
import { test, assert } from './helpers.mjs';
import { removeAiWatermarks } from '../app.js';

test('strips zero-width space (U+200B)', () => {
  assert.equal(removeAiWatermarks('a​b'), 'ab');
});

test('strips zero-width non-joiner (U+200C)', () => {
  assert.equal(removeAiWatermarks('a‌b'), 'ab');
});

test('strips word joiner (U+2060)', () => {
  assert.equal(removeAiWatermarks('a⁠b'), 'ab');
});

test('strips BOM (U+FEFF)', () => {
  assert.equal(removeAiWatermarks('a﻿b'), 'ab');
});

test('strips soft hyphen (U+00AD)', () => {
  assert.equal(removeAiWatermarks('a­b'), 'ab');
});

test('replaces real NBSP (U+00A0) with regular space LAST', () => {
  assert.equal(removeAiWatermarks('a b'), 'a b');
});

test('replaces &ldquo;/&rdquo; entities with straight quotes', () => {
  assert.equal(removeAiWatermarks('he said &ldquo;hi&rdquo;'), 'he said "hi"');
});

test('replaces &lsquo;/&rsquo; entities with straight apostrophes', () => {
  assert.equal(removeAiWatermarks("don&rsquo;t"), "don't");
});

test('replaces &mdash;/&ndash; entities with hyphens', () => {
  assert.equal(removeAiWatermarks('a&mdash;b'), 'a - b');
  assert.equal(removeAiWatermarks('a&ndash;b'), 'a - b');
});

test('replaces &hellip; with three dots', () => {
  assert.equal(removeAiWatermarks('wait&hellip;'), 'wait...');
});

test('replaces &nbsp; entity with space', () => {
  assert.equal(removeAiWatermarks('a&nbsp;b'), 'a b');
});

test('strips numeric zero-width entities', () => {
  assert.equal(removeAiWatermarks('a&#8203;b'), 'ab');
  assert.equal(removeAiWatermarks('a&#65279;b'), 'ab');
});

test('normalizes mojibake quotes to straight quotes', () => {
  // â€œ (U+00E2 U+20AC U+0153) is "“" misread as Latin-1
  assert.equal(removeAiWatermarks('â€œhelloâ€'), '"hello"');
});
```

- [ ] **Step 2: Run — expected FAIL.**

- [ ] **Step 3: Implement (verbatim from prettyhtml.com)**

Add to `formatter/app.js`:

```javascript
// ============================================================
// AI WATERMARKS — prettyhtml.com option #9
// Literal port of aiWatermarkFixer(). Order matters — see snapshot.
// ============================================================

export function removeAiWatermarks(text) {
  // helyettesit loops until idempotent; for simple .replace with /g,
  // a single pass is already idempotent for non-overlapping patterns.
  // We use single-pass replaces; if you find an input where this diverges
  // from prettyhtml.com's repeated-replace behavior, wrap each call in a
  // do/while loop.
  let t = text;

  // Phase 1 — HTML entities for dashes/quotes/ellipsis/nbsp
  t = t.replace(/&ndash;/g, ' - ');
  t = t.replace(/&mdash;/g, ' - ');
  t = t.replace(/&ldquo;/g, '"');
  t = t.replace(/&rdquo;/g, '"');
  t = t.replace(/&lsquo;/g, "'");
  t = t.replace(/&rsquo;/g, "'");
  t = t.replace(/&hellip;/g, '...');
  t = t.replace(/&nbsp;/g, ' ');
  t = t.replace(/&#160;/g, ' ');

  // Phase 2 — invisible/zero-width entities and codepoints
  t = t.replace(/&zwj;/g, '');
  t = t.replace(/&zwnj;/g, '');
  t = t.replace(/&shy;/g, '');
  t = t.replace(/&#8203;/g, '');   // ZWSP
  t = t.replace(/&#8204;/g, '');   // ZWNJ
  t = t.replace(/&#8205;/g, '');   // ZWJ
  t = t.replace(/&#8288;/g, '');   // WORD JOINER
  t = t.replace(/&#65279;/g, '');  // BOM
  t = t.replace(/​/g, '');
  t = t.replace(/‌/g, '');
  t = t.replace(/‍/g, '');
  t = t.replace(/⁠/g, '');
  t = t.replace(/﻿/g, '');
  t = t.replace(/­/g, '');

  // Phase 3 — UTF-8-misread-as-Latin-1 mojibake.
  // The literal source bytes for these are:
  //   â€œ = 0xC3 0xA2 0xE2 0x82 0xAC 0xC5 0x93   (“ U+201C as UTF-8 misread)
  //   â€  = 0xC3 0xA2 0xE2 0x82 0xAC             (” U+201D as UTF-8 misread)
  //   â€ž = 0xC3 0xA2 0xE2 0x82 0xAC 0xC5 0xBE   („ U+201E as UTF-8 misread)
  //   Â«  = 0xC3 0x82 0xC2 0xAB                   (« U+00AB as UTF-8 misread)
  //   Â»  = 0xC3 0x82 0xC2 0xBB                   (» U+00BB as UTF-8 misread)
  // The character class below contains the BYTES of those sequences when
  // the file is interpreted as Latin-1. To avoid encoding surprises in
  // editors, encode via \u escapes.
  t = t.replace(/[â€œžÂ«»]/g, '"');
  t = t.replace(/[˜˘˚‹›]/g, "'");

  // Em-dash / en-dash mojibake (U+2013, U+2014 misread as 3-byte sequences):
  t = t.replace(/â€“/g, '-');   // en-dash
  t = t.replace(/â€”/g, '--');  // em-dash
  t = t.replace(/â€¦/g, '...'); // ellipsis
  t = t.replace(/â¸º/g, '--');  // U+2E3A two-em
  t = t.replace(/â¸»/g, '---'); // U+2E3B three-em

  // Compress word—word mojibake to word word
  t = t.replace(/(\w)[â€“”¸]+(\w)/g, '$1 $2');

  // Phase 4 — real NBSP last
  t = t.replace(/ /g, ' ');

  return t;
}
```

> **Verification note:** the mojibake character classes are tricky. After implementing, paste a real AI-generated paragraph (with smart quotes that came out as `â€œfooâ€`) into the formatter and verify they normalize to straight quotes. If a specific mojibake sequence isn't handled, find its bytes via `python3 -c "print(open('/tmp/prettyhtml.js','rb').read()[12300:12500])"` and add the missing codepoints to the regex character class.

- [ ] **Step 4: Run — expected PASS.**

- [ ] **Step 5: Add the checkbox to index.html**

```html
<label class="option-checkbox">
  <input type="checkbox" id="opt-ai-watermarks">
  <span>AI Watermarks</span>
</label>
```

Add to `TIDY_CHECKBOX_IDS`.

- [ ] **Step 6: Wire into the tidy flow**

```javascript
if (document.getElementById('opt-ai-watermarks').checked) {
  result.output = removeAiWatermarks(result.output);
}
```

- [ ] **Step 7: Commit**

```bash
git add formatter/app.js formatter/index.html formatter/tests/ai-watermarks.test.mjs
git commit -m "feat(formatter): add AI Watermarks cleaner (prettyhtml.com option #9)

Literal port of aiWatermarkFixer(). Strips zero-width characters,
mojibake from UTF-8/Latin-1 misencoding, and normalizes AI-introduced
smart punctuation (curly quotes, ellipsis, en/em dashes)."
```

---

### Task 9: NEW cleaner — Smart non-breaking spaces (option #10) — LITERAL PORT

Inserts NBSP before short trailing words in headings/paragraphs/divs (typographic widow prevention), and `&nbsp;` after short words following periods or `<p>`.

**Files:**
- Modify: `formatter/app.js`
- Modify: `formatter/index.html`
- Create: `formatter/tests/smart-nbsps.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// formatter/tests/smart-nbsps.test.mjs
import { test, assert } from './helpers.mjs';
import { smartNbsps } from '../app.js';

test('inserts U+00A0 before short last word in <p>', () => {
  const out = smartNbsps('<p>This is a test</p>');
  // "test" is 4 chars (< 10): space before it becomes U+00A0
  assert.equal(out, '<p>This is a test</p>');
});

test('long last word is left alone', () => {
  const out = smartNbsps('<p>This is a thunderstorm</p>');
  // "thunderstorm" is 12 chars (>= 10): no change in Phase A
  // (Phase B may still mutate based on period rule)
  assert.match(out, /This is a thunderstorm/);
});

test('walks headings', () => {
  const out = smartNbsps('<h2>Section one</h2>');
  assert.equal(out, '<h2>Section one</h2>');
});

test('after period + short word -> &nbsp; entity', () => {
  // Phase B: ". Yes was loud" -> "Yes" < 7 chars -> "Yes&nbsp;was loud"
  const out = smartNbsps('<p>End. Yes was loud here</p>');
  assert.match(out, /Yes&nbsp;was/);
});

test('long word after period unaffected', () => {
  const out = smartNbsps('<p>End. Thunderstorm came</p>');
  assert.match(out, /Thunderstorm came/);
  assert.doesNotMatch(out, /Thunderstorm&nbsp;/);
});
```

- [ ] **Step 2: Run — expected FAIL.**

- [ ] **Step 3: Implement**

Add to `formatter/app.js`:

```javascript
// ============================================================
// SMART NBSPS — prettyhtml.com option #10
// Two phases:
//   A. In h1-h6, p, div text nodes: if LAST WORD < 10 chars,
//      replace the whitespace separator before it with U+00A0.
//   B. Globally: after `.` or `<p>` + whitespace + short word + whitespace,
//      append `&nbsp;` entity after the short word.
// ============================================================

export function smartNbsps(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  function walk(node) {
    node.childNodes.forEach(child => {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        child.nodeValue = lastWordNbsp(child.nodeValue);
      } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
        walk(child);
      }
    });
  }

  function lastWordNbsp(text) {
    const tokens = text.split(/(\s+)/);  // keep separators
    let lastIdx = tokens.length - 1;
    while (lastIdx >= 0 && tokens[lastIdx].trim() === '') lastIdx--;
    if (lastIdx < 0 || tokens[lastIdx].trim().length >= 10) return text;
    for (let i = lastIdx - 1; i >= 0; i--) {
      if (tokens[i].trim() === '') {
        tokens[i] = ' ';  // literal NBSP char, not the entity
        break;
      }
    }
    return tokens.join('');
  }

  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(walk);
  doc.querySelectorAll('p, div').forEach(walk);

  // Phase B — first-word-after-period rule (uses &nbsp; ENTITY)
  return doc.body.innerHTML.replace(
    /(\.|<p>)(\s*)(\w+)(\s+)/g,
    (m, prefix, ws1, word) => word.length < 7 ? `${prefix}${ws1}${word}&nbsp;` : m
  );
}
```

> **Note on Phase A vs B asymmetry:** Phase A inserts the U+00A0 character (modifying a text node where character form is fine); Phase B inserts the `&nbsp;` HTML entity (operating on serialized HTML where the entity form serializes cleanly). This is intentional in prettyhtml.com and we replicate it. Verified against `/tmp/prettyhtml.js` byte offset 10789+312: the bytes are `\xc2\xa0` (UTF-8 for U+00A0).

- [ ] **Step 4: Run — expected PASS.**

- [ ] **Step 5: Add the checkbox to index.html**

```html
<label class="option-checkbox">
  <input type="checkbox" id="opt-smart-nbsps">
  <span>Smart &amp;nbsp;s</span>
</label>
```

Add to `TIDY_CHECKBOX_IDS`.

- [ ] **Step 6: Wire into the tidy flow**

```javascript
if (document.getElementById('opt-smart-nbsps').checked) {
  result.output = smartNbsps(result.output);
}
```

- [ ] **Step 7: Commit**

```bash
git add formatter/app.js formatter/index.html formatter/tests/smart-nbsps.test.mjs
git commit -m "feat(formatter): add Smart non-breaking spaces (prettyhtml.com option #10)

Literal port of smartNbsps(). Phase A inserts U+00A0 char before
short trailing words in headings/paragraphs; Phase B inserts &nbsp;
entity after short words following periods."
```

---

### Task 10: Regroup the dropdown into three labeled sections

Reorganize the dropdown so the middle section reads exactly like prettyhtml.com's 10 options in order, with our extras above and below.

**Files:**
- Modify: `formatter/index.html` — the `<div id="tidy-dropdown">` block

- [ ] **Step 1: Rewrite the dropdown body**

Replace the current three unlabeled sections with three labeled sections. Final structure:

```html
<div id="tidy-dropdown" class="tidy-dropdown" hidden>
  <!-- ===== Group 1: Formatting (our extras, no prettyhtml.com counterpart) ===== -->
  <div class="tidy-dropdown-section">
    <div class="tidy-section-title">Formatting</div>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-lowercase-tags" checked>
      <span>Lowercase tags</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-lowercase-attrs" checked>
      <span>Lowercase attributes</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-sort-attrs">
      <span>Sort attributes</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-remove-empty-attrs">
      <span>Remove empty attributes</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-fix-self-closing" checked>
      <span>Fix self-closing tags</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-unquoted-to-quoted" checked>
      <span>Quote attributes</span>
    </label>
  </div>

  <div class="tidy-dropdown-divider"></div>

  <!-- ===== Group 2: Cleaning — prettyhtml.com options in order ===== -->
  <div class="tidy-dropdown-section">
    <div class="tidy-section-title">Cleaning (prettyhtml.com)</div>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-remove-styles" checked>
      <span>Inline styles</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-classes-ids" checked>
      <span>Classes &amp; IDs</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-empty-tags" checked>
      <span>Empty tags</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-one-space-tags" checked>
      <span>Tags with 1 space</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-trim-whitespace" checked>
      <span>Successive spaces</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-remove-comments" checked>
      <span>Comments</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-tag-attributes">
      <span>Tag attributes</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-plain-text">
      <span>To plain text</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-ai-watermarks">
      <span>AI Watermarks</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-smart-nbsps">
      <span>Smart &amp;nbsp;s</span>
    </label>
  </div>

  <div class="tidy-dropdown-divider"></div>

  <!-- ===== Group 3: Extras (our extras, no prettyhtml.com counterpart) ===== -->
  <div class="tidy-dropdown-section">
    <div class="tidy-section-title">Extras</div>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-newline-before-close">
      <span>Newline before closing &gt;</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-remove-data-attrs">
      <span>Remove data-* attributes</span>
    </label>
    <label class="option-checkbox">
      <input type="checkbox" id="opt-unwrap-spans" checked>
      <span>Unwrap empty &lt;span&gt; tags</span>
    </label>
  </div>

  <div class="tidy-dropdown-footer">
    Settings are saved automatically.
  </div>
</div>
```

**Defaults match prettyhtml.com 1-for-1 in Group 2:** options 1-6 checked (Inline styles, Classes & IDs, Empty tags, Tags with 1 space, Successive spaces, Comments); options 7-10 unchecked.

- [ ] **Step 2: Add a small style for section titles**

Append to `formatter/styles.css`:

```css
.tidy-section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--space-xs);
}
```

- [ ] **Step 3: Smoke test in browser**

Run `npx serve .` and verify:
- Three labeled groups
- Group 2 has exactly 10 checkboxes in prettyhtml.com order
- First 6 of Group 2 are checked by default
- Last 4 of Group 2 are unchecked by default
- Click Tidy with the example HTML — works without console errors

- [ ] **Step 4: Commit**

```bash
git add formatter/index.html formatter/styles.css
git commit -m "ui(formatter): regroup tidy dropdown into Formatting / Cleaning / Extras

Cleaning group's order and labels match prettyhtml.com 1-for-1.
Defaults for the cleaning group match prettyhtml.com defaults
(options 1-6 ON, 7-10 OFF)."
```

---

### Task 11 (OPTIONAL): Add DOCX drop support

Skip this task if Word document import isn't a workflow you actually use — the formatter still accepts pasted rich text (which works for content copied from Word in a browser).

**Files:**
- Create: `formatter/docx.js`
- Modify: `formatter/index.html` (add drop-zone overlay)
- Modify: `formatter/app.js` (wire drop events)
- Modify: `formatter/styles.css` (drop-zone style)

- [ ] **Step 1: Create lazy mammoth.js loader**

```javascript
// formatter/docx.js
const MAMMOTH_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js';
let loadPromise = null;

function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MAMMOTH_URL;
    s.onload = () => resolve(window.mammoth);
    s.onerror = () => reject(new Error('Failed to load mammoth.js'));
    document.head.appendChild(s);
  });
  return loadPromise;
}

export async function docxToHtml(file) {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value;
}
```

- [ ] **Step 2: Add drop-zone overlay to index.html**

Insert at the top of `<main>`:
```html
<div id="drop-zone" class="drop-zone" hidden>
  <p>Drop a <code>.docx</code> or <code>.html</code> file</p>
</div>
```

- [ ] **Step 3: Add styles**

```css
.drop-zone {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--color-bg) 80%, transparent);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text);
  font-size: var(--text-xl);
  z-index: 1000;
  pointer-events: none;
}
```

- [ ] **Step 4: Wire drop events in app.js**

```javascript
import { docxToHtml } from './docx.js';

const dropZone = document.getElementById('drop-zone');
let dragDepth = 0;

document.addEventListener('dragenter', e => {
  e.preventDefault();
  dragDepth++;
  dropZone.hidden = false;
});
document.addEventListener('dragleave', e => {
  e.preventDefault();
  if (--dragDepth <= 0) dropZone.hidden = true;
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', async e => {
  e.preventDefault();
  dragDepth = 0;
  dropZone.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    let html;
    if (/\.docx?$/i.test(file.name)) html = await docxToHtml(file);
    else if (/\.html?$/i.test(file.name)) html = await file.text();
    else { showError('Unsupported file', `Use .docx, .doc, .html, or .htm.`); return; }
    setInputHTML(inputEditor, html);
    syncVisualToSource();
  } catch (err) {
    showError('File import failed', err.message);
  }
});
```

- [ ] **Step 5: Smoke test**

Drag a real `.docx` file onto the formatter. Visual pane should populate with the converted HTML.

- [ ] **Step 6: Commit**

```bash
git add formatter/docx.js formatter/index.html formatter/styles.css formatter/app.js
git commit -m "feat(formatter): add DOCX/HTML file drop import via lazy mammoth.js"
```

---

### Task 12: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the `/formatter/` description**

Find the formatter section in `CLAUDE.md` and update to mention the prettyhtml.com-compatible cleaning group and the new options. One paragraph is fine — don't bloat it.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note prettyhtml.com-compatible cleaning options in formatter description"
```

---

## Self-review checklist (run before claiming done)

1. **Mapping coverage:** every prettyhtml.com option has an implementing task. ✓
2. **Defaults match:** Group 2's first 6 checkboxes are `checked` in HTML, last 4 are not. ✓
3. **Existing CSS preserved:** only one small addition (`.tidy-section-title`). All other CSS untouched. ✓
4. **Insurance copy:** Algorithm Snapshot below has all 10 algorithms verbatim. ✓
5. **No placeholders:** every step has runnable code or commands. ✓

---

## Algorithm Snapshot (The Insurance)

If `prettyhtml.com` disappears before you've finished implementing — or if you need to verify a literal port — this section captures every algorithm verbatim from `/tmp/prettyhtml.js`.

### Defaults (cookie-persisted on prettyhtml.com)

```
opt[1] = 1   Inline styles            (ON)
opt[2] = 1   Classes & IDs            (ON)
opt[3] = 1   Empty tags               (ON)
opt[4] = 1   Tags with 1 space        (ON)
opt[5] = 1   Successive spaces        (ON)
opt[6] = 1   Comments                 (ON)
opt[7] = 0   Tag attributes           (OFF)
opt[8] = 0   To plain text            (OFF)
opt[9] = 0   AI Watermarks            (OFF)
opt[10] = 0  Smart non-breaking spaces (OFF)
```

### Post-pass (always after option dispatch)

```js
text = text.replace(/ \n/g, '\n');
text = text.replace(/\t\n/g, '\n');
text = text.replace(/\n\n/g, '\n');
text = text.replace(/  /g, ' ');
// Each call loops until idempotent in prettyhtml.com's `helyettesit`.
```

### Option 1 — Inline styles

```js
for (const attr of ['style', 'valign', 'align']) {
  helyettesit(`${attr} = `, `${attr}=`);
  helyettesit(`${attr}= `, `${attr}=`);
  helyettesit(`${attr} =`, `${attr}=`);
  torolTagbanKettoKozt(`${attr}="`, '"');  // delete between markers INSIDE tags
  helyettesit(`${attr}=""`, '');
}
```

### Option 2 — Classes & IDs

Same as option 1 but for ` class=` and ` id=` (note leading space — scoped to attribute boundary).

### Option 3 — Empty tags

```js
helyettesit("> <", "><");
helyettesit("> \n", ">\n");
uresTagotTorul();         // remove <X></X>
csakEnteresTagotTorul();  // remove <X>\n</X>
```

### Option 4 — Tags with 1 space

```js
helyettesit("> &nbsp;<", ">&nbsp;<");
helyettesit(">&nbsp; <", ">&nbsp;<");
csakEgyNbspTagotTorul();  // remove <X>&nbsp;</X>
```

### Option 5 — Successive spaces

```js
helyettesit("&nbsp;&nbsp;", " ");
helyettesit("&nbsp; ", " ");
helyettesit(" &nbsp;", " ");
```

### Option 6 — Comments

```js
torolTagbanKettoKozt("<!--", "-->");
helyettesit("<!---->", "");
```

### Option 7 — Tag attributes (verbatim state machine)

See Task 6 Step 4 for the full implementation. States 1-8 handle anchors with href/download allowlist; states 14-18 handle img with src allowlist; states 2-3 strip everything from generic tags.

### Option 8 — To plain text

```js
helyettesit("<!--", "&%&%&%&%&%!--");   // escape comments
torolTagbanKettoKozt("<", ">");           // strip everything in <...>
helyettesit("<>", " ");                   // collapse orphan brackets
helyettesit("&%&%&%&%&%!--", "<!--");   // restore comments
```

### Option 9 — AI Watermarks (verbatim list, executes in this order)

```js
function aiWatermarkFixer() {
  // Phase 1 — entities
  helyettesit(/&ndash;/g,  ' - ');
  helyettesit(/&mdash;/g,  ' - ');
  helyettesit(/&ldquo;/g,  '"');
  helyettesit(/&rdquo;/g,  '"');
  helyettesit(/&lsquo;/g,  "'");
  helyettesit(/&rsquo;/g,  "'");
  helyettesit(/&hellip;/g, '...');
  helyettesit(/&nbsp;/g,   ' ');
  helyettesit(/&#160;/g,   ' ');

  // Phase 2 — invisible/zero-width entities and codepoints
  helyettesit(/&zwj;/g, '');     helyettesit(/&zwnj;/g, '');    helyettesit(/&shy;/g, '');
  helyettesit(/&#8203;/g, '');   helyettesit(/&#8204;/g, '');   helyettesit(/&#8205;/g, '');
  helyettesit(/&#8288;/g, '');   helyettesit(/&#65279;/g, '');
  helyettesit(/​/g, '');    helyettesit(/‌/g, '');    helyettesit(/‍/g, '');
  helyettesit(/⁠/g, '');    helyettesit(/﻿/g, '');    helyettesit(/­/g, '');

  // Phase 3 — UTF-8/Latin-1 mojibake (literal byte sequences in source)
  helyettesit(/[â€œâ€â€žÂ«Â»]/g,       '"');
  helyettesit(/[â€˜â€™â€šâ€¹â€º]/g,    "'");
  helyettesit(/â€"/g,                  '-');    // en-dash mojibake
  helyettesit(/â€"/g,                  '--');   // em-dash mojibake
  helyettesit(/â€¦/g,                  '...');
  helyettesit(/â¸º/g,                  '--');
  helyettesit(/â¸»/g,                  '---');
  helyettesit(/(\w)[â€"â¸ºâ¸»]+(\w)/g, '$1 $2');

  // Phase 4 — real NBSP last
  helyettesit(/ /g, ' ');
}
```

### Option 10 — Smart non-breaking spaces

```js
function smartNbsps(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  function walk(el) {
    el.childNodes.forEach(child => {
      if (child.nodeType === 3 /* TEXT */) {
        const tokens = child.nodeValue.split(/(\s+)/);
        let lastIdx = tokens.length - 1;
        while (lastIdx >= 0 && tokens[lastIdx].trim() === '') lastIdx--;
        if (lastIdx >= 0 && tokens[lastIdx].trim().length < 10) {
          for (let i = lastIdx - 1; i >= 0; i--) {
            if (tokens[i].trim() === '') { tokens[i] = ' '; break; }
          }
        }
        child.nodeValue = tokens.join('');
      } else if (child.nodeType === 1 /* ELEMENT */) {
        walk(child);
      }
    });
  }
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(walk);
  doc.querySelectorAll('p, div').forEach(walk);

  // Phase B — uses &nbsp; ENTITY (not the char):
  return doc.body.innerHTML.replace(
    /(\.|<p>)(\s*)(\w+)(\s+)/g,
    (m, prefix, ws1, word) => word.length < 7 ? `${prefix}${ws1}${word}&nbsp;` : m
  );
}
```

### Editor stack on prettyhtml.com (for completeness)

- **TinyMCE 4** (Modern theme) for visual editor. Two `entity_encoding` modes: `named` (default) and `raw`.
- **CodeMirror** for source view, mode `xml`, addons `xml-fold` + `matchtags` + `active-line`.
- **jQuery 1.10 + jQuery UI** for misc DOM glue.
- **mammoth.js** (lazy-loaded) for DOCX import.

### Default sample content

```html
<h3><em>This is&nbsp;a <span style="background-color: #40ac81; color: #ffffff; padding: 0 3px;">sample&nbsp;text</span> you can play&nbsp;with!<br /></em></h3>
<p>&nbsp;</p>
<p class="aligncenter"><a href="https://prettyhtml.com/"><img style="width: 200px; vertical-align: middle;" src="https://prettyhtml.com/img/pretty-html.png" alt="HTML Tidy" /></a><strong><br />&ldquo;Pretty HTML&rdquo; &mdash;&nbsp;instant HTML Formatter, Editor and&nbsp;Cleaner</strong></p>
```
