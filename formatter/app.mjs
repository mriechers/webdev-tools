/*
 * HTML Formatter & Tidy — Application Logic
 * ==========================================
 * A pure client-side HTML formatter, beautifier, and tidier.
 * No dependencies — works entirely in the browser.
 *
 * Architecture:
 * 1. Tokenizer: breaks raw HTML into tokens (tags, text, comments, doctype)
 * 2. Indent: whitespace-only restructuring (two stages)
 * 3. Tidy: cleaning operations without changing whitespace
 * 4. Compress: strips all unnecessary whitespace
 * 5. UI layer: wires DOM elements, bidirectional editors, syntax highlighting
 */

// ============================================================
// HTML TOKENIZER
// Breaks raw HTML string into an array of typed tokens.
// ============================================================

const TokenType = {
  DOCTYPE: 'doctype',
  OPEN_TAG: 'open_tag',
  CLOSE_TAG: 'close_tag',
  SELF_CLOSING_TAG: 'self_closing_tag',
  COMMENT: 'comment',
  CDATA: 'cdata',
  TEXT: 'text',
};

/**
 * Void elements — these never have closing tags in HTML.
 * https://html.spec.whatwg.org/multipage/syntax.html#void-elements
 */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Raw text elements — their content should not be re-formatted.
 * We preserve everything between opening and closing tags verbatim.
 */
const RAW_TEXT_ELEMENTS = new Set([
  'script', 'style', 'textarea', 'pre', 'code',
]);

/**
 * Inline elements — should not get extra newlines around them
 * when they appear inside text flow.
 */
const INLINE_ELEMENTS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data',
  'dfn', 'em', 'i', 'kbd', 'mark', 'q', 'rp', 'rt', 'ruby',
  's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time',
  'u', 'var', 'wbr', 'img', 'input', 'label', 'select', 'button',
]);

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

/**
 * Curly quotes accepted as attribute delimiters.
 *
 * Word processors (Google Docs especially) autocorrect straight quotes to curly
 * ones even when the text is HTML *source*, so pasted markup routinely arrives as
 * `class=“hero lede”`. Treating those as delimiters is a robustness fix, not a
 * parity concern: prettyhtml.com's TinyMCE mis-parses the same input (it reads the
 * value as unquoted and truncates at the first space) and only looks clean because
 * its classes/IDs option then deletes the wreckage. Ours has no such backstop, so
 * without this the invented attribute survives into the output.
 *
 * Each opener maps to the set of characters that may close it — a pair is accepted
 * in either orientation, since autocorrect sometimes emits two openers or two
 * closers when it guesses the word boundary wrong.
 */
const QUOTE_CLOSERS = {
  '"': '"',
  "'": "'",
  '\u201C': '\u201D\u201C',
  '\u201D': '\u201D\u201C',
  '\u2018': '\u2019\u2018',
  '\u2019': '\u2019\u2018',
};

/**
 * Parse an HTML attribute string into an array of {name, value, quote} objects.
 */
export function parseAttributes(attrString) {
  const attrs = [];
  if (!attrString || !attrString.trim()) return attrs;

  // Regex matches: name="value", name='value', name=“value”, name=‘value’,
  // name=value, or bare name. Curly-delimited values are normalized to straight
  // quotes here so every downstream rebuild path emits valid HTML.
  const re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|[\u201C\u201D]([^\u201C\u201D]*)[\u201C\u201D]|[\u2018\u2019]([^\u2018\u2019]*)[\u2018\u2019]|(\S+)))?/g;
  let match;
  while ((match = re.exec(attrString)) !== null) {
    const name = match[1];
    const value = match[2] !== undefined ? match[2]
                : match[3] !== undefined ? match[3]
                : match[4] !== undefined ? match[4]
                : match[5] !== undefined ? match[5]
                : match[6] !== undefined ? match[6]
                : null;
    const quote = match[2] !== undefined ? '"'
               : match[3] !== undefined ? "'"
               : match[4] !== undefined ? '"'
               : match[5] !== undefined ? "'"
               : match[6] !== undefined ? ''
               : null;
    attrs.push({ name, value, quote });
  }
  return attrs;
}

/**
 * Tokenize an HTML string into an array of tokens.
 * Each token has: { type, raw, tagName?, attributes?, content? }
 */
export function tokenize(html) {
  const tokens = [];
  let pos = 0;
  const len = html.length;

  while (pos < len) {
    if (html[pos] === '<') {
      // Comment
      if (html.substring(pos, pos + 4) === '<!--') {
        const end = html.indexOf('-->', pos + 4);
        if (end === -1) {
          tokens.push({ type: TokenType.COMMENT, raw: html.substring(pos), content: html.substring(pos + 4) });
          pos = len;
        } else {
          const raw = html.substring(pos, end + 3);
          tokens.push({ type: TokenType.COMMENT, raw, content: html.substring(pos + 4, end) });
          pos = end + 3;
        }
        continue;
      }

      // CDATA
      if (html.substring(pos, pos + 9) === '<![CDATA[') {
        const end = html.indexOf(']]>', pos + 9);
        if (end === -1) {
          tokens.push({ type: TokenType.CDATA, raw: html.substring(pos), content: html.substring(pos + 9) });
          pos = len;
        } else {
          const raw = html.substring(pos, end + 3);
          tokens.push({ type: TokenType.CDATA, raw, content: html.substring(pos + 9, end) });
          pos = end + 3;
        }
        continue;
      }

      // Doctype
      if (html.substring(pos, pos + 9).toLowerCase() === '<!doctype') {
        const end = html.indexOf('>', pos);
        if (end === -1) {
          tokens.push({ type: TokenType.DOCTYPE, raw: html.substring(pos) });
          pos = len;
        } else {
          tokens.push({ type: TokenType.DOCTYPE, raw: html.substring(pos, end + 1) });
          pos = end + 1;
        }
        continue;
      }

      // Closing tag
      if (html[pos + 1] === '/') {
        const end = html.indexOf('>', pos);
        if (end === -1) {
          // Malformed — treat as text
          tokens.push({ type: TokenType.TEXT, raw: html.substring(pos), content: html.substring(pos) });
          pos = len;
        } else {
          const raw = html.substring(pos, end + 1);
          const tagName = raw.substring(2, raw.length - 1).trim();
          tokens.push({ type: TokenType.CLOSE_TAG, raw, tagName });
          pos = end + 1;
        }
        continue;
      }

      // Opening tag (or self-closing)
      const tagEnd = findTagEnd(html, pos);
      if (tagEnd === -1) {
        tokens.push({ type: TokenType.TEXT, raw: html.substring(pos), content: html.substring(pos) });
        pos = len;
      } else {
        const raw = html.substring(pos, tagEnd + 1);
        const selfClosing = raw.endsWith('/>');
        // Extract tag name and attributes
        const inner = selfClosing ? raw.slice(1, -2) : raw.slice(1, -1);
        const spaceIdx = inner.search(/[\s/]/);
        const tagName = spaceIdx === -1 ? inner : inner.substring(0, spaceIdx);
        const attrString = spaceIdx === -1 ? '' : inner.substring(spaceIdx).replace(/\/\s*$/, '').trim();

        const lowerTagName = tagName.toLowerCase();
        const isVoid = VOID_ELEMENTS.has(lowerTagName);
        const type = (selfClosing || isVoid) ? TokenType.SELF_CLOSING_TAG : TokenType.OPEN_TAG;

        const token = {
          type,
          raw,
          tagName,
          attributes: parseAttributes(attrString),
        };

        tokens.push(token);
        pos = tagEnd + 1;

        // For raw text elements, consume everything until the closing tag
        if (type === TokenType.OPEN_TAG && RAW_TEXT_ELEMENTS.has(lowerTagName)) {
          const closePattern = new RegExp(`</${tagName}\\s*>`, 'i');
          const closeMatch = closePattern.exec(html.substring(pos));
          if (closeMatch) {
            const textContent = html.substring(pos, pos + closeMatch.index);
            if (textContent) {
              tokens.push({ type: TokenType.TEXT, raw: textContent, content: textContent, preserveWhitespace: true });
            }
            tokens.push({ type: TokenType.CLOSE_TAG, raw: closeMatch[0], tagName: closeMatch[0].slice(2, -1).trim() });
            pos = pos + closeMatch.index + closeMatch[0].length;
          }
        }
      }
    } else {
      // Text content — read until next '<'
      const next = html.indexOf('<', pos);
      const raw = next === -1 ? html.substring(pos) : html.substring(pos, next);
      if (raw) {
        tokens.push({ type: TokenType.TEXT, raw, content: raw });
      }
      pos = next === -1 ? len : next;
    }
  }

  return tokens;
}

