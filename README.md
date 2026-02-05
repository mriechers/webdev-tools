# Web Tools

A collection of lightweight, client-side web tools. No dependencies, no build step, no tracking — everything runs in your browser.

**Live at:** [tools.bymarkriechers.com](https://tools.bymarkriechers.com)

## Tools

### [OG Image Preview](/og-image/)

See how your Open Graph images will appear across 12+ social platforms before you publish. Validates meta tags, checks image dimensions, and provides copy-paste suggestions for fixing issues.

### [HTML Formatter & Tidy](/formatter/)

Beautify, format, and clean up messy HTML. Configurable indentation, attribute tidying, tag normalization, minification, and live preview.

## Architecture

```
/
├── index.html              # Landing page
├── og-image/               # OG Image Preview tool
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── platforms.json
│   └── functions/          # Optional CORS proxy
├── formatter/              # HTML Formatter tool
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── README.md
```

## Design Principles

- **Zero dependencies** — no npm, no frameworks, no build step
- **Client-side only** — all processing happens in your browser
- **Dark/light theme** — follows OS preference automatically
- **Accessible** — semantic HTML, keyboard navigation, screen reader friendly
- **Mobile responsive** — works on any device

## Local Development

Open any `index.html` directly in a browser, or use a local server:

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .
```

## Deployment

Push to GitHub and enable GitHub Pages. Set your custom domain in the repo settings and update the CNAME file.
