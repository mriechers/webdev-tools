#!/usr/bin/env node
/**
 * Reads suggested-tools.md and injects generated HTML into each page.
 *
 * Each page must contain marker comments:
 *   <!-- SUGGESTED_TOOLS_START --> ... <!-- SUGGESTED_TOOLS_END -->
 *
 * The home page gets card-based layout (using ### groups with metadata).
 * Tool sub-pages get inline links appended to their existing footer line.
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
  let currentSection = null;
  let currentGroup = null;

  for (const raw of src.split('\n')) {
    const line = raw.trim();

    // H2 heading = page key
    const h2 = line.match(/^##\s+([^#].*)$/);
    if (h2) {
      currentSection = h2[1].trim().toLowerCase();
      sections[currentSection] = { groups: [], links: [] };
      currentGroup = null;
      continue;
    }

    if (!currentSection) continue;

    // H3 heading = card group (e.g., "### 📡 Feed Validators")
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      const titleText = h3[1].trim();
      // Extract leading emoji icon if present
      const iconMatch = titleText.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u);
      const icon = iconMatch ? iconMatch[1] : null;
      const name = iconMatch ? titleText.slice(iconMatch[0].length).trim() : titleText;

      currentGroup = { icon, name, description: '', tags: [], links: [] };
      sections[currentSection].groups.push(currentGroup);
      continue;
    }

    // Tags line (e.g., "Tags: RSS, Podcasts, Validation")
    if (currentGroup) {
      const tagsMatch = line.match(/^Tags:\s*(.+)$/i);
      if (tagsMatch) {
        currentGroup.tags = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
        continue;
      }
    }

    // Markdown link inside a list item
    if (/^-\s+\[/.test(line)) {
      const match = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (match) {
        const link = { name: match[1], url: match[2] };
        if (currentGroup) {
          currentGroup.links.push(link);
        } else {
          sections[currentSection].links.push(link);
        }
      }
      continue;
    }

    // Plain text line = description for current group
    if (currentGroup && line && !line.startsWith('#') && !line.startsWith('-')) {
      if (!currentGroup.description) {
        currentGroup.description = line;
      }
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Render HTML — card layout for home page
// ---------------------------------------------------------------------------
function renderCardSection(groups) {
  const cards = groups.map(group => {
    const parts = [];
    parts.push('        <div class="tool-card tool-card--external">');
    parts.push('          <span class="external-badge" aria-label="External tool">External &#8599;</span>');

    if (group.icon) {
      parts.push(`          <span class="tool-icon" aria-hidden="true">${group.icon}</span>`);
    }

    parts.push(`          <h3 class="tool-name">${group.name}</h3>`);

    if (group.description) {
      parts.push(`          <p class="tool-description">${group.description}</p>`);
    }

    if (group.links.length > 0) {
      parts.push('          <div class="tool-card-links">');
      for (const l of group.links) {
        parts.push(`            <a href="${l.url}" target="_blank" rel="noopener">${l.name} <span class="external-arrow" aria-hidden="true">&#8599;</span></a>`);
      }
      parts.push('          </div>');
    }

    if (group.tags.length > 0) {
      parts.push('          <div class="tool-tags">');
      for (const t of group.tags) {
        parts.push(`            <span class="tool-tag">${t}</span>`);
      }
      parts.push('          </div>');
    }

    parts.push('        </div>');
    return parts.join('\n');
  }).join('\n\n');

  return [
    '      <section class="suggested-tools">',
    '        <h2 class="section-heading">Suggested Tools</h2>',
    '        <div class="tools-grid suggested-grid">',
    cards,
    '        </div>',
    '      </section>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Render HTML — simple list fallback (home page without groups)
// ---------------------------------------------------------------------------
function renderListSection(tools) {
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

// ---------------------------------------------------------------------------
// Render HTML — home page section (cards or list)
// ---------------------------------------------------------------------------
function renderSection(section) {
  if (section.groups && section.groups.length > 0) {
    return renderCardSection(section.groups);
  }
  if (section.links && section.links.length > 0) {
    return renderListSection(section.links);
  }
  return '';
}

// ---------------------------------------------------------------------------
// Render HTML — inline links for tool sub-pages
// ---------------------------------------------------------------------------
function renderInline(section) {
  // Collect all links from both groups and flat links
  const allLinks = [...section.links];
  for (const group of section.groups) {
    allLinks.push(...group.links);
  }
  if (allLinks.length === 0) return '';
  return allLinks
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
  const section = sections[key];
  if (!section || (section.groups.length === 0 && section.links.length === 0)) {
    console.log(`  skip  ${config.file} (no tools listed under "${key}")`);
    continue;
  }

  const filePath = path.join(ROOT, config.file);
  const html = fs.readFileSync(filePath, 'utf-8');

  const rendered = config.mode === 'section'
    ? renderSection(section)
    : renderInline(section);

  const result = inject(html, rendered);
  if (result === null) {
    console.error(`  ERROR  ${config.file}: missing ${START} / ${END} markers`);
    process.exit(1);
  }

  const toolCount = section.groups.length + section.links.length;
  fs.writeFileSync(filePath, result, 'utf-8');
  console.log(`  wrote  ${config.file} (${toolCount} entries)`);
  changed++;
}

console.log(`\nDone — updated ${changed} file(s).`);
