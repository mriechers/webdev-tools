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
    └── app.js
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

## Contributing

Want to add a new tool? Each tool should:

1. Live in its own `/tool-name/` directory
2. Use the same CSS custom properties for consistent theming
3. Work entirely client-side (no server dependencies beyond optional CORS proxies)
4. Be accessible and mobile-responsive

---

## License

MIT
