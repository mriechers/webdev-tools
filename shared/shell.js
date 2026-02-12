/**
 * Shared Shell — Web Components + Keyboard Nav + A11y Preferences
 * ===============================================================
 * Defines <shell-header> and <shell-footer> custom elements,
 * vim-style keyboard shortcuts, a shortcuts modal, and
 * accessibility preferences (text size, high contrast).
 *
 * Security note: All innerHTML usage in this file is populated
 * exclusively from hardcoded constants (NAV_ITEMS, SHORTCUTS).
 * No user-supplied data is interpolated into HTML strings.
 *
 * Usage:
 *   <script src="../shared/shell.js" type="module"></script>
 *   <shell-header current="formatter"></shell-header>
 *   <shell-footer></shell-footer>
 */

// ── Nav items: single source of truth ──────────────────────────
const NAV_ITEMS = [
  { id: 'home', label: 'Home', href: '/' },
  { id: 'og-image', label: 'OG Image Preview', href: '/og-image/' },
  { id: 'formatter', label: 'HTML Formatter', href: '/formatter/' },
];

// ── Relative path helper ───────────────────────────────────────
// When served from subdirectories, we need relative paths.
// Detect depth from the page's own path.
function resolveHref(href, baseEl) {
  // If we're at /formatter/index.html, prefix = '../'
  // If we're at /index.html, prefix = './'
  const depth = (baseEl.ownerDocument.location.pathname.match(/\//g) || []).length - 1;
  const prefix = depth > 0 ? '../'.repeat(depth) : './';

  if (href === '/') return prefix;
  // Strip leading slash, keep trailing slash
  return prefix + href.replace(/^\//, '');
}

// ── Keyboard shortcuts ─────────────────────────────────────────
const SHORTCUTS = [
  { keys: 'g h', label: 'Go to Home', action: () => navigateTo('home') },
  { keys: 'g o', label: 'Go to OG Image Preview', action: () => navigateTo('og-image') },
  { keys: 'g f', label: 'Go to HTML Formatter', action: () => navigateTo('formatter') },
  { keys: '?', label: 'Show keyboard shortcuts', action: () => toggleShortcutsModal() },
];

function navigateTo(id) {
  const item = NAV_ITEMS.find(n => n.id === id);
  if (!item) return;
  const depth = (window.location.pathname.match(/\//g) || []).length - 1;
  const prefix = depth > 0 ? '../'.repeat(depth) : './';
  const resolved = item.href === '/' ? prefix : prefix + item.href.replace(/^\//, '');
  window.location.href = resolved;
}

function toggleShortcutsModal() {
  const dialog = document.getElementById('shell-shortcuts-dialog');
  if (!dialog) return;
  if (dialog.open) {
    dialog.close();
  } else {
    dialog.showModal();
  }
}

// ── Two-key sequence handler ───────────────────────────────────
let pendingKey = null;
let pendingTimer = null;

function isInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

document.addEventListener('keydown', (e) => {
  if (isInputFocused()) return;
  // Don't intercept modified keys
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key.toLowerCase();

  if (pendingKey) {
    const combo = `${pendingKey} ${key}`;
    clearTimeout(pendingTimer);
    pendingKey = null;

    const shortcut = SHORTCUTS.find(s => s.keys === combo);
    if (shortcut) {
      e.preventDefault();
      shortcut.action();
      return;
    }
  }

  // Check for single-key shortcuts
  const single = SHORTCUTS.find(s => s.keys === key);
  if (single) {
    e.preventDefault();
    single.action();
    return;
  }

  // Check if this could be the start of a two-key combo
  const couldBePrefix = SHORTCUTS.some(s => s.keys.startsWith(key + ' '));
  if (couldBePrefix) {
    pendingKey = key;
    pendingTimer = setTimeout(() => { pendingKey = null; }, 800);
  }
});

// ── A11y Preferences ───────────────────────────────────────────
const PREFS_KEY = 'shell_a11y_prefs';

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function applyPrefs() {
  const prefs = loadPrefs();

  // Text scale
  if (prefs.textScale && prefs.textScale !== 'default') {
    document.documentElement.setAttribute('data-text-scale', prefs.textScale);
  } else {
    document.documentElement.removeAttribute('data-text-scale');
  }

  // High contrast
  if (prefs.highContrast) {
    document.documentElement.classList.add('high-contrast');
  } else {
    document.documentElement.classList.remove('high-contrast');
  }
}

// Apply immediately on load
applyPrefs();

// ── Helper: create element with attributes and children ────────
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'textContent') { node.textContent = v; continue; }
    if (k === 'className') { node.className = v; continue; }
    node.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') {
      node.appendChild(document.createTextNode(child));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

// ── <shell-header> Custom Element ──────────────────────────────
class ShellHeader extends HTMLElement {
  connectedCallback() {
    const current = this.getAttribute('current') || '';
    this.classList.add('shell-header');
    this.setAttribute('role', 'banner');

    const rootHref = resolveHref('/', this);

    // Skip link
    const skipLink = el('a', { href: '#main-content', className: 'shell-skip-link', textContent: 'Skip to content' });

    // Logo
    const logoImg = el('img', { src: rootHref + 'assets/images/logo-small.png', alt: '', className: 'shell-logo-img' });
    const logoText = el('span', { textContent: 'Web Tools' });
    const logo = el('a', { href: rootHref, className: 'shell-logo' }, [logoImg, logoText]);

    // Nav
    const nav = el('nav', { className: 'shell-nav', 'aria-label': 'Main navigation' });
    for (const item of NAV_ITEMS) {
      const href = resolveHref(item.href, this);
      const link = el('a', { href, textContent: item.label });
      if (item.id === current) link.setAttribute('aria-current', 'page');
      nav.appendChild(link);
    }

    // Prefs button
    const prefsBtn = el('button', {
      type: 'button',
      className: 'shell-icon-btn',
      id: 'shell-prefs-btn',
      'aria-label': 'Accessibility preferences',
      'aria-expanded': 'false',
      title: 'Preferences',
      textContent: '\u2699', // ⚙
    });

    // Prefs panel
    const prefsPanel = el('div', { className: 'shell-prefs-panel', id: 'shell-prefs-panel', hidden: '' });

    const prefsTitle = el('div', { className: 'shell-prefs-title', textContent: 'Preferences' });

    // Text size row
    const textSizeLabel = el('span', { className: 'shell-prefs-label', textContent: 'Text size' });
    const textSizeSelect = el('select', { className: 'shell-prefs-select', id: 'shell-text-scale' }, [
      el('option', { value: 'default', textContent: 'Default' }),
      el('option', { value: 'large', textContent: 'Large' }),
      el('option', { value: 'larger', textContent: 'Larger' }),
    ]);
    const textSizeRow = el('div', { className: 'shell-prefs-row' }, [textSizeLabel, textSizeSelect]);

    // High contrast row
    const hcLabel = el('span', { className: 'shell-prefs-label', textContent: 'High contrast' });
    const hcInput = el('input', { type: 'checkbox', id: 'shell-high-contrast' });
    const hcSlider = el('span', { className: 'shell-toggle-slider' });
    const hcToggle = el('label', { className: 'shell-toggle' }, [hcInput, hcSlider]);
    const hcRow = el('div', { className: 'shell-prefs-row' }, [hcLabel, hcToggle]);

    prefsPanel.append(prefsTitle, textSizeRow, hcRow);

    const actionsWrap = el('div', { className: 'shell-header-actions', style: 'position: relative;' }, [prefsBtn, prefsPanel]);

    // Header inner
    const inner = el('div', { className: 'shell-header-inner' }, [logo, nav, actionsWrap]);

    this.append(skipLink, inner);

    this._setupPrefs();
    this._setupPrefsPanel();
  }

  _setupPrefs() {
    const prefs = loadPrefs();
    const scaleSelect = this.querySelector('#shell-text-scale');
    const contrastToggle = this.querySelector('#shell-high-contrast');

    if (scaleSelect) {
      scaleSelect.value = prefs.textScale || 'default';
      scaleSelect.addEventListener('change', () => {
        const p = loadPrefs();
        p.textScale = scaleSelect.value;
        savePrefs(p);
        applyPrefs();
      });
    }

    if (contrastToggle) {
      contrastToggle.checked = !!prefs.highContrast;
      contrastToggle.addEventListener('change', () => {
        const p = loadPrefs();
        p.highContrast = contrastToggle.checked;
        savePrefs(p);
        applyPrefs();
      });
    }
  }

  _setupPrefsPanel() {
    const btn = this.querySelector('#shell-prefs-btn');
    const panel = this.querySelector('#shell-prefs-panel');
    if (!btn || !panel) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !panel.hidden;
      panel.hidden = isOpen;
      btn.setAttribute('aria-expanded', String(!isOpen));
    });

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) {
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) {
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        btn.focus();
      }
    });
  }
}