/**
 * Find the end of an HTML tag starting at pos, handling quoted attributes.
 */
function findTagEnd(html, pos) {
  let i = pos + 1;
  const len = html.length;
  while (i < len) {
    const ch = html[i];
    const closers = QUOTE_CLOSERS[ch];
    if (closers) {
      // Skip a quoted attribute value so a '>' inside it doesn't truncate the tag.
      // Curly delimiters close on either member of their pair (see QUOTE_CLOSERS).
      let closeQuote = -1;
      for (let j = i + 1; j < len; j++) {
        if (closers.includes(html[j])) { closeQuote = j; break; }
      }
      if (closeQuote === -1) return -1;
      i = closeQuote + 1;
    } else if (ch === '>') {
      return i;
    } else {
      i++;
    }
  }
  return -1;
}


// ============================================================
// INDENT — Whitespace-only restructuring
// Does NOT modify attributes, tags, or content — only spacing.
// Stage 1: block elements on new lines, inline stays on current line
// Stage 2: ALL elements on their own indented lines
// ============================================================

/**
 * Append text to the last line instead of starting a new one.
 */
function appendToCurrentLine(lines, text) {
  if (lines.length === 0) {
    lines.push(text);
  } else {
    lines[lines.length - 1] += text;
  }
}

/**
 * Rebuild a tag from its token, preserving original attributes exactly.
 */
function rebuildTag(token) {
  const tagName = token.tagName;
  const attrs = (token.attributes || []).map(attr => {
    if (attr.value === null) return attr.name;
    const q = attr.quote || '"';
    return `${attr.name}=${q}${attr.value}${q}`;
  }).join(' ');
  const isVoid = VOID_ELEMENTS.has(tagName.toLowerCase());
  const isSelfClosing = token.type === TokenType.SELF_CLOSING_TAG;
  if (attrs) {
    if (isSelfClosing && !isVoid) return `<${tagName} ${attrs} />`;
    return `<${tagName} ${attrs}>`;
  }
  if (isSelfClosing && !isVoid) return `<${tagName} />`;
  return `<${tagName}>`;
}

/**
 * Indent tokenized HTML — whitespace restructuring only.
 * @param {string} html - Raw HTML string
 * @param {object} opts - { indentChar, indentSize, wrapLength }
 * @param {number} stage - 1 = block elements only, 2 = all elements
 * @returns {string} Indented HTML
 */
