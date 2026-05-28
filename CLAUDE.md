# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Non-Claude Agents: Workspace Isolation Rules

**If you are NOT Claude Code** (e.g., Gemini CLI, Codex, Copilot, Cursor, or any other LLM agent), you MUST follow these isolation rules to avoid interfering with Claude agent work:

1. **Always work in a git worktree.** Never modify files on the current branch directly. Create a worktree before making any changes:
   ```bash
   git worktree add .worktrees/<your-agent-name>-<feature> -b <your-agent-name>/<feature-description>
   ```
2. **Always commit to a feature branch.** Your branch name must include your agent identifier (e.g., `gemini/fix-typo`, `codex/add-tests`, `copilot/refactor-utils`). Never commit to `main` or any branch you did not create.
3. **Never force-push, rebase, or modify branches you did not create.** Treat all existing branches as read-only references.
4. **Clean up after yourself.** When your work is complete, leave the worktree in place for human review. Do not merge your own branches.
5. **Follow all other rules in this file.** The conventions below (commit format, secrets management, attribution, etc.) apply to all agents equally.

> Claude Code agents are exempt from the worktree requirement because they are the primary agents for this workspace and coordinate directly with the user.


## Project Overview

A collection of browser-based web developer utilities at [tools.bymarkriechers.com](https://tools.bymarkriechers.com). Zero dependencies, no frameworks, no build step — pure HTML/CSS/vanilla JS deployed directly to GitHub Pages.

## Commands

```bash
# Local development — no build step, just serve files
npx serve .
# or: python3 -m http.server 8080

# Lint (install deps first if node_modules missing)
npm install && npx eslint .

# Rebuild suggested-tools HTML from markdown source
node scripts/build-suggested-tools.js

# Tests — Node.js built-in test runner, uses linkedom for DOMParser shim
npm test
```

## Architecture

### Shared Shell (`/shared/`)

All pages share a common shell providing navigation, keyboard shortcuts, accessibility preferences, and design tokens.

- **`shell.css`** — Design tokens (CSS custom properties), reset, dark/light/high-contrast themes, shell layout, a11y preference styles. Imported first by every page before tool-specific CSS.
- **`shell.js`** — Custom elements `<shell-header>` and `<shell-footer>`, keyboard shortcut handler (vim-style `g h`, `g o`, `g f`, `?`), a11y preferences panel, branding loader. Loaded as `type="module"`.
- **`NAV_ITEMS` array** in shell.js is the single source of truth for navigation.
- **`resolveHref()`** computes relative paths based on page depth for GitHub Pages subdirectory compatibility.
- **A11y prefs** stored in `localStorage` key `shell_a11y_prefs` (text scale, high contrast). Applied via `data-text-scale` attribute and `.high-contrast` class on `<html>`.

### Tool Structure

Each tool lives in its own directory with a consistent pattern:
```
/tool-name/
├── index.html    # Semantic HTML with shell-header/shell-footer elements
├── styles.css    # Tool-specific styles (shell.css tokens used throughout)
└── app.js        # Self-contained vanilla JS logic
```

### Current Tools

- **`/formatter/`** — HTML Formatter & Tidy. Pipeline: tokenize → indent (two-stage) → tidy → compress. Tidy dropdown is organized into three groups: **Formatting** (lowercase/sort/quote — our extras), **Cleaning (prettyhtml.com)** (the 10 options 1-for-1 with prettyhtml.com — Inline styles, Classes & IDs, Empty tags, Tags with 1 space, Successive spaces, Comments, Tag attributes, To plain text, AI Watermarks, Smart &nbsp;s; first 6 ON by default), and **Extras** (data-attrs, span-unwrap, etc.). Literal ports of `removeTagAttributes`, `aiWatermarkFixer`, and `smartNbsps` live in `formatter/app.mjs` (ES module). Tests in `formatter/tests/*.test.mjs` run via `npm test` (uses `linkedom` as DOMParser shim in Node). Options in `localStorage` key `htmlTidy_options`. See `planning/2026-05-27-prettyhtml-parity.md` for the algorithm snapshot / insurance documentation.
- **`/og-image/`** — OG Image Preview. Platform specs in `platforms.json`. Optional Cloudflare Worker CORS proxy in `functions/fetch-meta.js`. Fallback proxies for CORS.

### Suggested Tools System

External tool links managed through a single markdown file:
1. **`suggested-tools.md`** — source of truth, `##` sections map to pages
2. **`scripts/build-suggested-tools.js`** — parses markdown, injects HTML between `<!-- SUGGESTED_TOOLS_START/END -->` markers
3. **GitHub Action** auto-rebuilds on push to `suggested-tools.md`
4. **`PAGE_MAP`** in the build script controls which pages receive tools and rendering mode (`section` for home, `inline` for tool pages)

## Key Conventions

- **No frameworks, no npm runtime deps** — everything client-side, vanilla JS
- **CSS custom properties** from `shell.css` for all theming (colors, spacing, typography, editor metrics)
- **Dark/light themes** via `prefers-color-scheme` media queries; high contrast via `.high-contrast` class
- **All pages must**: import `shell.css` first, use `<shell-header current="toolname">` and `<shell-footer>`, wrap content in `<main id="main-content" class="shell-main">`, load `shell.js` as module
- **localStorage keys** are prefixed per feature (`shell_a11y_prefs`, `htmlTidy_options`)
- **`SUGGESTED_TOOLS_START/END` markers** must be preserved in all HTML files for the build script

## ESLint

Flat config (ESLint 9+). Targets browser globals for tool app.js files, Node globals for scripts, and worker globals for Cloudflare functions. Unused vars error with `caughtErrors: 'none'` and `argsIgnorePattern: '^_'`.

## Adding a New Tool

1. Create `/tool-name/` with `index.html`, `styles.css`, `app.js`
2. Import `../shared/shell.css` before tool CSS; load `../shared/shell.js` as module
3. Add `<shell-header current="tool-name">` and `<shell-footer>` elements
4. Add entry to `NAV_ITEMS` in `shell.js` and keyboard shortcut
5. Add `SUGGESTED_TOOLS_START/END` markers and register in `PAGE_MAP` in `build-suggested-tools.js`
6. Update the GitHub Action's `git add` step to include the new file
