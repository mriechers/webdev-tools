#!/usr/bin/env node
/**
 * Reads suggested-tools.md and injects generated HTML into each page.
 *
 * Each page must contain marker comments:
 *   <!-- SUGGESTED_TOOLS_START --> ... <!-- SUGGESTED_TOOLS_END -->
 *
 * The home page gets a standalone <section>, while tool sub-pages get
 * inline links appended to their existing "Related tools:" footer line.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MD_PATH = path.join(ROOT, 'suggested-tools.md');

// Map section names in the markdown to their HTML file paths and render mode.
const PAGE_MAP = {
  home:      { file: 'index.html',          mode: 'section' },
  formatter: { file: 'formatter/index.html', mode: 'inline' },
  'og-image':  { file: 'og-image/index.html',  mode: 'inline' },
};

// ---------------------------------------------------------------------------
// Parse the markdown
// ---------------------------------------------------------------------------
function parseMarkdown(src) {
  const sections = {};
  let current = null;

  for (const raw of src.split('\n')) {
    const line = raw.trim();

    // H2 heading = page key
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      current = h2[1].trim().toLowerCase();
      sections[current] = [];
      continue;
    }

    // Markdown link inside a list item
    if (current && /^-\s+\[/.test(line)) {
      const match = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (match) {
        sections[current].push({ name: match[1], url: match[2] });
      }
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Render HTML for each mode
// ---------------------------------------------------------------------------
function renderSection(tools) {
  if (tools.length === 0) return '';
  const items = tools
    .map(t =>
      `          <li><a href="${t.url}" target="_blank" rel="noopener">${t.name} <span class="external-icon" aria-hidden="true">&#8599;</span></a></li>`
    )
    .join('\n');
  return [
    '      <section class="suggested-tools">',
    '        <h2 class="section-heading">Suggested Tools</h2>',
    '        <ul class="suggested-list">',
    items,
    '        </ul>',
    '      </section>',
  ].join('\n');
}

function renderInline(tools) {
  if (tools.length === 0) return '';
  return tools
    .map(t =>
      `        <a href="${t.url}" target="_blank" rel="noopener">${t.name}</a>`
    )
    .join(' &middot;\n');
}

// ---------------------------------------------------------------------------
// Inject between markers
// ---------------------------------------------------------------------------
const START = '<!-- SUGGESTED_TOOLS_START -->';
const END   = '<!-- SUGGESTED_TOOLS_END -->';

function inject(html, rendered) {
  const startIdx = html.indexOf(START);
  const endIdx   = html.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    return null; // markers not found
  }
  return (
    html.slice(0, startIdx + START.length) +
    '\n' + rendered + '\n' +
    html.slice(endIdx)
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const md = fs.readFileSync(MD_PATH, 'utf-8');
const sections = parseMarkdown(md);

let changed = 0;

for (const [key, config] of Object.entries(PAGE_MAP)) {
  const tools = sections[key];
  if (!tools || tools.length === 0) {
    console.log(`  skip  ${config.file} (no tools listed under "${key}")`);
    continue;
  }

  const filePath = path.join(ROOT, config.file);
  const html = fs.readFileSync(filePath, 'utf-8');

  const rendered = config.mode === 'section'
    ? renderSection(tools)
    : renderInline(tools);

  const result = inject(html, rendered);
  if (result === null) {
    console.error(`  ERROR  ${config.file}: missing ${START} / ${END} markers`);
    process.exit(1);
  }

  fs.writeFileSync(filePath, result, 'utf-8');
  console.log(`  wrote  ${config.file} (${tools.length} tools)`);
  changed++;
}

console.log(`\nDone — updated ${changed} file(s).`);
