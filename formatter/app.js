/*
 * HTML Formatter & Tidy — Application Logic
 * ==========================================
 * A pure client-side HTML formatter, beautifier, and tidier.
 * No dependencies — works entirely in the browser.
 *
 * Architecture:
 * 1. Tokenizer: breaks raw HTML into tokens (tags, text, comments, doctype)
 * 2. Formatter: walks tokens and applies indentation + tidying rules
 * 3. Minifier: strips all unnecessary whitespace
 * 4. UI layer: wires DOM elements to the formatter
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
// HTML FORMATTER
// Takes tokens and produces indented, tidied HTML.
// ============================================================

/**
 * Get the current formatting options from the UI.
 */
function getOptions() {
  const indentSel = document.getElementById('indent-size').value;
  return {
    indentChar: indentSel === 'tab' ? '\t' : ' ',
    indentSize: indentSel === 'tab' ? 1 : parseInt(indentSel, 10),
    wrapLength: parseInt(document.getElementById('wrap-length').value, 10),
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
    indentInnerHtml: document.getElementById('opt-indent-inner-html').checked,
    // CMS cleaning options
    removeStyles: document.getElementById('opt-remove-styles').checked,
    removeClasses: document.getElementById('opt-remove-classes').checked,
    removeDataAttrs: document.getElementById('opt-remove-data-attrs').checked,
    removeIds: document.getElementById('opt-remove-ids').checked,
    unwrapSpans: document.getElementById('opt-unwrap-spans').checked,
  };
}

/**
 * Format an attribute list into a string, respecting options.
 */
function formatAttributes(attrs, opts) {
  let processed = attrs.map(attr => {
    let name = opts.lowercaseAttrs ? attr.name.toLowerCase() : attr.name;
    let value = attr.value;
    let quote = attr.quote;

    // CMS cleaning: strip specific attribute types
    const lowerName = name.toLowerCase();
    if (opts.removeStyles && lowerName === 'style') return null;
    if (opts.removeClasses && lowerName === 'class') return null;
    if (opts.removeIds && lowerName === 'id') return null;
    if (opts.removeDataAttrs && lowerName.startsWith('data-')) return null;

    // Remove empty attributes if option is set
    if (opts.removeEmptyAttrs && value === '' && !isBooleanAttr(name)) {
      return null;
    }

    // Quote unquoted attribute values
    if (opts.quoteAttrs && value !== null && quote !== '"' && quote !== "'") {
      quote = '"';
    }

    if (value === null) {
      // Boolean attribute
      return name;
    }

    const quoteChar = quote || '"';
    return `${name}=${quoteChar}${value}${quoteChar}`;
  }).filter(Boolean);

  if (opts.sortAttrs) {
    processed.sort();
  }

  return processed;
}

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
 * Build a single tag string from components.
 */
function buildTag(tagName, attrs, selfClose, opts) {
  const name = opts.lowercaseTags ? tagName.toLowerCase() : tagName;
  const attrParts = formatAttributes(attrs, opts);

  // Decide if we need to wrap attributes across multiple lines
  const singleLine = attrParts.length === 0
    ? (selfClose ? `<${name} />` : `<${name}>`)
    : (selfClose ? `<${name} ${attrParts.join(' ')} />` : `<${name} ${attrParts.join(' ')}>`);

  if (opts.wrapLength > 0 && singleLine.length > opts.wrapLength && attrParts.length > 1) {
    const indent = opts.indentChar.repeat(opts.indentSize);
    const attrIndent = indent + (opts.indentChar === '\t' ? '\t' : ' '.repeat(opts.indentSize));
    const attrStr = attrParts.map(a => `${attrIndent}${a}`).join('\n');
    if (opts.newlineBeforeClose) {
      return selfClose
        ? `<${name}\n${attrStr}\n/>`
        : `<${name}\n${attrStr}\n>`;
    }
    return selfClose
      ? `<${name}\n${attrStr} />`
      : `<${name}\n${attrStr}>`;
  }

  // For void elements with fixSelfClosing, ensure proper format
  if (selfClose && opts.fixSelfClosing && VOID_ELEMENTS.has(tagName.toLowerCase())) {
    const attrStr = attrParts.length > 0 ? ' ' + attrParts.join(' ') : '';
    return `<${name}${attrStr}>`;
  }

  return singleLine;
}

