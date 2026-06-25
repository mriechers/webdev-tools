# Design: Stray line-break normalization

**Date:** 2026-06-24
**Status:** Approved (brainstorm), pending implementation plan
**Related:** [`planning/2026-05-27-prettyhtml-parity.md`](./2026-05-27-prettyhtml-parity.md)

## Problem

Pasting from Google Docs (and similar sources) produces bare `<br>` tags wedged
between block elements, e.g.:

```html
<p dir="ltr">Learn about adaptation…ahead.</p><br>
<p dir="ltr">Through discussion…future.</p><br>
```

A `<br>` floating between `</p>` and `<p>` is structurally meaningless residue.
Our formatter leaves it untouched, which surprised the user.

### Why prettyhtml.com handles it and we don't

prettyhtml.com's "tidy" is **two layers**:

1. A browser-DOM normalization pass — it round-trips content through its TinyMCE
   visual editor (`tinymce.get('vizualisEditor').getContent()`), which reparents
   loose inline nodes. A bare `<br>` between blocks becomes `<p>&nbsp;</p>`.
2. The string-based cleaning options (Inline styles, Empty tags, etc.).

Verified live on prettyhtml.com (2026-06-24): feeding our input through their
TinyMCE `getContent()` yields

```html
<p dir="ltr">…ahead.</p>
<p>&nbsp;</p>
<p dir="ltr">…future.</p>
<p>&nbsp;</p>
```

Their default "Tags with one space" cleaner then deletes the `<p>&nbsp;</p>`
spacers, leaving two clean paragraphs.

Our `app.mjs` is a faithful literal port of **layer 2 only** — a pure string
tokenizer with no DOM-normalization step. The `<br>` sails straight through.
This is a missing layer, not a bug in the existing cleaners (which match
prettyhtml.com byte-for-byte where they overlap).

## Goal

Replicate layer 1's observable result for realistic paste input, while staying
inside the pure-tokenizer architecture (no DOM round-trip).

## Approach

**Token-level normalization** (chosen over a true `DOMParser` round-trip).

A `DOMParser` round-trip would be maximally faithful on exotic nesting but
re-serializes the *entire* document (re-encoding entities, re-quoting
attributes, reflowing whitespace), risking regressions across the existing 59
tests, and Node's `linkedom` shim can serialize differently than a browser's
`DOMParser` — a test-vs-production gap. The token-level pass is scoped to exactly
the stray-`<br>` cases, has zero blast radius on unrelated markup, and fits the
existing test harness. It produces identical output to the round-trip on all
realistic paste input; the only difference is fidelity on pathological nesting
that paste sources don't actually emit.

## Behavior rules

Classify every `<br>` (covering `<br>`, `<br/>`, `<br />`) by **block context**:

| Case | Example | Action |
|---|---|---|
| **1. Loose `<br>` between/around blocks** (not inside any block) | `</p><br><p>`, leading `<br><p>`, trailing `</p><br>` | rewrite the run to `<p>&nbsp;</p>` |
| **2. `<br>`-only block** (entire content is `<br>`/whitespace/`&nbsp;`) | `<p><br></p>`, `<p><br /><br /></p>` | collapse to `<p>&nbsp;</p>` |
| **3. `<br>` inside a block *with* real text** | `line one<br>line two`, `foo<br><br>bar` | **keep untouched** |

Cases 1 & 2 both yield `<p>&nbsp;</p>`, consumed by the existing default-ON
"Tags with one space" cleaner. Net effect on default settings: stray breaks
vanish; the Google-Docs input collapses to two clean paragraphs.

**Case 3 is the safety guarantee.** Classification keys off the *block's* text
content, not the `<br>`'s immediate neighbors — so deliberate `foo<br><br>bar`
double-breaks are preserved. A naive "remove `<br>` not touching text on both
sides" rule would wrongly eat in-text doubles; we must not use it.

## UI / integration

- **Group:** Extras (beyond the 10 prettyhtml.com options, alongside data-attrs
  and span-unwrap).
- **Label:** "Strip stray line breaks"
- **Tooltip:** "Removes `<br>` between or around block elements and inside
  otherwise-empty blocks; keeps line breaks inside text."
- **Option key:** checkbox `opt-stray-breaks` → `stripStrayBreaks` in the options
  object, persisted in the existing `htmlTidy_options` localStorage bundle.
- **Default:** **ON**. The tool's purpose is cleaning pasted content; Case 3
  protects real breaks. (Note: this changes the default tidy output — stray
  breaks now disappear by default.)
- **Pipeline ordering:** the normalization pass must run *before* the "Tags with
  one space" cleaner so its `<p>&nbsp;</p>` output is consumed. Exact insertion
  point in `tidy()` to be confirmed during implementation.

## Block elements

Normalization needs a set of block-level element names to decide "inside a
block" vs "loose at body level." Reuse or extend the formatter's existing
block-element list if one exists; otherwise define a focused set covering the
common paste targets (`p`, `div`, `h1`–`h6`, `li`, `ul`, `ol`, `blockquote`,
`section`, `article`, `td`, `th`, `tr`, `table`). To be finalized in the plan.

## Testing

- **New pure function:** `normalizeStrayBreaks(html)`, exported from `app.mjs`
  (same pattern as `removeAllTagAttributes`, `smartNbsps`).
- **New test file:** `formatter/tests/stray-breaks.test.mjs`, run via `npm test`.
- **TDD:** written test-first (red → green).
- **Coverage matrix:**
  - Case 1: `</p><br><p>`; leading `<br><p>`; trailing `</p><br>`; consecutive
    `</p><br><br><p>`
  - Case 2: `<p><br></p>`, `<p><br /><br /></p>`, `<p>&nbsp;<br></p>`
  - Case 3 (must-not-touch): `<p>line one<br>line two</p>`,
    `<p>foo<br><br>bar</p>`, `<div>a<br>b</div>`
  - Variants: `<br>`, `<br/>`, `<br />` all handled
  - End-to-end: the exact Google-Docs input + default options → two clean
    paragraphs

## Out of scope

- Full TinyMCE/forced-root-block fidelity on malformed nesting.
- Wrapping loose *text* (non-`<br>`) at body level into paragraphs. (Possible
  future extension; not requested.)
- Any change to the existing 10 prettyhtml.com cleaners.