export function indent(html, opts, stage) {
  const tokens = tokenize(html);
  const lines = [];
  let indentLevel = 0;
  const indentStr = () => opts.indentChar.repeat(opts.indentSize * indentLevel);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lowerName = token.tagName ? token.tagName.toLowerCase() : '';
    const isInline = INLINE_ELEMENTS.has(lowerName);

    switch (token.type) {
      case TokenType.DOCTYPE: {
        lines.push(indentStr() + token.raw.trim());
        break;
      }

      case TokenType.COMMENT: {
        if (stage === 1 || stage === 2) {
          lines.push(indentStr() + token.raw.trim());
        } else {
          appendToCurrentLine(lines, token.raw);
        }
        break;
      }

      case TokenType.CDATA: {
        lines.push(indentStr() + token.raw);
        break;
      }

      case TokenType.OPEN_TAG: {
        const tagStr = rebuildTag(token);

        if (stage === 1 && isInline) {
          // Stage 1: inline elements stay on current line
          appendToCurrentLine(lines, tagStr);
        } else {
          // Stage 1 block elements, or Stage 2 all elements: own line
          lines.push(indentStr() + tagStr);
        }

        if (!RAW_TEXT_ELEMENTS.has(lowerName)) {
          indentLevel++;
        }
        break;
      }

      case TokenType.CLOSE_TAG: {
        const isVoid = VOID_ELEMENTS.has(lowerName);
        if (isVoid) break;

        if (!RAW_TEXT_ELEMENTS.has(lowerName)) {
          indentLevel = Math.max(0, indentLevel - 1);
        }

        const closeStr = `</${token.tagName}>`;

        if (stage === 1 && isInline) {
          appendToCurrentLine(lines, closeStr);
        } else {
          lines.push(indentStr() + closeStr);
        }
        break;
      }

      case TokenType.SELF_CLOSING_TAG: {
        const tagStr = rebuildTag(token);

        if (stage === 1 && isInline) {
          appendToCurrentLine(lines, tagStr);
        } else {
          lines.push(indentStr() + tagStr);
        }
        break;
      }

      case TokenType.TEXT: {
        if (token.preserveWhitespace) {
          lines.push(token.content);
          break;
        }

        // Strip leading/trailing whitespace to prevent compounding
        const text = token.content.replace(/\s+/g, ' ').trim();
        if (!text) break;

        if (stage === 1) {
          // In stage 1, text flows inline
          appendToCurrentLine(lines, text);
        } else {
          // In stage 2, text gets its own indented line
          lines.push(indentStr() + text);
        }
        break;
      }
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}


// ============================================================
// TIDY — Cleaning operations without changing whitespace structure
// Tag casing, attribute manipulation, empty tag removal, etc.
// ============================================================

/**
 * Common boolean HTML attributes that can stand alone without a value.
 */
function isBooleanAttr(name) {
  const booleans = new Set([
    'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked',
    'controls', 'default', 'defer', 'disabled', 'formnovalidate',
    'hidden', 'inert', 'ismap', 'itemscope', 'loop', 'multiple',
    'muted', 'nomodule', 'novalidate', 'open', 'playsinline',
    'readonly', 'required', 'reversed', 'selected',
  ]);
  return booleans.has(name.toLowerCase());
}

/**
 * Build a tidied tag string, applying cleaning options to attributes.
 */
function buildTidyTag(tagName, attrs, selfClose, opts) {
  const name = opts.lowercaseTags ? tagName.toLowerCase() : tagName;

  let processed = attrs.map(attr => {
    let attrName = opts.lowercaseAttrs ? attr.name.toLowerCase() : attr.name;
    let value = attr.value;
    let quote = attr.quote;

    const lowerAttrName = attrName.toLowerCase();
    if (opts.removeStyles && (lowerAttrName === 'style' || lowerAttrName === 'valign' || lowerAttrName === 'align')) return null;
    if (opts.removeClassesIds && (lowerAttrName === 'class' || lowerAttrName === 'id')) return null;
    if (opts.removeDataAttrs && lowerAttrName.startsWith('data-')) return null;
    // Google Docs residue. TinyMCE drops role/aria-level for prettyhtml.com at
    // layer 1; we have no layer 1, so the option covers them explicitly. dir="ltr"
    // survives on their site — stripping it is deliberately better than parity.
    if (opts.docsResidue) {
      if (lowerAttrName === 'role' && value === 'presentation') return null;
      if (lowerAttrName === 'aria-level') return null;
      if (lowerAttrName === 'dir' && (value || '').toLowerCase() === 'ltr') return null;
    }
    if (opts.removeEmptyAttrs && value === '' && !isBooleanAttr(attrName)) return null;

    if (opts.quoteAttrs && value !== null && quote !== '"' && quote !== "'") {
      quote = '"';
    }

    if (value === null) return attrName;

    const quoteChar = quote || '"';
    return `${attrName}=${quoteChar}${value}${quoteChar}`;
  }).filter(Boolean);

  if (opts.sortAttrs) processed.sort();

  const attrStr = processed.length > 0 ? ' ' + processed.join(' ') : '';
  const isVoid = VOID_ELEMENTS.has(tagName.toLowerCase());

  if (selfClose && opts.fixSelfClosing && isVoid) {
    return `<${name}${attrStr}>`;
  }

  if (selfClose) {
    return `<${name}${attrStr} />`;
  }

  return `<${name}${attrStr}>`;
}

/**
 * Tidy tokenized HTML — applies cleaning without changing whitespace.
 * Returns { output, fixCount, tagCount }.
 */
export function tidy(html, opts) {
  const tokens = tokenize(html);
  const parts = [];
  let fixCount = 0;
  let tagCount = 0;
  let unwrappedSpanDepth = 0;
  // One entry per open <b>: true if it was unwrapped as a Google Docs container.
  // A plain stack rather than a depth counter, so a real nested <b> keeps its
  // own closing tag instead of consuming the wrapper's.
  const boldStack = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token.type) {
      case TokenType.DOCTYPE: {
        let doctype = token.raw;
        if (opts.lowercaseTags) {
          doctype = doctype.replace(/<!DOCTYPE/i, '<!DOCTYPE');
        }
        parts.push(doctype);
        break;
      }

      case TokenType.COMMENT: {
        if (opts.removeComments) {
          fixCount++;
          break;
        }
        parts.push(token.raw);
        break;
      }

      case TokenType.CDATA: {
        parts.push(token.raw);
        break;
      }

      case TokenType.OPEN_TAG: {
        const lowerName = token.tagName.toLowerCase();
        tagCount++;

        const nextToken = tokens[i + 1];
        const canRemove = !VOID_ELEMENTS.has(lowerName) &&
            !['script', 'style', 'iframe', 'canvas', 'video', 'audio', 'td', 'th'].includes(lowerName);

        // Case 1: <tag></tag> — directly empty. prettyhtml option 3 (uresTagotTorul).
        if (canRemove && opts.removeEmptyTags && nextToken &&
            nextToken.type === TokenType.CLOSE_TAG &&
            nextToken.tagName.toLowerCase() === lowerName) {
          fixCount++;
          i++;
          break;
        }

        // Case 2: <tag>\n</tag> — a single newline. Also option 3, via
        // csakEnteresTagotTorul; it used to be lumped in with the one-space
        // option below, which put it behind the wrong checkbox (divergence F).
        // Whitespace runs have already been collapsed by the pre-pass, and a
        // space-only tag reaches Case 1 through option 3's "> <" join.
        if (canRemove && opts.removeEmptyTags && nextToken &&
            nextToken.type === TokenType.TEXT && nextToken.content === '\n') {
          const closeToken = tokens[i + 2];
          if (closeToken && closeToken.type === TokenType.CLOSE_TAG &&
              closeToken.tagName.toLowerCase() === lowerName) {
            fixCount++;
            i += 2;
            break;
          }
        }

        // Case 3: <tag>&nbsp;</tag> — option 4 (csakEgyNbspTagotTorul). Theirs
        // matches the named entity only; we accept the numeric spelling too
        // (divergence H, a deliberate improvement).
        if (canRemove && opts.removeOneSpaceTags && nextToken && nextToken.type === TokenType.TEXT &&
            NBSP_SPELLINGS.includes(nextToken.content)) {
          const closeToken = tokens[i + 2];
          if (closeToken && closeToken.type === TokenType.CLOSE_TAG &&
              closeToken.tagName.toLowerCase() === lowerName) {
            fixCount++;
            i += 2;
            break;
          }
        }

        // Google Docs wraps a whole paste in <b id="docs-internal-guid-…"> with
        // font-weight:normal. It is a transparent container, not bold — unwrap it.
        if (lowerName === 'b') {
          const idAttr = (token.attributes || []).find(a => a.name.toLowerCase() === 'id');
          const isDocsWrapper = Boolean(opts.docsResidue && idAttr && idAttr.value &&
            idAttr.value.startsWith('docs-internal-guid'));
          boldStack.push(isDocsWrapper);
          if (isDocsWrapper) {
            fixCount++;
            break;
          }
        }

        // Unwrap empty spans
        if (opts.unwrapSpans && lowerName === 'span') {
          const remainingAttrs = (token.attributes || []).filter(attr => {
            const an = (opts.lowercaseAttrs ? attr.name.toLowerCase() : attr.name).toLowerCase();
            if (opts.removeStyles && (an === 'style' || an === 'valign' || an === 'align')) return false;
            if (opts.removeClassesIds && (an === 'class' || an === 'id')) return false;
            if (opts.removeDataAttrs && an.startsWith('data-')) return false;
            if (opts.removeEmptyAttrs && attr.value === '' && !isBooleanAttr(an)) return false;
            return true;
          });
          if (remainingAttrs.length === 0) {
            fixCount++;
            unwrappedSpanDepth++;
            break;
          }
        }

        parts.push(buildTidyTag(token.tagName, token.attributes || [], false, opts));
        break;
      }

      case TokenType.CLOSE_TAG: {
        const lowerName = token.tagName.toLowerCase();
        const closeTagName = opts.lowercaseTags ? lowerName : token.tagName;

        if (VOID_ELEMENTS.has(lowerName)) {
          fixCount++;
          break;
        }

        if (lowerName === 'span' && unwrappedSpanDepth > 0) {
          unwrappedSpanDepth--;
          break;
        }

        if (lowerName === 'b' && boldStack.length > 0 && boldStack.pop()) {
          break;
        }

        parts.push(`</${closeTagName}>`);
        break;
      }

      case TokenType.SELF_CLOSING_TAG: {
        tagCount++;
        parts.push(buildTidyTag(token.tagName, token.attributes || [], true, opts));
        break;
      }

      case TokenType.TEXT: {
        // Pass through untouched. Whitespace normalization belongs to the
        // pipeline's pre/post-passes, not to any option (divergence C).
        parts.push(token.content);
        break;
      }
    }
  }

  // Join with empty string — preserves original whitespace between tokens
  const output = parts.join('');
  return { output, fixCount, tagCount };
}


// ============================================================
// COMPRESS — Strip all unnecessary whitespace (formerly minify)
// ============================================================

export function compress(html) {
  const tokens = tokenize(html);
  const parts = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token.type) {
      case TokenType.DOCTYPE:
        parts.push(token.raw.replace(/\s+/g, ' ').trim());
        break;
      case TokenType.COMMENT:
        // Strip comments in compressed output
        break;
      case TokenType.CDATA:
        parts.push(token.raw);
        break;
      case TokenType.OPEN_TAG:
      case TokenType.SELF_CLOSING_TAG: {
        const name = token.tagName.toLowerCase();
        const attrs = (token.attributes || [])
          .map(a => a.value === null ? a.name : `${a.name}="${a.value}"`)
          .join(' ');
        if (attrs) {
          parts.push(`<${name} ${attrs}>`);
        } else {
          parts.push(`<${name}>`);
        }
        break;
      }
      case TokenType.CLOSE_TAG:
        if (!VOID_ELEMENTS.has(token.tagName.toLowerCase())) {
          parts.push(`</${token.tagName.toLowerCase()}>`);
        }
        break;
      case TokenType.TEXT:
        if (token.preserveWhitespace) {
          parts.push(token.content);
        } else {
          const trimmed = token.content.replace(/\s+/g, ' ').trim();
          if (trimmed) parts.push(trimmed);
        }
        break;
    }
  }

  return parts.join('');
}

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
 *   8  = inside kept anchor attr value (suppresses everything after closing quote + space)
 *   14 = inside <img > tag name region
 *   15 = inside <img >, after name (looking for src)
 *   16 = inside the kept src attr name
 *   17 = waiting for opening quote of src
 *   18 = inside src attr value (suppresses everything after closing quote + space)
 *
 * Literal port of prettyhtml.com removeTagAttributes().
 * Quirk: first allowed attribute wins — once its closing quote appears,
 * a subsequent space transitions to state 3 (suppress), so no further
 * attributes survive even if they would otherwise be kept.
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