// ── <shell-footer> Custom Element ──────────────────────────────
class ShellFooter extends HTMLElement {
  connectedCallback() {
    this.classList.add('shell-footer');
    this.setAttribute('role', 'contentinfo');

    const rootHref = resolveHref('/', this);

    const logo = el('img', { src: rootHref + 'assets/images/logo-small.png', alt: '', className: 'shell-footer-logo' });
    const msg = document.createTextNode('All tools run locally in your browser');
    const left = el('div', { className: 'shell-footer-left' }, [logo, msg]);

    const ghLink = el('a', { href: 'https://github.com/MarkOnFire/og-image-test', target: '_blank', rel: 'noopener', textContent: 'Source on GitHub' });
    const right = el('div', {}, [ghLink]);

    const inner = el('div', { className: 'shell-footer-inner' }, [left, right]);
    this.appendChild(inner);
  }
}

// ── Register custom elements ───────────────────────────────────
customElements.define('shell-header', ShellHeader);
customElements.define('shell-footer', ShellFooter);

// ── Shortcuts dialog (appended to body via DOM APIs) ───────────
function createShortcutsDialog() {
  if (document.getElementById('shell-shortcuts-dialog')) return;

  const dialog = el('dialog', { id: 'shell-shortcuts-dialog', className: 'shell-dialog' });
  const heading = el('h2', { textContent: 'Keyboard Shortcuts' });
  const list = el('ul', { className: 'shell-shortcuts-list' });

  for (const s of SHORTCUTS) {
    const labelSpan = el('span', { textContent: s.label });
    const keysContainer = document.createDocumentFragment();
    for (const k of s.keys.split(' ')) {
      keysContainer.appendChild(el('kbd', { className: 'shell-kbd', textContent: k }));
      keysContainer.appendChild(document.createTextNode(' '));
    }
    const li = el('li', {}, [labelSpan, keysContainer]);
    list.appendChild(li);
  }

  const closeBtn = el('button', { type: 'button', className: 'shell-dialog-close', textContent: 'Close' });
  closeBtn.addEventListener('click', () => dialog.close());

  dialog.append(heading, list, closeBtn);
  document.body.appendChild(dialog);

  // Close on clicking the backdrop
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

// Wait for DOM then create the dialog
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createShortcutsDialog);
} else {
  createShortcutsDialog();
}

// ── Optional: Branding loader ──────────────────────────────────
// Template users can place branding.json at the root to customize
// the accent color and app name. Silently skipped if not found.
(async function loadBranding() {
  try {
    const depth = (window.location.pathname.match(/\//g) || []).length - 1;
    const prefix = depth > 0 ? '../'.repeat(depth) : './';
    const res = await fetch(prefix + 'branding.json');
    if (!res.ok) return;
    const branding = await res.json();
    const root = document.documentElement.style;
    if (branding.primaryColor) root.setProperty('--color-primary', branding.primaryColor);
    if (branding.primaryHoverColor) root.setProperty('--color-primary-hover', branding.primaryHoverColor);
    if (branding.appName) {
      const logoText = document.querySelector('.shell-logo span');
      if (logoText) logoText.textContent = branding.appName;
    }
  } catch {
    // Silently skip — branding.json is optional
  }
})();