/**
 * Format tokenized HTML into a beautified string.
 * Returns { output, fixCount, tagCount }.
 */
function format(tokens, opts) {
  const lines = [];
  let indentLevel = 0;
  let fixCount = 0;
  let tagCount = 0;
  let unwrappedSpanDepth = 0; // tracks spans being unwrapped
  const indent = () => opts.indentChar.repeat(opts.indentSize * indentLevel);

  // Track which structural elements affect indentation
  const noIndentElements = opts.indentInnerHtml ? [] : ['html', 'head', 'body'];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token.type) {
      case TokenType.DOCTYPE: {
        let doctype = token.raw.trim();
        if (opts.lowercaseTags) {
          doctype = doctype.replace(/<!DOCTYPE/i, '<!DOCTYPE');
        }
        lines.push(indent() + doctype);
        break;
      }

      case TokenType.COMMENT: {
        if (opts.removeComments) {
          fixCount++;
          break;
        }
        const commentContent = token.content;
        // Multiline comments: preserve internal structure
        if (commentContent.includes('\n')) {
          const commentLines = token.raw.split('\n');
          commentLines.forEach((line, idx) => {
            if (idx === 0) {
              lines.push(indent() + line.trim());
            } else {
              lines.push(indent() + '  ' + line.trim());
            }
          });
        } else {
          lines.push(indent() + `<!--${commentContent}-->`);
        }
        break;
      }

      case TokenType.CDATA: {
        lines.push(indent() + token.raw);
        break;
      }

      case TokenType.OPEN_TAG: {
        const lowerName = token.tagName.toLowerCase();
        tagCount++;

        // Check for empty tags that should be removed
        if (opts.removeEmptyTags) {
          const nextToken = tokens[i + 1];
          if (nextToken && nextToken.type === TokenType.CLOSE_TAG &&
              nextToken.tagName.toLowerCase() === lowerName &&
              !VOID_ELEMENTS.has(lowerName) &&
              !['script', 'style', 'iframe', 'canvas', 'video', 'audio', 'td', 'th'].includes(lowerName)) {
            fixCount++;
            i++; // Skip the close tag too
            break;
          }
        }

        // Unwrap spans: if the span has no meaningful attributes left after
        // cleaning, skip the opening tag (and mark for closing tag skip)
        if (opts.unwrapSpans && lowerName === 'span') {
          const remainingAttrs = formatAttributes(token.attributes || [], opts);
          if (remainingAttrs.length === 0) {
            fixCount++;
            unwrappedSpanDepth++;
            break; // Skip the <span> tag, its content will flow through
          }
        }

        const tagStr = buildTag(token.tagName, token.attributes || [], false, opts);
        lines.push(indent() + tagStr);

        if (!noIndentElements.includes(lowerName)) {
          indentLevel++;
        }

        break;
      }

      case TokenType.CLOSE_TAG: {
        const lowerName = token.tagName.toLowerCase();
        const closeTagName = opts.lowercaseTags ? lowerName : token.tagName;

        // Void elements shouldn't have closing tags
        if (VOID_ELEMENTS.has(lowerName)) {
          fixCount++;
          break;
        }

        // Skip closing tags for unwrapped spans
        if (lowerName === 'span' && unwrappedSpanDepth > 0) {
          unwrappedSpanDepth--;
          break;
        }

        if (!noIndentElements.includes(lowerName)) {
          indentLevel = Math.max(0, indentLevel - 1);
        }

        lines.push(indent() + `</${closeTagName}>`);
        break;
      }

      case TokenType.SELF_CLOSING_TAG: {
        tagCount++;
        const tagStr = buildTag(token.tagName, token.attributes || [], true, opts);
        lines.push(indent() + tagStr);
        break;
      }

      case TokenType.TEXT: {
        if (token.preserveWhitespace) {
          // Raw text (inside <script>, <style>, <pre>, etc.) — preserve as-is
          lines.push(token.content);
          break;
        }

        const text = opts.trimWhitespace ? token.content.replace(/\s+/g, ' ').trim() : token.content;
        if (!text) break;

        // For inline text that's just whitespace between tags, skip it
        if (opts.trimWhitespace && !text.trim()) break;

        lines.push(indent() + text);
        break;
      }
    }
  }

  // Clean up: remove consecutive blank lines
  const output = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { output, fixCount, tagCount };
}