// ============================================================
// PLAIN TEXT — prettyhtml.com option #8
// Strips all tags, preserves comment bodies.
// ============================================================

export function toPlainText(text) {
  const SENTINEL = '\x00COMMENT\x00';  // NUL-bracketed sentinel — won't collide with real content
  const comments = [];
  // Save comments, replace each with the sentinel. Theirs sentinels only the
  // "<!--" opener, which leaves the comment with no "<" for the tag machine to
  // latch onto — same effect, stated more directly.
  let t = text.replace(/<!--[\s\S]*?-->/g, m => {
    comments.push(m);
    return SENTINEL;
  });
  // Replace each remaining tag with a single space. Theirs collapses every tag
  // to "<>" and then substitutes " ", so "a<br/>b" becomes "a b", not "ab"
  // (divergence D). The doubled spaces this leaves are collapsed by the
  // pipeline's post-pass.
  t = t.replace(/<[^>]*>/g, ' ');
  // Restore comments in order
  t = t.replace(new RegExp(SENTINEL, 'g'), () => comments.shift());
  return t;
}


// ============================================================
// AI WATERMARKS — prettyhtml.com option #9
// Literal port of aiWatermarkFixer(). Order matters: char class replacements
// run before dash/ellipsis patterns (which are effectively dead code due to
// ordering, but preserved for byte-exact fidelity). Real NBSP comes last so
// that &nbsp; entity is processed first.
//
// Mojibake character classes — each byte of the original JS source (UTF-8)
// becomes one Unicode codepoint in the regex character class:
//
// Opening curly-quote class (source bytes: c3a2 e282ac c593 / c29d / c5be / c382 c2ab / c382 c2bb):
//   U+00E2 (â) U+20AC (€) U+0153 (œ) U+009D U+017E (ž) U+00C2 (Â) U+00AB («) U+00BB (»)
//
// Closing curly-quote class (source bytes: c3a2 e282ac cb9c / e284a2 / c5a1 / c2b9 / c2ba):
//   U+00E2 (â) U+20AC (€) U+02DC (˜) U+2122 (™) U+0161 (š) U+00B9 (¹) U+00BA (º)
// ============================================================

