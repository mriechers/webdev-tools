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
 * Parse an HTML attribute string into an array of {name, value, quote} objects.
 */
function parseAttributes(attrString) {
  const attrs = [];
  if (!attrString || !attrString.trim()) return attrs;

  // Regex matches: name="value", name='value', name=value, or bare name
  const re = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let match;
  while ((match = re.exec(attrString)) !== null) {
    const name = match[1];
    const value = match[2] !== undefined ? match[2]
                : match[3] !== undefined ? match[3]
                : match[4] !== undefined ? match[4]
                : null;
    const quote = match[2] !== undefined ? '"'
               : match[3] !== undefined ? "'"
               : match[4] !== undefined ? ''
               : null;
    attrs.push({ name, value, quote });
  }
  return attrs;
}

/**
 * Tokenize an HTML string into an array of tokens.
 * Each token has: { type, raw, tagName?, attributes?, content? }
 */
function tokenize(html) {
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
    if (ch === '"' || ch === "'") {
      // Skip quoted attribute value
      const closeQuote = html.indexOf(ch, i + 1);
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
function indent(html, opts, stage) {
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
    if (opts.removeStyles && lowerAttrName === 'style') return null;
    if (opts.removeClasses && lowerAttrName === 'class') return null;
    if (opts.removeIds && lowerAttrName === 'id') return null;
    if (opts.removeDataAttrs && lowerAttrName.startsWith('data-')) return null;
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
function tidy(html, opts) {
  const tokens = tokenize(html);
  const parts = [];
  let fixCount = 0;
  let tagCount = 0;
  let unwrappedSpanDepth = 0;

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

        // Remove empty tags
        if (opts.removeEmptyTags) {
          const nextToken = tokens[i + 1];
          const canRemove = !VOID_ELEMENTS.has(lowerName) &&
              !['script', 'style', 'iframe', 'canvas', 'video', 'audio', 'td', 'th'].includes(lowerName);

          // Case 1: <tag></tag> — directly empty
          if (canRemove && nextToken &&
              nextToken.type === TokenType.CLOSE_TAG &&
              nextToken.tagName.toLowerCase() === lowerName) {
            fixCount++;
            i++;
            break;
          }

          // Case 2: <tag>&nbsp;</tag> — contains only &nbsp; / whitespace
          if (canRemove && nextToken && nextToken.type === TokenType.TEXT) {
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
        }

        // Unwrap empty spans
        if (opts.unwrapSpans && lowerName === 'span') {
          const remainingAttrs = (token.attributes || []).filter(attr => {
            const an = (opts.lowercaseAttrs ? attr.name.toLowerCase() : attr.name).toLowerCase();
            if (opts.removeStyles && an === 'style') return false;
            if (opts.removeClasses && an === 'class') return false;
            if (opts.removeIds && an === 'id') return false;
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

        parts.push(`</${closeTagName}>`);
        break;
      }

      case TokenType.SELF_CLOSING_TAG: {
        tagCount++;
        parts.push(buildTidyTag(token.tagName, token.attributes || [], true, opts));
        break;
      }

      case TokenType.TEXT: {
        if (token.preserveWhitespace) {
          parts.push(token.content);
          break;
        }

        let text = token.content;
        if (opts.trimWhitespace) {
          text = text.replace(/\s+/g, ' ');
          // Only fully trim if the result is all whitespace
          if (!text.trim()) {
            // Preserve a single space between inline elements
            parts.push(' ');
            break;
          }
        }
        parts.push(text);
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

function compress(html) {
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

// Keep backward compat alias
const minify = compress;


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
    removeEmptyTags: document.getElementById('opt-remove-empty-tags').checked,
    trimWhitespace: document.getElementById('opt-trim-whitespace').checked,
    newlineBeforeClose: document.getElementById('opt-newline-before-close').checked,
    removeStyles: document.getElementById('opt-remove-styles').checked,
    removeClasses: document.getElementById('opt-remove-classes').checked,
    removeDataAttrs: document.getElementById('opt-remove-data-attrs').checked,
    removeIds: document.getElementById('opt-remove-ids').checked,
    unwrapSpans: document.getElementById('opt-unwrap-spans').checked,
  };
}


// ============================================================
// LOCALSTORAGE PERSISTENCE — Tidy options
// ============================================================

const TIDY_OPTIONS_KEY = 'htmlTidy_options';

const TIDY_CHECKBOX_IDS = [
  'opt-sort-attrs', 'opt-lowercase-tags', 'opt-lowercase-attrs',
  'opt-remove-empty-attrs', 'opt-fix-self-closing', 'opt-unquoted-to-quoted',
  'opt-remove-comments', 'opt-remove-empty-tags', 'opt-trim-whitespace',
  'opt-newline-before-close', 'opt-remove-styles', 'opt-remove-classes',
  'opt-remove-data-attrs', 'opt-remove-ids', 'opt-unwrap-spans',
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
      var opts = getTidyOptions();
      var result = tidy(html, opts);
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
init();
