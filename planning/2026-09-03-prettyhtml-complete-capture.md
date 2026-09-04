# prettyhtml.com — Complete Algorithm Capture (clean-room)

**Date:** 2026-09-03
**Supersedes:** the Algorithm Snapshot appendix in `2026-05-27-prettyhtml-parity.md` (which remains valid but incomplete — see [What the 2026-05-27 snapshot missed](#what-the-2026-05-27-snapshot-missed)).
**Status:** authoritative behavior spec for `/formatter/`.

## Why this document exists

Mark depends on prettyhtml.com's core function — stripping pasted HTML down to bare tags — for daily publishing work. It is a one-person operation (Ruwix Services SRL; the Hungarian identifiers `helyettesit`, `uresTagotTorul`, `gondolkodobaesett` give it away). If it disappears, `/formatter/` has to be able to stand in for it. That requires knowing not just *what* it does but *exactly* how, including its bugs.

### Legal posture — read before touching the capture

The raw site files are copyrighted third-party code. They are kept **locally only**, in `planning/captures/`, which is gitignored (`.gitignore:29`). **They must never be committed to this public repo.** This document is the committed artifact: a behavior specification written from observation, in our own words and our own pseudocode. No verbatim source is reproduced here.

Local capture set (2026-09-03), for provenance:

| File | SHA-256 |
|---|---|
| `prettyhtml-index.html` | `f1b84885ead042faee4ceb049999fb618399e19a3fad4bae7e3d22c4200e781b` |
| `prettyhtml.js` | `1d6becb456303759fe0b9b4326b94510a90e7febaeaf043599e605459b0f8046` |
| `prettyhtml-split.js` | `ce62efe41bd56bb53c0bd5f5385262052742d1511910c264dd9eefa387d592cf` |
| `prettyhtml.css` | *(added to the capture set after the hashes above were taken)* |

`prettyhtml-split.js` is the same bytes as `prettyhtml.js`, reflowed one-statement-per-line for readability. Line numbers cited below refer to the split version.

### The kill-switch — never port this

The site ships an anti-rehosting trap. A function (`elkur`, line 117) checks whether `document.domain` contains the substring `"tyht"`; if it does not, it replaces the working text with a single space and blanks both editors. It is called at the end of every conversion, and the same guard appears in the editor-sync helpers (`updateRight`, `updateLeft`, line 25/27).

Two consequences:

1. **Never port this behavior**, in any form, for any reason.
2. It is domain-gated, so driving their functions *on their own live page* works normally. That is the supported technique for the parity harness — see the `verify-formatter-parity-via-prettyhtml` memory note.

---

## Architecture: two layers

The thing users call "Pretty" is `convertText()` (line 115). It runs on top of a DOM normalization layer, and conflating the two is the single most common source of parity confusion.

**Layer 1 — TinyMCE round-trip.** The pipeline's first act is to read content out of a TinyMCE 4 instance (`tinymce.get("vizualisEditor").getContent()`). TinyMCE has already parsed and re-serialized the markup against its stock schema — no `valid_elements` restriction — with `entity_encoding:"named"` (a UI toggle can switch it to `"raw"`), `convert_urls:false`, and the paste plugin active. This layer silently repairs malformed nesting, wraps loose body-level text in `<p>`, and normalizes stray `<br>`s (a bare `<br>` between `</p>` and `<p>` becomes `<p>&nbsp;</p>`).

Our port is a pure tokenizer with **no DOM round-trip**, deliberately. `normalizeStrayBreaks` (the default-ON `opt-stray-breaks` Extra) is a partial stand-in covering the `<br>` residue case. **When our output diverges from theirs, suspect this layer first.**

**Layer 2 — the string cleaners.** Everything below. These operate on a module-global `text` variable rather than taking and returning arguments, which is why the live-driving technique is `window.text = input; theFunction(); /* read window.text */`.

---

## The primitives

### `helyettesit(from, to)` — replace-until-idempotent

The workhorse. Repeatedly applies a **string-pattern** replace (which in JS replaces only the *first* occurrence) until an application produces no change; returns the number of replacements performed.

```
count = 0
loop forever:
    next = text.replace(from, to)      # first occurrence only
    if next == text: break
    text = next; count += 1
return count
```

Two properties that matter and are easy to get wrong:

- It is **replace-all**, achieved by iteration, not by a global regex.
- It is **fixpoint-seeking**, so `helyettesit("  ", " ")` collapses a run of *any* length down to one space, and the count it returns is what the caller uses to decide whether to keep looping.

### `torolTagbanKettoKozt(startMarker, endMarker)` — delete between markers, inside tags only

A character machine that deletes everything between two markers while **keeping both markers**. Returns a match count.

The important subtlety: the *start* marker is only recognized while the scanner is **inside a tag** — it tracks a flag set on `<` and cleared on `>`, and only attempts a start-match when that flag is set. The *end* marker is matched unconditionally. This is what makes `torolTagbanKettoKozt('style="', '"')` an attribute-value eraser rather than a document-wide one.

It is also why the attribute cleaners are **straight-double-quote-only** surgery: the literal marker is `style="`. A single-quoted or curly-quoted attribute is never matched at all.

### The three empty-tag machines

`uresTagotTorul`, `csakEnteresTagotTorul`, and `csakEgyNbspTagotTorul` (lines 61, 63, 65) are the **same character machine** three times over, differing only in a lookahead predicate. Each makes **one linear pass** and blanks out the span from an opening tag's `<` through the following closing tag's `>`:

```
state = LOOKING
for each index a in text:
    if state == LOOKING and text[a] == '<' and text[a+1] != '/':
        state = IN_OPEN_TAG; start = a
    if state == ARMED and text[a] == '>':
        blank output positions start..a ; blank current ; state = LOOKING
    if state == IN_OPEN_TAG and text[a] == '>':
        state = ARMED if (not self-closing) and (PREDICATE holds at a+1) else LOOKING
    copy text[a] to output
```

"Not self-closing" is tested by checking that neither of the two characters before `>` is `/`. The per-machine predicate is:

| Machine | Predicate at `a+1` | Removes |
|---|---|---|
| `uresTagotTorul` | `<` `/` | `<x></x>` |
| `csakEnteresTagotTorul` | `\n` `<` `/` | `<x>\n</x>` |
| `csakEgyNbspTagotTorul` | `&` `n` `b` `s` `p` `;` `<` `/` | `<x>&nbsp;</x>` |

Three consequences, each of which genuinely changes output:

1. **Tag names are never compared.** `<b></i>` is deleted. So is `<div></span>`.
2. **The `&nbsp;` predicate is a literal character sequence.** The numeric form `&#160;` is *not* matched.
3. **Each machine is a single pass, and each is called exactly once.** They do not cascade. See the next section.

---

## Pipeline order (`convertText`, line 115)

> **Re-verified live 2026-09-04** by reading `String(convertText)` in the page and
> executing each option's replacement sequence against `window.text`. Every claim
> in this section was confirmed against the running site, not inferred from the
> minified bundle. The measured probes are recorded in
> `formatter/tests/fixtures/prettyhtml-golden.json`.

The function body is a `for` loop whose *initializer* holds the entire option dispatch and whose *condition* holds the post-pass. That is an unusual shape and it encodes the control flow precisely:

- **initializer → runs exactly once**: script/style removal and all option handling
- **condition → runs repeatedly until it evaluates false**: the whitespace post-pass, looping while any replacement fired
- body and update: empty

Full order:

1. **Read from TinyMCE** (layer 1). Stash it as the undo buffer.
2. **Pre-pass**, unconditional, in this order:
   `\t`→`` · `"  "`→`" "` · `" \n"`→`\n` · `"\t\n"`→`\n` · `"\n\n"`→`\n` · `"  "`→`" "`
3. **Script/style removal**, unconditional (not an option): delete between `<script`/`</script>` and between `<style`/`</style>`, then sweep the residue `<style</style>` and `<script</script>` to empty. Fires a UI popup naming whichever was removed.
4. **Option dispatch — once, in this order** (note it is *not* the numeric order of the checkboxes):

   | Order | Option | Behavior |
   |---|---|---|
   | 1st | **8 — To plain text** | Protect comments by swapping `<!--` for a sentinel; delete between `<` and `>`; turn the resulting `<>` into a single space; restore the sentinel. |
   | 2nd | **1 — Inline styles** | Normalize `style = `/`style= `/`style =` to `style=`, erase between `style="` and `"`, drop leftover `style=""`. Repeat identically for `valign` and `align`. |
   | 3rd | **5 — Successive spaces** | `&nbsp;&nbsp;`→`" "` · `&nbsp; `→`" "` · ` &nbsp;`→`" "` |
   | 4th | **2 — Classes & IDs** | Same shape as option 1, for ` class=` and ` id=` — note the **leading space** in every marker. |
   | 5th | **6 — Comments** | Erase between `<!--` and `-->`, then drop the resulting `<!---->`. |
   | 6th | **4 — Tags with 1 space** | `> &nbsp;<`→`>&nbsp;<` · `>&nbsp; <`→`>&nbsp;<` · then `csakEgyNbspTagotTorul`. |
   | 7th | **3 — Empty tags** | `> <`→`><` · `> \n`→`>\n` · then `uresTagotTorul` · then `csakEnteresTagotTorul`. |

5. **Post-pass loop** — repeats while any replacement fired:
   `"  "`→`" "` · `" >"`→`">"` · `\t`→`` · `"  "`→`" "` · `&nbsp;\n`→`\n` · `" \n"`→`\n` · `"\n\n"`→`\n` · and, when the Compress flag (opt 14) is set, `\n`→``
6. **Option 7 — Tag attributes** (`removeTagAttributes`), then **option 9 — AI Watermarks** (`aiWatermarkFixer`), then **option 10 — Smart &nbsp;s** (`smartNbsps`).
7. **Final cleanup**, unconditional: `" \n"`→`\n` · `"\t\n"`→`\n` · `"\n\n"`→`\n` · `"  "`→`" "`
8. Kill-switch check, then write back to both editors.

### Option 5 is about `&nbsp;`, not whitespace

Worth calling out separately because the label invites the wrong assumption. "Successive spaces" touches **only** non-breaking-space entities. Literal whitespace runs are collapsed by the unconditional pre-pass and post-pass, which run whether or not option 5 is checked.

Our option 5 used to do the opposite — collapse `\s+`, never touch `&nbsp;`. Fixed
2026-09-04: option 5 is now nbsp-only (accepting `&#160;` as well, divergence H),
and literal whitespace collapse moved to the unconditional pre/post-passes where
it belongs.

Measured, option 5 in isolation:

| Input | Their output |
|---|---|
| `a&nbsp;b` | `a&nbsp;b` — a lone entity is left alone |
| `a&nbsp;&nbsp;b` | `a b` |
| `a &nbsp;b` | `a b` |
| `a     b` | `a     b` — literal runs untouched |

### Nothing cascades in layer 2 — but layer 1 hides it

The option dispatch runs **once**. The only loop is the whitespace post-pass, and it contains no tag-level cleaner.

Confirmed live against their own page: driving `uresTagotTorul` directly on `<div><p></p></div>` returns `<div></div>`. The inner empty tag goes; the outer one — which only *became* empty as a result — does not, because the single pass had already moved past its `>` before the inner pair was deleted. Calling the machine a second time returns `""`, which proves the cascade is a real behavior change and not a no-op. Nesting one level deeper behaves the same way: `<section><div><p></p></div></section>` → `<section><div></div></section>`.

**But the end-to-end pipeline still emits `""` for that input**, by a completely different route. TinyMCE normalizes `<div><p></p></div>` to `<div>&nbsp;</div>` before layer 2 ever sees it, and option 4 (Tags with 1 space) then removes it as a one-space tag. The empty-tag machine is never what solves this case on the live site.

This is the single most important lesson in this document, and it generalizes well past divergence B:

> **Much of what looks like cleaner behavior is actually TinyMCE behavior.** Reasoning about their string cleaners in isolation will give you the wrong answer about what the site does. Always check the pipeline-level result too.

So for our pure-tokenizer port, cascading empty-tag removal is best understood the way `normalizeStrayBreaks` already is: **a layer-1 compensation**, not a departure. It reaches the same end-to-end output by the only route available to us. It still belongs in a default-ON Extras option (`opt-nested-empties`) rather than inside the byte-faithful option-3 path, because option 3 alone must keep matching `uresTagotTorul` alone — that is what the parity fixtures pin. See divergence B in the tracking table.

### Layer 1 line structure — the difference you actually see

The single largest visible gap between their output and a pure layer-2 port is not
any cleaner. It is that **TinyMCE hands back block-level elements one per line**,
with no indentation. Their Tidy output arrives line-delimited; ours arrived as one
long line. Measured live 2026-09-04:

| Input | After layer 1 |
|---|---|
| `<p>a</p><p>b</p>` | `<p>a</p>\n<p>b</p>` |
| `<div><p>x</p></div>` | `<div>\n<p>x</p>\n</div>` |
| `<p>a <b>bold</b> c</p>` | `<p>a <strong>bold</strong> c</p>` — inline stays put |
| `<ul><li>a</li><li>b</li></ul>` | `<ul>\n<li>a</li>\n<li>b</li>\n</ul>` |
| `<pre>  keep\n   me</pre>` | unchanged — `<pre>` content is preserved |

The rule: a block element's open tag starts a line, its close tag starts a line only
when the block has block children, and inline content stays on its parent's line.
`separateBlockElements()` in `app.mjs` reproduces this (default-ON Extra
`opt-block-newlines`). Note it runs **after** our cleaners, not before as theirs
does — emitting the newlines first would feed the empty-tag machine `<div>\n</div>`
instead of the `<div></div>` it needs to match.

This is also why option 3 carries a `> \n`→`>\n` normalization and a newline-only-tag
machine at all: on their site, layer 1 has already put newlines everywhere by the
time option 3 runs.

TinyMCE does several other things at layer 1 that are **editor semantics, not
cleanup**, and are deliberately not replicated (divergence K): `<b>`→`<strong>`,
implied `<tbody>` insertion, wrapping loose text and inline content in `<p>`,
`alt=""` injection on images, and entity-encoding real smart punctuation
(`entity_encoding:"named"`, so `’` comes back as `&rsquo;`). It also drops a `<br>`
sitting immediately before a block's closing tag — that one *is* cleanup, and
`normalizeStrayBreaks` now does it too.

### Prettify and Compress

Prettify is a two-stage indenter (`bekezdeseketRendez` / `bekezdeseketRendezSECOND`) built on newlines and tabs, with a hardcoded void-element prefix list. It carries known bugs, including a reference to an undefined variable. Our two-stage `indent()` is conceptually the same shape and is *not* a literal port.

Compress rides the same `convertText` pipeline via the opt-14 flag in the post-pass loop (`\n`→``), alongside a comment strip.

---

## What the 2026-05-27 snapshot missed

The earlier Algorithm Snapshot is accurate on the individual literal-port cleaners (options 7, 9, 10) — those transcriptions still stand. It omitted the surrounding machinery:

- the unconditional **pre-pass** and **final cleanup** replacement sets
- the **post-pass loop** and its repeat-until-stable structure
- the unconditional **script/style removal** (it is not an option)
- the **option dispatch order**, in particular that plain-text runs *first*
- the **Prettify/Compress** implementations (no capture existed)
- `U+009D` in the AI-watermark opening-quote character class
- the empty-tag machines' **tag names are never compared** quirk
- that the empty-tag machines are **single-pass and non-cascading**

---

## Divergence tracking

Full inventory and fix decisions live in the execution plan. Summary of classification
and, as of 2026-09-04, implementation status:

| ID | Divergence | Disposition |
|---|---|---|
| A | Always-on pre/post-pass missing from `app.mjs` | Fix — parity |
| B | Empty-tag removal doesn't cascade | **Reclassified.** Their machine doesn't cascade either; their *layer 1* covers the case instead. Layer-1 compensation → default-ON Extras `opt-nested-empties` |
| C | Option 5 semantics inverted (see above) | Fix — parity |
| D | `toPlainText` deletes tags; theirs substitutes a space | Fix — parity (update tests) |
| E | Options 1/2 structural vs their double-quote-only surgery | Keep ours — deliberate improvement |
| F | Option 3/4 boundary misassigned; `> <` / `> \n` joins missing | Fix — parity |
| G | Our `canRemove` exempts `td`/`th`/`script`/…; theirs removes blindly | Keep ours — deliberate improvement |
| H | `&#160;` handled by stray-breaks but not option 4 | Fix — improvement (theirs is named-entity-only) |
| I | `opt-newline-before-close` is dead code | Remove |
| J | No Prettify/Compress reference existed | Documented above |
| K | Layer 1 only covers stray `<br>`s | Partly closed. Block-per-line structure is now reproduced (`opt-block-newlines`), as is the trailing-`<br>` drop. Still not replicated: `<b>`→`<strong>`, implied `<tbody>`, loose-text wrapping, `alt=""`, entity encoding — all editor semantics |
| L | `smartNbsps` Node-vs-browser serialization gap | Documented; acknowledged |
| M | Stale `app.js` references in docs | Fix docs |
| N | Curly-quoted attributes corrupt the tokenizer | Fix — improvement (theirs corrupts too) |
| O | **New, 2026-09-04.** Block elements not put on their own lines — the biggest visible gap, and pure layer 1 | Layer-1 compensation → default-ON Extras `opt-block-newlines` |

All of A–O are now implemented or consciously deferred. Verification: `npm test`
(128 tests) plus `formatter/tests/parity.test.mjs`, which replays the golden
fixtures through `runTidyPipeline`. Three fixtures carry an `ours` field recording
where we deliberately differ — the curly-quote handling (N), literal characters
instead of named entities (layer 1), and the Google Docs `dir="ltr"` / `<span>`
strip (issue #22).

### On N, specifically

Google Docs autocorrects straight quotes to curly. HTML source that has passed through a Doc arrives carrying `U+201C`/`U+201D`/`U+2018`/`U+2019`. Neither implementation survives it:

- **Theirs**: TinyMCE's parser only accepts straight quotes as attribute delimiters, so `class=“hero lede”` parses as an unquoted value terminating at the space; and every string cleaner keys on a literal straight-double-quote marker, so such an attribute is never matched for removal either.
- **Ours** (before the fix): `parseAttributes` fell through to its bare-value branch, yielding `class` = `“hero` plus an invented bare attribute named `lede”`, which then got rebuilt into the output.

Since both corrupt this input, parity is the wrong target and the fix is an
unconditional tokenizer-level improvement. Real smart punctuation in *prose* is
correct typography and is left alone by default — only attribute delimiters are
normalized. (The `opt-straighten-quotes` Extra, default OFF, converts prose
punctuation to ASCII for anyone who wants that; it is kept out of option 9 itself
so the ten stay byte-faithful.)

One measured detail worth keeping: their *end-to-end* output on
`<p class=“hero lede”>Hi</p>` is a clean `<p>Hi</p>`, because TinyMCE mangles the
class and option 2 then deletes the mangled result. Ours now reaches the same
output by the honest route — parsing the attribute correctly, then removing it.
On `<p class=“a > b”>Hi</p>` theirs truncates the tag and leaks `b&rdquo;&gt;` into
the text; ours returns `<p>Hi</p>`.