export function removeAiWatermarks(text) {
  let t = text;

  // Phase 1 — HTML entities
  t = t.replace(/&ndash;/g, ' - ');
  t = t.replace(/&mdash;/g, ' - ');
  t = t.replace(/&ldquo;/g, '"');
  t = t.replace(/&rdquo;/g, '"');
  t = t.replace(/&lsquo;/g, "'");
  t = t.replace(/&rsquo;/g, "'");
  t = t.replace(/&hellip;/g, '...');
  t = t.replace(/&nbsp;/g, ' ');
  t = t.replace(/&#160;/g, ' ');

  // Phase 2 — invisible / zero-width entities and codepoints
  t = t.replace(/&zwj;/g, '');
  t = t.replace(/&zwnj;/g, '');
  t = t.replace(/&shy;/g, '');
  t = t.replace(/&#8203;/g, '');   // ZWSP
  t = t.replace(/&#8204;/g, '');   // ZWNJ
  t = t.replace(/&#8205;/g, '');   // ZWJ
  t = t.replace(/&#8288;/g, '');   // WORD JOINER
  t = t.replace(/&#65279;/g, '');  // BOM
  t = t.replace(/\u200B/g, '');
  t = t.replace(/\u200C/g, '');
  t = t.replace(/\u200D/g, '');
  t = t.replace(/\u2060/g, '');
  t = t.replace(/\uFEFF/g, '');
  t = t.replace(/\u00AD/g, '');

  // Phase 3 — UTF-8 mojibake (UTF-8 byte sequences misread as Windows-1252 (CP1252))
  // Opening curly-quote mojibake: U+00E2 U+20AC U+0153 U+009D U+017E U+00C2 U+00AB U+00BB -> "
  t = t.replace(/[â€œžÂ«»]/g, '"');
  // Closing curly-quote mojibake: U+00E2 U+20AC U+02DC U+2122 U+0161 U+00B9 U+00BA -> '
  // Note: U+00E2 and U+20AC already replaced above; remaining are ˜ ™ š ¹ º
  t = t.replace(/[â€˜™š¹º]/g, "'");

  // En-dash mojibake (U+00E2 U+20AC U+201C) -> '-'
  // Em-dash mojibake (U+00E2 U+20AC U+201D) -> '--'
  // Ellipsis mojibake (U+00E2 U+20AC U+00A6) -> '...'
  // Two-em mojibake (U+00E2 U+00B8 U+00BA) -> '--'
  // Three-em mojibake (U+00E2 U+00B8 U+00BB) -> '---'
  // NOTE: these patterns never match in practice because their constituent chars
  // (U+00E2, U+20AC) are already replaced by the char classes above. Preserved
  // verbatim for byte-exact fidelity with the original aiWatermarkFixer().
  t = t.replace(/â€“/g, '-');
  t = t.replace(/â€”/g, '--');
  t = t.replace(/â€¦/g, '...');
  t = t.replace(/â¸º/g, '--');
  t = t.replace(/â¸»/g, '---');
  // Word-dash-word pattern — also dead code for the same reason; preserved for fidelity.
  t = t.replace(/(\w)[â€”â¸ºâ¸»]+(\w)/g, '$1 $2');

  // Phase 4 — real NBSP last (so &nbsp; entity was processed first in Phase 1)
  t = t.replace(/\u00A0/g, ' ');

  return t;
}
// Static environment detection — computed once, immune to user content.
// In browsers: window exists. In Node: window is undefined (we shim DOMParser via linkedom).
const IS_BROWSER_ENV = typeof window !== 'undefined';

// ============================================================
// SMART NBSPS — prettyhtml.com option #10
// Two phases:
//   A. Walk h1-h6, p, div text nodes. In each text node, if the LAST WORD
//      is shorter than 10 chars, replace the whitespace separator before
//      it with U+00A0 (NBSP character — not the entity).
//   B. Globally on serialized HTML: after `.` or `<p>` + whitespace + short
//      word + whitespace, append `&nbsp;` entity after the short word.
//
// Verified asymmetry against /tmp/prettyhtml.js (Phase A uses the U+00A0
// character byte \xc2\xa0; Phase B uses the literal entity "&nbsp;").
// ============================================================

export function smartNbsps(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  function lastWordNbsp(text) {
    const tokens = text.split(/(\s+)/);  // keep separators
    let lastIdx = tokens.length - 1;
    while (lastIdx >= 0 && tokens[lastIdx].trim() === '') lastIdx--;
    if (lastIdx < 0 || tokens[lastIdx].trim().length >= 10) return text;
    for (let i = lastIdx - 1; i >= 0; i--) {
      if (tokens[i].trim() === '') {
        tokens[i] = '\u00A0';  // U+00A0 NBSP char (NOT a regular space; using escape so editor tools can't strip it)
        break;
      }
    }
    return tokens.join('');
  }

  function walk(node) {
    node.childNodes.forEach(child => {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        child.nodeValue = lastWordNbsp(child.nodeValue);
      } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
        walk(child);
      }
    });
  }

  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(walk);
  doc.querySelectorAll('p, div').forEach(walk);

  // Serialize: matches the original prettyhtml.com approach (a.body.innerHTML).
  // In browsers we use doc.body.innerHTML directly (literal port).
  // In Node/linkedom doc.body returns null and accessing it triggers DOM re-init,
  // so we use doc.toString() and normalize &#160; entity \u2192 U+00A0 char for consistency.
  const serialized = IS_BROWSER_ENV
    ? doc.body.innerHTML
    : doc.toString().replace(/&#160;/g, '\u00a0');

  // Phase B — uses the &nbsp; ENTITY (not the character)
  return serialized.replace(
    /(\.|<p>)(\s*)(\w+)(\s+)/g,
    (m, prefix, ws1, word) => word.length < 7 ? `${prefix}${ws1}${word}&nbsp;` : m
  );
}

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
      const stripped = t.content.replace(/&nbsp;|&#160;/g, '').trim();
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

      // A <br> with nothing but whitespace between it and its block's closing
      // tag is filler, not a line break — it renders nothing. TinyMCE drops
      // these for prettyhtml.com at layer 1; without that layer we do it here.
      let k = i + 1;
      while (k < n && tokens[k].type === TokenType.TEXT &&
             parentBlock[k] === pIdx && tokens[k].content.trim() === '') k++;
      if (k < n && isBlockClose(tokens[k]) &&
          tokens[k].tagName.toLowerCase() === tokens[pIdx].tagName.toLowerCase()) {
        i++;
        continue;
      }
      // else: real line break inside text — keep it
    }
    out.push(t.raw);
    i++;
  }
  return out.join('');
}

// ============================================================
// TIDY PIPELINE — the order and scaffolding of prettyhtml.com convertText()
//
// Their engine is two layers. Layer 1 is a TinyMCE round-trip that normalizes
// the DOM before any cleaner runs; layer 2 is the string cleaners behind the
// ten checkboxes. We have no layer 1, so a few things TinyMCE does for them are
// handled here by default-ON Extras options instead (normalizeStrayBreaks,
// opt-nested-empties, opt-docs-residue). Reasoning about their cleaners in
// isolation gives the wrong answer about what the site actually outputs — see
// planning/2026-09-03-prettyhtml-complete-capture.md.
//
// Deliberate divergences, kept because ours is better:
//   E — options 1/2 parse attributes structurally; theirs does double-quote-only
//       string surgery, so style='x' or class=“x” slip past it.
//   G — canRemove exempts td/th/script/style/media; theirs deletes <td></td> and
//       does not even check that tag names match (<b></i> gets removed).
//   H — one-space-tag removal accepts &#160; as well as &nbsp;.
//   N — curly quotes are accepted as attribute delimiters (see QUOTE_CLOSERS).
//
// Known cost of parity: the whitespace passes are string-level and run outside
// the tokenizer, so like theirs they do not preserve <pre>/<textarea> indentation.
// ============================================================

/** Both spellings of a non-breaking space entity. Theirs only knows the first. */
const NBSP_SPELLINGS = ['&nbsp;', '&#160;'];

/** Guard against a replacement that can never reach a fixed point. */
const REPLACE_STABLE_LIMIT = 1000;

/**
 * Replace every occurrence of a literal substring, repeating until the text
 * stops changing. Mirrors their `helyettesit(from, to)`, whose looping is what
 * makes single-pair replacements like "  " -> " " collapse runs of any length.
 */
export function replaceUntilStable(text, from, to) {
  if (!from) return text;
  // A replacement whose output still contains its own pattern can never reach a
  // fixed point, and each round makes the string longer — looping would exhaust
  // memory, not just spin. One pass is the only sane reading of that request.
  if (to.includes(from)) return text.split(from).join(to);

  let out = text;
  for (let i = 0; i < REPLACE_STABLE_LIMIT; i++) {
    const next = out.split(from).join(to);
    if (next === out) return out;
    out = next;
  }
  return out;
}

/** Unconditional pre-pass, run before any option is consulted. */
function normalizeWhitespacePrepass(text) {
  let t = text;
  t = replaceUntilStable(t, '\t', '');
  t = replaceUntilStable(t, '  ', ' ');
  t = replaceUntilStable(t, ' \n', '\n');
  t = replaceUntilStable(t, '\t\n', '\n');   // dead after the tab strip; kept for fidelity
  t = replaceUntilStable(t, '\n\n', '\n');
  t = replaceUntilStable(t, '  ', ' ');
  return t;
}

/**
 * Post-pass, re-run until a full round changes nothing. Theirs sums the
 * replacement counts and loops while the total is positive, which is the same
 * condition expressed differently.
 */
function postPassLoop(text) {
  let t = text;
  for (let i = 0; i < REPLACE_STABLE_LIMIT; i++) {
    const before = t;
    t = replaceUntilStable(t, '  ', ' ');
    t = replaceUntilStable(t, ' >', '>');
    t = replaceUntilStable(t, '\t', '');
    t = replaceUntilStable(t, '  ', ' ');
    t = replaceUntilStable(t, '&nbsp;\n', '\n');
    t = replaceUntilStable(t, ' \n', '\n');
    t = replaceUntilStable(t, '\n\n', '\n');
    if (t === before) return t;
  }
  return t;
}

/** Final cleanup, after the attribute/watermark/nbsp options have run. */
function finalCleanup(text) {
  let t = text;
  t = replaceUntilStable(t, ' \n', '\n');
  t = replaceUntilStable(t, '\t\n', '\n');
  t = replaceUntilStable(t, '\n\n', '\n');
  t = replaceUntilStable(t, '  ', ' ');
  return t;
}

/**
 * Remove <script> and <style> blocks. Unconditional on their site (with a popup
 * announcing it); here it rides a visible Extras checkbox so it can be turned off.
 * Theirs deletes between the markers and then removes the "<script</script>"
 * residue, which composes to deleting the whole block.
 */
function stripScriptStyleBlocks(text) {
  return text
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');
}

/**
 * Option 5, "Successive spaces". Despite the label it only touches non-breaking
 * space entities — literal whitespace runs are collapsed by the unconditional
 * passes instead. Measured live: "a&nbsp;b" survives, "a&nbsp;&nbsp;b" -> "a b".
 */
function collapseNbspRuns(text) {
  let t = text;
  for (const a of NBSP_SPELLINGS) {
    for (const b of NBSP_SPELLINGS) t = replaceUntilStable(t, a + b, ' ');
  }
  for (const a of NBSP_SPELLINGS) {
    t = replaceUntilStable(t, a + ' ', ' ');
    t = replaceUntilStable(t, ' ' + a, ' ');
  }
  return t;
}

/**
 * The inter-tag gap normalizations that belong to options 4 and 3 respectively.
 * They run on the raw string, before tokenizing, because their whole job is to
 * turn "<p> </p>" into the "<p></p>" that the empty-tag machine can then see.
 */
function normalizeTagGaps(text, opts) {
  let t = text;
  if (opts.removeOneSpaceTags) {
    t = replaceUntilStable(t, '> &nbsp;<', '>&nbsp;<');
    t = replaceUntilStable(t, '>&nbsp; <', '>&nbsp;<');
  }
  if (opts.removeEmptyTags) {
    t = replaceUntilStable(t, '> <', '><');
    t = replaceUntilStable(t, '> \n', '>\n');
  }
  return t;
}

/**
 * Straighten literal curly punctuation in text content — the character-level
 * counterpart of option 9, which only knows the entity and mojibake spellings.
 * Default OFF: curly quotes in prose are legitimate typography, and this is
 * deliberately kept out of option 9 itself so the ten stay byte-faithful.
 */
export function straightenSmartPunctuation(text) {
  return text
    .replace(/\u2013/g, ' - ')
    .replace(/\u2014/g, ' - ')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2026/g, '...');
}

/**
 * Put every block-level element on its own line, with no indentation.
 *
 * This is what TinyMCE's getContent() does for prettyhtml.com at layer 1, and
 * it accounts for most of the visible difference between their output and ours:
 * they hand back line-delimited blocks, we handed back one long line. Measured
 * live — a block's open tag starts a line, its close tag starts a line only when
 * the block has block children, and inline content stays put. Expressed as two
 * boundary rules that produce exactly that, letting the post-pass tidy up the
 * blank lines and stray spaces they leave behind.
 *
 * Option 3's "> \n" normalization and newline-only-tag machine exist because their
 * layer 1 emits these newlines before any cleaner runs. Ours emits them after, so
 * those two fire on already-formatted input rather than on our own output.
 *
 * Deliberately NOT replicated from TinyMCE: <b> to <strong> rewriting, implied
 * <tbody> insertion, wrapping loose text in <p>, and alt="" injection. Those are
 * editor semantics, not cleanup (divergence K).
 */
export function separateBlockElements(html) {
  const tokens = tokenize(html);
  const parts = [];

  // True if the output so far ends a line — skipping empty pushes.
  const atLineStart = () => {
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] === '') continue;
      return parts[i].endsWith('\n');
    }
    return true;
  };

  for (const token of tokens) {
    const isBlock = token.tagName && BLOCK_ELEMENTS.has(token.tagName.toLowerCase());

    if (isBlock && token.type === TokenType.OPEN_TAG) {
      if (!atLineStart()) parts.push('\n');
      parts.push(token.raw);
    } else if (isBlock && token.type === TokenType.CLOSE_TAG) {
      parts.push(token.raw, '\n');
    } else {
      parts.push(token.raw);
    }
  }

  return parts.join('').replace(/\n+$/, '');
}

