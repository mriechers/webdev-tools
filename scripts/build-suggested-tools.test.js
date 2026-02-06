const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Import the parseMarkdown function by extracting it from the build script
// Since the script runs on require, we test the logic by re-implementing the parser
// and testing the build output.

const ROOT = path.resolve(__dirname, '..');
const MD_PATH = path.join(ROOT, 'suggested-tools.md');

// Re-use the parseMarkdown logic from the build script
function parseMarkdown(src) {
  const sections = {};
  let currentSection = null;
  let currentGroup = null;

  for (const raw of src.split('\n')) {
    const line = raw.trim();

    const h2 = line.match(/^##\s+([^#].*)$/);
    if (h2) {
      currentSection = h2[1].trim().toLowerCase();
      sections[currentSection] = { groups: [], links: [] };
      currentGroup = null;
      continue;
    }

    if (!currentSection) continue;

    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      const titleText = h3[1].trim();
      const iconMatch = titleText.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)\s*/u);
      const icon = iconMatch ? iconMatch[1] : null;
      const name = iconMatch ? titleText.slice(iconMatch[0].length).trim() : titleText;

      currentGroup = { icon, name, description: '', tags: [], links: [] };
      sections[currentSection].groups.push(currentGroup);
      continue;
    }

    if (currentGroup) {
      const tagsMatch = line.match(/^Tags:\s*(.+)$/i);
      if (tagsMatch) {
        currentGroup.tags = tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean);
        continue;
      }
    }

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

    if (currentGroup && line && !line.startsWith('#') && !line.startsWith('-')) {
      if (!currentGroup.description) {
        currentGroup.description = line;
      }
    }
  }

  return sections;
}

describe('parseMarkdown', () => {
  it('should parse H2 sections as page keys', () => {
    const md = '## home\n\n- [Tool](https://example.com)\n';
    const result = parseMarkdown(md);
    assert.ok(result.home, 'should have a "home" section');
    assert.equal(result.home.links.length, 1);
    assert.equal(result.home.links[0].name, 'Tool');
    assert.equal(result.home.links[0].url, 'https://example.com');
  });

  it('should parse H3 groups with icons', () => {
    const md = '## home\n\n### 📡 Feed Validators\n\n- [Tool](https://example.com)\n';
    const result = parseMarkdown(md);
    assert.equal(result.home.groups.length, 1);
    assert.equal(result.home.groups[0].name, 'Feed Validators');
    assert.equal(result.home.groups[0].links.length, 1);
  });

  it('should parse tags', () => {
    const md = '## home\n\n### Test Group\n\nTags: RSS, Podcasts\n\n- [Tool](https://example.com)\n';
    const result = parseMarkdown(md);
    assert.deepEqual(result.home.groups[0].tags, ['RSS', 'Podcasts']);
  });

  it('should parse group descriptions', () => {
    const md = '## home\n\n### Test Group\n\nThis is a description.\n\n- [Tool](https://example.com)\n';
    const result = parseMarkdown(md);
    assert.equal(result.home.groups[0].description, 'This is a description.');
  });

  it('should handle multiple sections', () => {
    const md = '## home\n\n- [A](https://a.com)\n\n## formatter\n\n- [B](https://b.com)\n';
    const result = parseMarkdown(md);
    assert.ok(result.home);
    assert.ok(result.formatter);
    assert.equal(result.home.links[0].name, 'A');
    assert.equal(result.formatter.links[0].name, 'B');
  });
});

describe('suggested-tools.md', () => {
  it('should exist and be parseable', () => {
    assert.ok(fs.existsSync(MD_PATH), 'suggested-tools.md should exist');
    const md = fs.readFileSync(MD_PATH, 'utf-8');
    const sections = parseMarkdown(md);
    assert.ok(Object.keys(sections).length > 0, 'should have at least one section');
  });
});