/**
 * Minify HTML — strip all unnecessary whitespace.
 */
function minify(html) {
  const tokens = tokenize(html);
  const parts = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    switch (token.type) {
      case TokenType.DOCTYPE:
        parts.push(token.raw.replace(/\s+/g, ' ').trim());
        break;
      case TokenType.COMMENT:
        // Strip comments in minified output
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
        const isVoid = VOID_ELEMENTS.has(name);
        if (attrs) {
          parts.push(isVoid ? `<${name} ${attrs}>` : `<${name} ${attrs}>`);
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
// UI LAYER
// Wires DOM elements to the formatter.
// ============================================================

/**
 * Rich text example — rendered visually in the contenteditable input.
 * Simulates what you'd get pasting from a word processor or CMS.
 */
const EXAMPLE_RICH_HTML = `<h1 style="font-size:24px;color:#333" CLASS="title">Welcome to My Website</h1>
<p style="margin-bottom:12px">This is a <strong>sample page</strong> with <em>mixed formatting</em>,
<span style="color:red;font-weight:bold" class="highlight">inline styles</span>, and various issues that need cleaning.</p>
<h2>Features</h2>
<ul>
  <li>Fast loading</li>
  <li>Responsive design</li>
  <li>Accessible markup</li>
</ul>
<p>Visit <a HREF="https://example.com" TARGET="_blank" REL="noopener" style="color:blue">our website</a> for more information.</p>
<p data-source="cms" class="body-text" id="intro">This paragraph has <span style="font-weight:bold"><span class="">unnecessary wrapper spans</span></span> and extra attributes that should be cleaned up.</p>
<div></div>
<!-- TODO: add sidebar -->`;

/**
 * Get the HTML content from the contenteditable input.
 * Returns trimmed innerHTML.
 */
function getInputHTML(el) {
  // innerHTML is used intentionally — this is a rich text editing tool
  // where rendering user-pasted HTML is the core functionality.
  // All processing is client-side; nothing is sent to a server.
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
  const outputEditor = document.getElementById('output-editor');
  const btnFormat = document.getElementById('btn-format');
  const btnMinify = document.getElementById('btn-minify');
  const btnPaste = document.getElementById('btn-paste');
  const btnLoadExample = document.getElementById('btn-load-example');
  const btnClearInput = document.getElementById('btn-clear-input');
  const btnCopy = document.getElementById('btn-copy');
  const btnDownload = document.getElementById('btn-download');
  const btnUseAsInput = document.getElementById('btn-use-as-input');
  const btnTogglePreview = document.getElementById('btn-toggle-preview');
  const errorSection = document.getElementById('error-section');
  const errorDismiss = document.getElementById('error-dismiss');

  // Format button — extract HTML from the rich text input and clean it
  btnFormat.addEventListener('click', () => {
    const html = getInputHTML(inputEditor);
    if (!html) {
      showError('No input', 'Paste some rich text or HTML into the input pane first.');
      return;
    }
    hideError();
    try {
      const opts = getOptions();
      const tokens = tokenize(html);
      const result = format(tokens, opts);
      outputEditor.value = result.output;
      updateStats(html, result.output, result.tagCount, result.fixCount);
      updatePreview(result.output);
    } catch (e) {
      showError('Formatting error', e.message);
    }
  });

  // Minify button
  btnMinify.addEventListener('click', () => {
    const html = getInputHTML(inputEditor);
    if (!html) {
      showError('No input', 'Paste some rich text or HTML into the input pane first.');
      return;
    }
    hideError();
    try {
      const result = minify(html);
      outputEditor.value = result;
      const tokens = tokenize(html);
      const tagCount = tokens.filter(t =>
        t.type === TokenType.OPEN_TAG || t.type === TokenType.SELF_CLOSING_TAG
      ).length;
      updateStats(html, result, tagCount, 0);
      updatePreview(result);
    } catch (e) {
      showError('Minification error', e.message);
    }
  });

  // Paste button — reads HTML from clipboard and inserts as rich text
  btnPaste.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('text/html')) {
            const blob = await item.getType('text/html');
            const html = await blob.text();
            setInputHTML(inputEditor, cleanClipboardHTML(html));
            inputEditor.focus();
            return;
          }
        }
      }
      // Fall back to plain text
      const text = await navigator.clipboard.readText();
      inputEditor.textContent = text;
      inputEditor.focus();
    } catch {
      inputEditor.focus();
    }
  });

  // Load example — show rendered rich text
  btnLoadExample.addEventListener('click', () => {
    setInputHTML(inputEditor, EXAMPLE_RICH_HTML);
    inputEditor.focus();
  });

  // Clear input
  btnClearInput.addEventListener('click', () => {
    setInputHTML(inputEditor, '');
    outputEditor.value = '';
    document.getElementById('stats-section').hidden = true;
    document.getElementById('preview-section').hidden = true;
    inputEditor.focus();
  });

  // Copy output
  btnCopy.addEventListener('click', () => {
    const text = outputEditor.value;
    if (!text) return;
    copyToClipboard(text, btnCopy);
  });

  // Download output
  btnDownload.addEventListener('click', () => {
    const text = outputEditor.value;
    if (!text) return;
    const blob = new Blob([text], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'formatted.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Use output as input — renders the cleaned HTML back as rich text
  btnUseAsInput.addEventListener('click', () => {
    const text = outputEditor.value;
    if (!text) return;
    setInputHTML(inputEditor, text);
    outputEditor.value = '';
    document.getElementById('stats-section').hidden = true;
    inputEditor.focus();
  });

  // Toggle preview
  btnTogglePreview.addEventListener('click', () => {
    const frame = document.querySelector('.preview-frame-wrapper');
    const isHidden = frame.style.display === 'none';
    frame.style.display = isHidden ? '' : 'none';
    btnTogglePreview.textContent = isHidden ? 'Hide preview' : 'Show preview';
  });

  // Dismiss error
  errorDismiss.addEventListener('click', hideError);

  // ---- Rich text paste handler ----
  // Intercept paste to strip clipboard boilerplate (StartFragment markers,
  // <html><body> wrappers) while preserving the rich text formatting.
  inputEditor.addEventListener('paste', (e) => {
    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    const html = clipboardData.getData('text/html');
    if (html && html.trim()) {
      e.preventDefault();
      const cleaned = cleanClipboardHTML(html);
      // Insert cleaned HTML at the current cursor position
      document.execCommand('insertHTML', false, cleaned);
    }
    // If no HTML data, let the default plain-text paste happen
  });

  // Keyboard shortcut: Ctrl/Cmd + Enter to format
  inputEditor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      btnFormat.click();
    }
  });
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
  const inputSize = new Blob([input]).size;
  const outputSize = new Blob([output]).size;
  const diff = outputSize - inputSize;
  const lines = output.split('\n').length;

  document.getElementById('stat-input-size').textContent = formatBytes(inputSize);
  document.getElementById('stat-output-size').textContent = formatBytes(outputSize);

  const diffEl = document.getElementById('stat-diff');
  const diffSign = diff > 0 ? '+' : '';
  diffEl.textContent = diffSign + formatBytes(Math.abs(diff));
  diffEl.className = 'stat-value' + (diff > 0 ? ' positive' : diff < 0 ? ' negative' : '');

  document.getElementById('stat-lines').textContent = lines;
  document.getElementById('stat-tags').textContent = tagCount;
  document.getElementById('stat-fixes').textContent = fixCount;

  // Animate stat cards
  const cards = document.querySelectorAll('.stat-card');
  cards.forEach((card, i) => card.style.setProperty('--card-index', i));

  document.getElementById('stats-section').hidden = false;
}

function updatePreview(html) {
  const previewSection = document.getElementById('preview-section');
  const frame = document.getElementById('preview-frame');
  previewSection.hidden = false;

  // Write to sandboxed iframe
  const doc = frame.contentDocument || frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
}

async function copyToClipboard(text, button) {
  const originalText = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied!';
    button.classList.add('btn-success-flash');
  } catch {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let success = false;
    try { success = document.execCommand('copy'); } catch {}
    document.body.removeChild(textarea);
    button.textContent = success ? 'Copied!' : 'Failed';
    if (success) button.classList.add('btn-success-flash');
  }
  setTimeout(() => {
    button.textContent = originalText;
    button.classList.remove('btn-success-flash');
  }, 1500);
}

// ============================================================
// INIT
// ============================================================
init();