/**
 * Run the full Tidy pipeline, ordered to match convertText().
 * @param {string} html - Raw HTML string
 * @param {object} opts - Option flags (see getTidyOptions)
 * @returns {{output: string, fixCount: number, tagCount: number}}
 */
export function runTidyPipeline(html, opts) {
  let text = opts.strayBreaks ? normalizeStrayBreaks(html) : html;

  text = normalizeWhitespacePrepass(text);

  if (opts.stripScripts) text = stripScriptStyleBlocks(text);

  // Option 8 runs first on their site, before every other option.
  if (opts.plainText) text = toPlainText(text);

  // Options 1 and 2 are applied structurally inside tidy(); option 5 is a
  // string pass, and their dispatch runs it between the two.
  if (opts.trimWhitespace) text = collapseNbspRuns(text);

  text = normalizeTagGaps(text, opts);
  let result = tidy(text, opts);
  const tagCount = result.tagCount;
  let fixCount = result.fixCount;

  // Their option dispatch runs once, so a nested empty pair leaves the outer tag
  // behind. Layer 1 hides that for them: TinyMCE rewrites <div><p></p></div> as
  // <div>&nbsp;</div>, which option 4 then eats. Looping is how a pure tokenizer
  // reaches the same end-to-end output, so this is layer-1 compensation rather
  // than optional polish — the same category as normalizeStrayBreaks.
  if (opts.nestedEmpties) {
    for (let i = 0; i < REPLACE_STABLE_LIMIT; i++) {
      const before = result.output;
      result = tidy(normalizeTagGaps(before, opts), opts);
      fixCount += result.fixCount;
      if (result.output === before) break;
    }
  }

  // Block separation runs after the cleaners, not before. TinyMCE does this at
  // layer 1 for them, but emitting the newlines up front would feed the empty-tag
  // machine "<div>\n</div>" instead of the "<div></div>" it needs to match, and
  // would leave a leading newline behind wherever an unwrapped container had been.
  text = opts.blockNewlines ? separateBlockElements(result.output) : result.output;

  text = postPassLoop(text);

  if (opts.tagAttributes) text = removeAllTagAttributes(text);
  if (opts.aiWatermarks) text = removeAiWatermarks(text);
  if (opts.straightenQuotes) text = straightenSmartPunctuation(text);
  if (opts.smartNbsps) text = smartNbsps(text);

  return { output: finalCleanup(text), fixCount, tagCount };
}


// ============================================================
// OPTIONS — Separated into indent and tidy option readers
// ============================================================

function getIndentOptions() {
  const indentSel = document.getElementById('indent-size').value;
  return {
    indentChar: indentSel === 'tab' ? '\t' : ' ',
    indentSize: indentSel === 'tab' ? 1 : parseInt(indentSel, 10),
    wrapLength: parseInt(document.getElementById('wrap-length').value, 10),
  };
}

function getTidyOptions() {
  return {
    sortAttrs: document.getElementById('opt-sort-attrs').checked,
    lowercaseTags: document.getElementById('opt-lowercase-tags').checked,
    lowercaseAttrs: document.getElementById('opt-lowercase-attrs').checked,
    removeEmptyAttrs: document.getElementById('opt-remove-empty-attrs').checked,
    fixSelfClosing: document.getElementById('opt-fix-self-closing').checked,
    quoteAttrs: document.getElementById('opt-unquoted-to-quoted').checked,
    removeComments: document.getElementById('opt-remove-comments').checked,
    removeEmptyTags: document.getElementById('opt-empty-tags').checked,
    removeOneSpaceTags: document.getElementById('opt-one-space-tags').checked,
    trimWhitespace: document.getElementById('opt-trim-whitespace').checked,
    removeStyles: document.getElementById('opt-remove-styles').checked,
    removeClassesIds: document.getElementById('opt-classes-ids').checked,
    removeDataAttrs: document.getElementById('opt-remove-data-attrs').checked,
    unwrapSpans: document.getElementById('opt-unwrap-spans').checked,
    tagAttributes: document.getElementById('opt-tag-attributes').checked,
    plainText: document.getElementById('opt-plain-text').checked,
    aiWatermarks: document.getElementById('opt-ai-watermarks').checked,
    smartNbsps: document.getElementById('opt-smart-nbsps').checked,
    strayBreaks: document.getElementById('opt-stray-breaks').checked,
    stripScripts: document.getElementById('opt-strip-scripts').checked,
    blockNewlines: document.getElementById('opt-block-newlines').checked,
    nestedEmpties: document.getElementById('opt-nested-empties').checked,
    docsResidue: document.getElementById('opt-docs-residue').checked,
    straightenQuotes: document.getElementById('opt-straighten-quotes').checked,
  };
}


// ============================================================
// LOCALSTORAGE PERSISTENCE — Tidy options
// ============================================================

const TIDY_OPTIONS_KEY = 'htmlTidy_options';

const TIDY_CHECKBOX_IDS = [
  'opt-sort-attrs', 'opt-lowercase-tags', 'opt-lowercase-attrs',
  'opt-remove-empty-attrs', 'opt-fix-self-closing', 'opt-unquoted-to-quoted',
  'opt-remove-comments', 'opt-empty-tags', 'opt-one-space-tags', 'opt-trim-whitespace',
  'opt-remove-styles', 'opt-classes-ids',
  'opt-remove-data-attrs', 'opt-unwrap-spans', 'opt-tag-attributes',
  'opt-plain-text', 'opt-ai-watermarks', 'opt-smart-nbsps', 'opt-stray-breaks',
  'opt-strip-scripts', 'opt-nested-empties', 'opt-docs-residue', 'opt-straighten-quotes',
  'opt-block-newlines',
];

function saveTidyOptions() {
  try {
    const state = {};
    for (const id of TIDY_CHECKBOX_IDS) {
      const el = document.getElementById(id);
      if (el) state[id] = el.checked;
    }
    localStorage.setItem(TIDY_OPTIONS_KEY, JSON.stringify(state));
  } catch {
    // Private browsing or storage full — silently ignore
  }
}

function loadTidyOptions() {
  try {
    const raw = localStorage.getItem(TIDY_OPTIONS_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);
    for (const id of TIDY_CHECKBOX_IDS) {
      if (id in state) {
        const el = document.getElementById(id);
        if (el) el.checked = state[id];
      }
    }
  } catch {
    // Corrupted or unavailable — use defaults
  }
}


// ============================================================
// SYNTAX HIGHLIGHTING — regex-based HTML highlighter
// ============================================================

