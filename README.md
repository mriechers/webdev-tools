# Web Tools

A growing collection of browser-based utilities for web developers. Zero dependencies, no tracking, no server-side processing — everything runs locally in your browser.

**Live at:** [tools.bymarkriechers.com](https://tools.bymarkriechers.com)

---

## Tools

### [OG Image Preview](https://tools.bymarkriechers.com/og-image/)

Preview how your Open Graph images will appear across 12+ social platforms before you publish.

- **Platform previews** for Facebook, X/Twitter, LinkedIn, Bluesky, Discord, Slack, iMessage, WhatsApp, Mastodon, Threads, Telegram, and Reddit
- **Visual warnings** for missing tags, undersized images, and incorrect aspect ratios
- **Meta tag validation** with copy-paste suggestions for fixing issues
- **Shareable URLs** — append `?url=https://example.com` to share a preview
- **Platform debug tool links** for forcing cache refreshes

### [HTML Formatter & Tidy](https://tools.bymarkriechers.com/formatter/)

Beautify, format, and clean up messy or minified HTML instantly.

- **Configurable indentation** — 2 spaces, 4 spaces, or tabs
- **Tag normalization** — lowercase tags and attributes, quote unquoted values
- **Attribute tidying** — sort alphabetically, remove empty attributes
- **Minification** — strip all unnecessary whitespace
- **Live preview** — see rendered HTML in a sandboxed iframe
- **Stats** — input/output size comparison, tag count, issues fixed

---

## Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Zero dependencies** | No npm, no frameworks, no build step — just HTML, CSS, and vanilla JavaScript |
| **Privacy first** | All processing happens in your browser; nothing is sent to any server |
| **Accessible** | Semantic HTML, ARIA labels, keyboard navigation, screen reader friendly |
| **Themeable** | Dark/light mode follows your OS preference automatically |
| **Mobile ready** | Responsive layouts work on any screen size |

---

## Project Structure

```
/
├── index.html                  # Landing page
├── CNAME                       # Custom domain config
├── README.md                   # This file
├── suggested-tools.md          # External tool links (source of truth)
│
├── scripts/
│   └── build-suggested-tools.js  # Parses suggested-tools.md → injects HTML
│
├── .github/workflows/
│   └── build-suggested-tools.yml # Auto-rebuilds on push to suggested-tools.md
│
├── og-image/                   # OG Image Preview
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── platforms.json          # Platform specifications
│   ├── example.html            # Demo page with perfect OG setup
│   └── functions/
│       └── fetch-meta.js       # Optional Cloudflare Worker proxy
│
└── formatter/                  # HTML Formatter & Tidy
    ├── index.html
    ├── styles.css
    ├── app.mjs                 # ES module — pipeline, cleaners, DOM wiring
    └── tests/                  # node --test, linkedom DOMParser shim
```

Each tool is self-contained in its own directory with its own `index.html`, making it easy to develop, test, and deploy independently.

---

## Local Development

No build step required. Open any `index.html` directly in a browser, or use a local server for full functionality:

```bash
# Python
python3 -m http.server 8080

# Node.js (npx, no install needed)
npx serve .

# PHP
php -S localhost:8080
```

Then visit `http://localhost:8080`.

---

## Deployment

This repo is configured for GitHub Pages with a custom domain.

1. Push to GitHub
2. Enable Pages in repo settings (Settings → Pages → Source: branch)
3. Set custom domain to `tools.bymarkriechers.com`
4. Add DNS CNAME record: `tools` → `your-username.github.io`

---

## Adding External Tools

External tools are third-party links that appear in the "Suggested Tools" sections across the site. They are managed through a single markdown file and automatically injected into the HTML pages.

### How it works

1. **`suggested-tools.md`** is the source of truth. Each `##` section maps to a page (`home`, `formatter`, `og-image`).
2. **`scripts/build-suggested-tools.js`** parses the markdown and injects the generated HTML between `<!-- SUGGESTED_TOOLS_START -->` / `<!-- SUGGESTED_TOOLS_END -->` markers in each page.
3. A **GitHub Action** runs the build script automatically whenever `suggested-tools.md` is pushed.

### Adding a new external tool link

1. Open `suggested-tools.md`
2. Add a standard markdown link under the page section(s) where it should appear:

   ```markdown
   ## home

   - [My New Tool](https://example.com/)
   ```

   Add the link to multiple sections if it's relevant to more than one page.

3. Rebuild the HTML — pick one:
   - **Locally:** run `node scripts/build-suggested-tools.js`
   - **Automatically:** push `suggested-tools.md` to GitHub and the Action handles it

### Adding a new page to the build

If you create a new tool page and want it to receive its own suggested-tools list:

1. Add `<!-- SUGGESTED_TOOLS_START -->` and `<!-- SUGGESTED_TOOLS_END -->` markers to the page's HTML
2. Register the page in `scripts/build-suggested-tools.js` by adding an entry to `PAGE_MAP`:

   ```javascript
   const PAGE_MAP = {
     home:        { file: 'index.html',            mode: 'section' },
     formatter:   { file: 'formatter/index.html',   mode: 'inline' },
     'og-image':  { file: 'og-image/index.html',    mode: 'inline' },
     'new-tool':  { file: 'new-tool/index.html',    mode: 'inline' },
   };
   ```

   - `section` mode renders a full `<section>` with a heading (used on the home page)
   - `inline` mode renders links separated by `·` (used in tool page footers)

3. Add a matching `## new-tool` section with links in `suggested-tools.md`
4. Update the GitHub Action's commit step in `.github/workflows/build-suggested-tools.yml` to include the new file in `git add`

---

## Contributing

Want to add a new tool? Each tool should:

1. Live in its own `/tool-name/` directory
2. Use the same CSS custom properties for consistent theming
3. Work entirely client-side (no server dependencies beyond optional CORS proxies)
4. Be accessible and mobile-responsive

---

## License

MIT