function highlightHTML(code) {
  // Escape HTML entities first
  let escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Comments: <!-- ... -->
  escaped = escaped.replace(
    /(&lt;!--)([\s\S]*?)(--&gt;)/g,
    '<span class="hl-comment">$1$2$3</span>'
  );

  // Tags: match < tagname attrs > and </tagname>
  escaped = escaped.replace(
    /(&lt;\/?)([\w-]+)((?:\s+[\s\S]*?)?)(\/?&gt;)/g,
    function(match, open, tag, attrs, close) {
      // Highlight attribute names and values within the attrs portion
      var highlightedAttrs = attrs.replace(
        /([\w-]+)(=)(&quot;|&#39;|"')(.*?)(\3)/g,
        '<span class="hl-attr">$1</span>$2<span class="hl-value">$4</span>'
      ).replace(
        /([\w-]+)(=)([^\s&]+)/g,
        '<span class="hl-attr">$1</span>$2<span class="hl-value">$3</span>'
      );

      return '<span class="hl-bracket">' + open + '</span><span class="hl-tag">' + tag + '</span>' + highlightedAttrs + '<span class="hl-bracket">' + close + '</span>';
    }
  );

  return escaped;
}


// ============================================================
// UI LAYER
// Wires DOM elements to the formatter.
// ============================================================

/**
 * Rich text example — rendered visually in the contenteditable input.
 */
const EXAMPLE_RICH_HTML = '<h1 style="font-size:24px;color:#333" CLASS="title">Welcome to My Website</h1>\n<p style="margin-bottom:12px">This is a <strong>sample page</strong> with <em>mixed formatting</em>,\n<span style="color:red;font-weight:bold" class="highlight">inline styles</span>, and various issues that need cleaning.</p>\n<h2>Features</h2>\n<ul>\n  <li>Fast loading</li>\n  <li>Responsive design</li>\n  <li>Accessible markup</li>\n</ul>\n<p>Visit <a HREF="https://example.com" TARGET="_blank" REL="noopener" style="color:blue">our website</a> for more information.</p>\n<p data-source="cms" class="body-text" id="intro">This paragraph has <span style="font-weight:bold"><span class="">unnecessary wrapper spans</span></span> and extra attributes that should be cleaned up.</p>\n<div></div>\n<!-- TODO: add sidebar -->';

/**
 * Get the HTML content from the contenteditable input.
 */
function getInputHTML(el) {
  return el.innerHTML.trim();
}

/**
 * Set the HTML content of the contenteditable input.
 * innerHTML is safe here — this is a local-only HTML editing tool.
 */
function setInputHTML(el, html) {
  el.innerHTML = html; // eslint-disable-line no-unsanitized/property
}

/**
 * Strip clipboard HTML boilerplate (StartFragment/EndFragment markers
 * and surrounding <html><body> wrappers).
 */
function cleanClipboardHTML(html) {
  let cleaned = html;
  const fragStart = cleaned.indexOf('<!--StartFragment-->');
  const fragEnd = cleaned.indexOf('<!--EndFragment-->');
  if (fragStart !== -1 && fragEnd !== -1) {
    cleaned = cleaned.substring(fragStart + '<!--StartFragment-->'.length, fragEnd);
  }
  // Strip Google Docs wrapper span (id="docs-internal-guid-...")
  cleaned = cleaned.replace(/^<span id="docs-internal-guid-[^"]*">([\s\S]*)<\/span>$/i, '$1');
  return cleaned.trim();
}

function init() {
  const inputEditor = document.getElementById('input-editor');
  const sourceEditor = document.getElementById('source-editor');
  const sourceHighlight = document.getElementById('source-highlight');
  const btnIndent = document.getElementById('btn-indent');
  const btnTidy = document.getElementById('btn-tidy');
  const btnCompress = document.getElementById('btn-compress');
  const btnPaste = document.getElementById('btn-paste');
  const btnLoadExample = document.getElementById('btn-load-example');
  const btnNewPage = document.getElementById('btn-new-page');
  const btnCopy = document.getElementById('btn-copy');
  const btnDownload = document.getElementById('btn-download');
  const btnUndo = document.getElementById('btn-undo');
  const btnTidyToggle = document.getElementById('btn-tidy-toggle');
  const tidyDropdown = document.getElementById('tidy-dropdown');
  const charCount = document.getElementById('char-count');
  const errorDismiss = document.getElementById('error-dismiss');

  // ---- State ----
  var currentIndentStage = 0;
  var undoStack = [];
  var MAX_UNDO = 50;
  var isUpdating = false;

  // ---- Load persisted options ----
  loadTidyOptions();

  // ---- Rich text toolbar ----
  var editorToolbar = document.querySelector('.editor-toolbar');
  if (editorToolbar) {
    editorToolbar.addEventListener('click', function(e) {
      var btn = e.target.closest('.btn-toolbar');
      if (!btn) return;
      e.preventDefault();

      var command = btn.getAttribute('data-command');
      var value = btn.getAttribute('data-value') || null;

      // formatBlock needs angle-bracket-wrapped tag name
      if (command === 'formatBlock' && value) {
        value = '<' + value + '>';
      }

      inputEditor.focus();
      document.execCommand(command, false, value);
      syncVisualToSource();
    });

    // Track active formatting state via selectionchange
    var toolbarButtons = editorToolbar.querySelectorAll('.btn-toolbar');

    document.addEventListener('selectionchange', function() {
      if (document.activeElement !== inputEditor) return;

      for (var i = 0; i < toolbarButtons.length; i++) {
        var btn = toolbarButtons[i];
        var command = btn.getAttribute('data-command');
        var value = btn.getAttribute('data-value') || null;
        var isActive = false;

        if (command === 'bold' || command === 'italic' ||
            command === 'insertOrderedList' || command === 'insertUnorderedList') {
          isActive = document.queryCommandState(command);
        } else if (command === 'formatBlock' && value) {
          var current = document.queryCommandValue('formatBlock');
          isActive = current.toLowerCase() === value.toLowerCase();
        }

        btn.classList.toggle('active', isActive);
      }
    });
  }

  // ---- Helper: push to undo stack ----
  function pushUndo() {
    var value = sourceEditor.value;
    undoStack.push(value);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    if (btnUndo) btnUndo.disabled = false;
  }

  // ---- Helper: reset indent stage ----
  function resetIndentStage() {
    currentIndentStage = 0;
  }

  // ---- Helper: update source highlight + char count ----
  function updateHighlight() {
    if (sourceHighlight) {
      var code = sourceHighlight.querySelector('code');
      if (code) {
        requestAnimationFrame(function() {
          code.innerHTML = highlightHTML(sourceEditor.value); // eslint-disable-line no-unsanitized/property
        });
      }
    }
    if (charCount) {
      var len = sourceEditor.value.length;
      charCount.textContent = len.toLocaleString() + ' chars';
    }
  }

  // ---- Helper: sync visual -> source ----
  function syncVisualToSource() {
    if (isUpdating) return;
    isUpdating = true;
    var html = getInputHTML(inputEditor);
    sourceEditor.value = html;
    updateHighlight();
    resetIndentStage();
    isUpdating = false;
  }

  // ---- Helper: sync source -> visual ----
  function syncSourceToVisual() {
    if (isUpdating) return;
    isUpdating = true;
    setInputHTML(inputEditor, sourceEditor.value);
    updateHighlight();
    resetIndentStage();
    isUpdating = false;
  }

  // ---- Helper: update both editors from a result ----
  function updateEditors(html) {
    isUpdating = true;
    sourceEditor.value = html;
    setInputHTML(inputEditor, html);
    updateHighlight();
    isUpdating = false;
  }

  // ---- Bidirectional editor linking ----
  var visualDebounce = null;
  var sourceDebounce = null;

  inputEditor.addEventListener('input', function() {
    clearTimeout(visualDebounce);
    visualDebounce = setTimeout(function() {
      if (document.activeElement === inputEditor) {
        syncVisualToSource();
      }
    }, 300);
  });

  sourceEditor.addEventListener('input', function() {
    clearTimeout(sourceDebounce);
    sourceDebounce = setTimeout(function() {
      if (document.activeElement === sourceEditor) {
        syncSourceToVisual();
      }
    }, 300);
    // Always update highlighting immediately
    updateHighlight();
    resetIndentStage();
  });

  // ---- Scroll sync: textarea -> pre ----
  sourceEditor.addEventListener('scroll', function() {
    if (sourceHighlight) {
      sourceHighlight.scrollTop = sourceEditor.scrollTop;
      sourceHighlight.scrollLeft = sourceEditor.scrollLeft;
    }
  });

  // ---- Indent button ----
  btnIndent.addEventListener('click', function() {
    var html = sourceEditor.value || getInputHTML(inputEditor);
    if (!html) {
      showError('No input', 'Paste some rich text or HTML into either editor first.');
      return;
    }
    hideError();
    try {
      pushUndo();
      var opts = getIndentOptions();

      if (currentIndentStage === 0 || currentIndentStage === 2) {
        currentIndentStage = 1;
      } else {
        currentIndentStage = 2;
      }

      var result = indent(html, opts, currentIndentStage);
      updateEditors(result);

      var tokens = tokenize(html);
      var tagCount = tokens.filter(function(t) {
        return t.type === TokenType.OPEN_TAG || t.type === TokenType.SELF_CLOSING_TAG;
      }).length;
      updateStats(html, result, tagCount, 0);
      updatePreview(result);
    } catch (e) {
      showError('Indent error', e.message);
    }
  });

  // ---- Tidy button ----
  btnTidy.addEventListener('click', function() {
    var html = sourceEditor.value || getInputHTML(inputEditor);
    if (!html) {
      showError('No input', 'Paste some rich text or HTML into either editor first.');
      return;
    }
    hideError();
    try {
      pushUndo();
      var result = runTidyPipeline(html, getTidyOptions());
      updateEditors(result.output);
      resetIndentStage();
      updateStats(html, result.output, result.tagCount, result.fixCount);
      updatePreview(result.output);
    } catch (e) {
      showError('Tidy error', e.message);
    }
  });

  // ---- Compress button ----
  btnCompress.addEventListener('click', function() {
    var html = sourceEditor.value || getInputHTML(inputEditor);
    if (!html) {
      showError('No input', 'Paste some rich text or HTML into either editor first.');
      return;
    }
    hideError();
    try {
      pushUndo();
      var result = compress(html);
      updateEditors(result);
      resetIndentStage();

      var tokens = tokenize(html);
      var tagCount = tokens.filter(function(t) {
        return t.type === TokenType.OPEN_TAG || t.type === TokenType.SELF_CLOSING_TAG;
      }).length;
      updateStats(html, result, tagCount, 0);
      updatePreview(result);
    } catch (e) {
      showError('Compress error', e.message);
    }
  });

  // ---- Tidy dropdown toggle ----
  if (btnTidyToggle && tidyDropdown) {
    btnTidyToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      var isHidden = tidyDropdown.hidden;
      tidyDropdown.hidden = !isHidden;
      btnTidyToggle.setAttribute('aria-expanded', String(isHidden));
    });

    // Close on click outside
    document.addEventListener('click', function(e) {
      if (!tidyDropdown.hidden && !tidyDropdown.contains(e.target) && e.target !== btnTidyToggle) {
        tidyDropdown.hidden = true;
        btnTidyToggle.setAttribute('aria-expanded', 'false');
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !tidyDropdown.hidden) {
        tidyDropdown.hidden = true;
        btnTidyToggle.setAttribute('aria-expanded', 'false');
        btnTidyToggle.focus();
      }
    });

    // Save options on checkbox change within dropdown
    tidyDropdown.addEventListener('change', function() {
      saveTidyOptions();
    });
  }

  // ---- Undo button ----
  if (btnUndo) {
    btnUndo.disabled = true;
    btnUndo.addEventListener('click', function() {
      if (undoStack.length === 0) return;
      var prev = undoStack.pop();
      updateEditors(prev);
      btnUndo.disabled = undoStack.length === 0;
    });
  }

  // ---- Paste button ----
  btnPaste.addEventListener('click', async function() {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        var items = await navigator.clipboard.read();
        for (var ci = 0; ci < items.length; ci++) {
          var item = items[ci];
          if (item.types.includes('text/html')) {
            var blob = await item.getType('text/html');
            var html = await blob.text();
            setInputHTML(inputEditor, cleanClipboardHTML(html));
            syncVisualToSource();
            inputEditor.focus();
            return;
          }
        }
      }
      var text = await navigator.clipboard.readText();
      inputEditor.textContent = text;
      syncVisualToSource();
      inputEditor.focus();
    } catch (_) {
      inputEditor.focus();
    }
  });

  // ---- Load example ----
  btnLoadExample.addEventListener('click', function() {
    setInputHTML(inputEditor, EXAMPLE_RICH_HTML);
    syncVisualToSource();
    inputEditor.focus();
  });

  // ---- New Page (clear all) ----
  btnNewPage.addEventListener('click', function() {
    setInputHTML(inputEditor, '');
    sourceEditor.value = '';
    updateHighlight();
    resetIndentStage();
    undoStack.length = 0;
    if (btnUndo) btnUndo.disabled = true;
    document.getElementById('stats-section').hidden = true;
    document.getElementById('preview-section').hidden = true;
    inputEditor.focus();
  });

  // ---- Copy source ----
  btnCopy.addEventListener('click', function() {
    var text = sourceEditor.value;
    if (!text) return;
    copyToClipboard(text, btnCopy);
  });

  // ---- Download source ----
  btnDownload.addEventListener('click', function() {
    var text = sourceEditor.value;
    if (!text) return;
    var blob = new Blob([text], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'formatted.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // ---- Toggle preview ----
  var btnTogglePreview = document.getElementById('btn-toggle-preview');
  btnTogglePreview.addEventListener('click', function() {
    var frame = document.querySelector('.preview-frame-wrapper');
    var isHidden = frame.style.display === 'none';
    frame.style.display = isHidden ? '' : 'none';
    btnTogglePreview.textContent = isHidden ? 'Hide preview' : 'Show preview';
  });

  // ---- Dismiss error ----
  errorDismiss.addEventListener('click', hideError);

  // ---- Rich text paste handler ----
  inputEditor.addEventListener('paste', function(e) {
    var clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    var html = clipboardData.getData('text/html');
    if (html && html.trim()) {
      e.preventDefault();
      var cleaned = cleanClipboardHTML(html);
      document.execCommand('insertHTML', false, cleaned);
      // Sync after paste
      setTimeout(syncVisualToSource, 50);
    }
  });

  // ---- Keyboard shortcut: Ctrl/Cmd + Enter -> Tidy (primary action) ----
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      btnTidy.click();
    }
  });

  // ---- Initial highlight ----
  updateHighlight();
}

// ============================================================
// UI HELPERS
// ============================================================

function showError(title, detail) {
  document.getElementById('error-title').textContent = title;
  document.getElementById('error-detail').textContent = detail;
  document.getElementById('error-section').hidden = false;
}

function hideError() {
  document.getElementById('error-section').hidden = true;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function updateStats(input, output, tagCount, fixCount) {
  var inputSize = new Blob([input]).size;
  var outputSize = new Blob([output]).size;
  var diff = outputSize - inputSize;
  var lines = output.split('\n').length;

  document.getElementById('stat-input-size').textContent = formatBytes(inputSize);
  document.getElementById('stat-output-size').textContent = formatBytes(outputSize);

  var diffEl = document.getElementById('stat-diff');
  var diffSign = diff > 0 ? '+' : '';
  diffEl.textContent = diffSign + formatBytes(Math.abs(diff));
  diffEl.className = 'stat-value' + (diff > 0 ? ' positive' : diff < 0 ? ' negative' : '');

  document.getElementById('stat-lines').textContent = lines;
  document.getElementById('stat-tags').textContent = tagCount;
  document.getElementById('stat-fixes').textContent = fixCount;

  var cards = document.querySelectorAll('.stat-card');
  cards.forEach(function(card, i) { card.style.setProperty('--card-index', i); });

  document.getElementById('stats-section').hidden = false;
}

function updatePreview(html) {
  var previewSection = document.getElementById('preview-section');
  var frame = document.getElementById('preview-frame');
  previewSection.hidden = false;

  var doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
}

async function copyToClipboard(text, button) {
  var originalText = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied!';
    button.classList.add('btn-success-flash');
  } catch (_) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    var success = false;
    try { success = document.execCommand('copy'); } catch (_e) { /* noop */ }
    document.body.removeChild(textarea);
    button.textContent = success ? 'Copied!' : 'Failed';
    if (success) button.classList.add('btn-success-flash');
  }
  setTimeout(function() {
    button.textContent = originalText;
    button.classList.remove('btn-success-flash');
  }, 1500);
}

// ============================================================
// INIT
// ============================================================
if (typeof document !== 'undefined') {
  init();
}
