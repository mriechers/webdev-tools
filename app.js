/**
 * OG Image Preview Tool — Main Application Logic
 * ================================================
 *
 * This file contains all the client-side JavaScript for the tool.
 * No build step, no framework, no module bundler — just plain ES6+.
 *
 * Architecture overview:
 * 1. Fetch HTML from a target URL via a CORS proxy
 * 2. Parse OG (and twitter:*) meta tags from the HTML
 * 3. Load platform specs from platforms.json
 * 4. Render a preview card for each platform showing how the link would appear
 * 5. Add warnings for missing/suboptimal tags and dimensions
 *
 * Why a CORS proxy?
 * -----------------
 * Browsers enforce the Same-Origin Policy: JavaScript on our GitHub Pages site
 * cannot fetch HTML from a different domain. We use a free public CORS proxy
 * (allOrigins by default) to relay the request. This is the simplest approach
 * that doesn't require the user to deploy any infrastructure.
 *
 * Alternative approaches considered:
 * - Serverless function (Cloudflare Worker): More reliable, but requires the
 *   user to set up and deploy a Worker. Included in /functions/ as an option.
 * - Third-party API (microlink.io, opengraph.io): Structured JSON responses,
 *   but adds dependency on a third-party service that could change pricing or
 *   shut down. Not used as the default.
 * - Browser extension: Could bypass CORS entirely, but limits the audience to
 *   extension-installing users. Not practical for a public web tool.
 */

/* ============================================================
   CONFIGURATION
   Central place for URLs, defaults, and feature flags.
   ============================================================ */

/**
 * CORS proxy configurations.
 * Each proxy has a different URL pattern for wrapping the target URL.
 * We define a builder function for each that takes a target URL and
 * returns the full proxy URL to fetch.
 */
const PROXY_CONFIG = {
  allorigins: {
    name: 'allOrigins',
    buildUrl: (targetUrl) =>
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    // allOrigins returns raw HTML when using /raw endpoint
    parseResponse: (response) => response.text(),
  },
  corsproxy: {
    name: 'corsproxy.io',
    buildUrl: (targetUrl) =>
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
    parseResponse: (response) => response.text(),
  },
  custom: {
    name: 'Custom',
    // Custom URL is set dynamically from the input field
    buildUrl: (targetUrl) => {
      const base = document.getElementById('custom-proxy-url')?.value || '';
      // Support both "?url=" and bare endpoint patterns
      if (base.includes('?')) {
        return `${base}${encodeURIComponent(targetUrl)}`;
      }
      return `${base}?url=${encodeURIComponent(targetUrl)}`;
    },
    parseResponse: (response) => response.text(),
  },
};

/**
 * Timeout for fetch requests in milliseconds.
 * 15 seconds is generous — most pages load in 2-3 seconds,
 * but some slow servers or large pages need more time.
 */
const FETCH_TIMEOUT_MS = 15000;

/**
 * The set of OG and social meta tags we look for.
 * This is the "master list" — not all sites will have all of these.
 * Tags are checked in order, and the first match wins for properties
 * like og:image where only one value is used.
 */
const META_TAGS_TO_FIND = [
  // Core OG tags (the universal standard)
  'og:title',
  'og:description',
  'og:image',
  'og:image:width',
  'og:image:height',
  'og:image:alt',
  'og:image:type',
  'og:url',
  'og:type',
  'og:site_name',

  // Twitter/X-specific tags
  'twitter:card',
  'twitter:title',
  'twitter:description',
  'twitter:image',
  'twitter:image:alt',
  'twitter:site',
  'twitter:creator',

  // Other useful meta
  'theme-color',
  'description', // <meta name="description"> — not OG but commonly used as fallback
];

/* ============================================================
   STATE
   Simple state object — no reactive framework needed for this
   scale of application. We just re-render when state changes.
   ============================================================ */

const state = {
  /** @type {Object|null} Platform specs loaded from platforms.json */
  platformData: null,

  /** @type {Object|null} Parsed meta tags from the current URL */
  metaTags: null,

  /** @type {string|null} The URL currently being previewed */
  currentUrl: null,

  /** @type {boolean} Whether a fetch is in progress */
  loading: false,

  /** @type {{width: number, height: number}|null} Detected image dimensions */
  imageDimensions: null,

  /** @type {boolean} Whether the current result is from a built-in example */
  isExample: false,
};

/* ============================================================
   DOM REFERENCES
   Cache element references once instead of querying repeatedly.
   ============================================================ */

const dom = {
  form: document.getElementById('url-form'),
  urlInput: document.getElementById('url-input'),
  fetchBtn: document.getElementById('fetch-btn'),
  btnLabel: document.querySelector('.btn-label'),
  btnLoading: document.querySelector('.btn-loading'),
  errorSection: document.getElementById('error-section'),
  errorTitle: document.getElementById('error-title'),
  errorDetail: document.getElementById('error-detail'),
  errorDismiss: document.getElementById('error-dismiss'),
  metaSummary: document.getElementById('meta-summary'),
  metaTagsGrid: document.getElementById('meta-tags-grid'),
  previewsSection: document.getElementById('previews-section'),
  previewsGrid: document.getElementById('previews-grid'),
  suggestionsSection: document.getElementById('suggestions-section'),
  suggestionsCode: document.getElementById('suggestions-code'),
  copySuggestions: document.getElementById('copy-suggestions'),
  tierTabs: document.querySelectorAll('.tier-tab'),
  customProxyField: document.getElementById('custom-proxy-field'),
};

/* ============================================================
   INITIALIZATION
   Load platform data and set up event listeners.
   ============================================================ */

async function init() {
  // Load platform specifications from the JSON file
  try {
    const response = await fetch('platforms.json');
    state.platformData = await response.json();
  } catch (err) {
    showError(
      'Failed to load platform data',
      'Could not fetch platforms.json. Make sure the file exists alongside index.html.'
    );
    return;
  }

  // Set up event listeners
  dom.form.addEventListener('submit', handleFormSubmit);
  dom.errorDismiss.addEventListener('click', hideError);
  dom.copySuggestions.addEventListener('click', handleCopySuggestions);

  // Tier filter tabs
  dom.tierTabs.forEach((tab) => {
    tab.addEventListener('click', () => handleTierFilter(tab.dataset.tier));
  });

  // Show/hide custom proxy URL field based on radio selection
  document.querySelectorAll('input[name="proxy"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      dom.customProxyField.hidden = radio.value !== 'custom';
    });
  });

  // Example buttons — load a built-in example page.
  // The example page is same-origin, so no CORS proxy needed.
  document.querySelectorAll('.example-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleExampleClick(btn.dataset.example));
  });

  // Support URL passed as a query parameter (for shareable links)
  // e.g., ?url=https://example.com
  const params = new URLSearchParams(window.location.search);
  const prefilledUrl = params.get('url');
  if (prefilledUrl) {
    dom.urlInput.value = prefilledUrl;
    // Auto-fetch after a short delay so the user sees the UI first
    setTimeout(() => dom.form.requestSubmit(), 300);
  }
}

/* ============================================================
   EVENT HANDLERS
   ============================================================ */

/**
 * Handle form submission: validate URL, fetch HTML, parse tags, render previews.
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  const url = dom.urlInput.value.trim();

  // Basic URL validation — the browser's built-in validation handles format,
  // but we also check for a protocol prefix (common user mistake).
  if (!url) return;

  let normalizedUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    normalizedUrl = 'https://' + url;
    dom.urlInput.value = normalizedUrl;
  }

  // Start the fetch flow
  setLoading(true);
  hideError();
  state.isExample = false;

  try {
    // Step 1: Fetch HTML via the CORS proxy
    const html = await fetchHtml(normalizedUrl);

    // Step 2: Parse meta tags from the HTML
    const tags = parseMetaTags(html, normalizedUrl);
    state.metaTags = tags;
    state.currentUrl = normalizedUrl;

    // Step 3: If an image URL was found, probe its actual dimensions
    // This lets us warn about undersized images.
    if (tags['og:image']) {
      state.imageDimensions = await probeImageDimensions(tags['og:image']);
    } else {
      state.imageDimensions = null;
    }

    // Step 4: Render everything
    renderMetaSummary(tags);
    renderPreviews(tags);
    renderSuggestions(tags);

    // Update the URL bar so the result is shareable
    updateShareableUrl(normalizedUrl);
  } catch (err) {
    handleFetchError(err);
  } finally {
    setLoading(false);
  }
}

/**
 * Handle tier filter tab clicks.
 * Shows/hides preview cards based on the selected tier.
 */
function handleTierFilter(tier) {
  // Update active tab
  dom.tierTabs.forEach((tab) => {
    const isActive = tab.dataset.tier === tier;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive);
  });

  // Show/hide cards
  const cards = dom.previewsGrid.querySelectorAll('.preview-card');
  cards.forEach((card) => {
    if (tier === 'all' || card.dataset.tier === tier) {
      card.style.display = '';
    } else {
      card.style.display = 'none';
    }
  });
}

/**
 * Copy meta tag suggestions to clipboard.
 */
async function handleCopySuggestions() {
  const code = dom.suggestionsCode.textContent;
  try {
    await navigator.clipboard.writeText(code);
    dom.copySuggestions.textContent = 'Copied!';
    setTimeout(() => {
      dom.copySuggestions.textContent = 'Copy to clipboard';
    }, 2000);
  } catch {
    // Fallback for browsers that don't support clipboard API
    const textarea = document.createElement('textarea');
    textarea.value = code;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    dom.copySuggestions.textContent = 'Copied!';
    setTimeout(() => {
      dom.copySuggestions.textContent = 'Copy to clipboard';
    }, 2000);
  }
}

/**
 * Handle click on an example button.
 * Fetches the example page directly (same-origin, no CORS proxy needed)
 * and renders results with educational annotations for each tag.
 *
 * @param {string} exampleId - Which example to load (currently: 'perfect')
 */
async function handleExampleClick(exampleId) {
  // Map example IDs to their HTML file paths.
  // Using a map makes it easy to add more examples later.
  const examples = {
    perfect: {
      file: 'example.html',
      label: 'Perfect OG setup example',
    },
  };

  const example = examples[exampleId];
  if (!example) return;

  setLoading(true);
  hideError();
  state.isExample = true;

  try {
    // Fetch the example page directly — it's hosted alongside us,
    // so it's same-origin and doesn't need a proxy. This also means
    // the example always works, even if all CORS proxies are down.
    const response = await fetch(example.file);
    const html = await response.text();

    // Build the full URL for display purposes
    const exampleUrl = new URL(example.file, window.location.href).href;

    const tags = parseMetaTags(html, exampleUrl);
    state.metaTags = tags;
    state.currentUrl = exampleUrl;

    if (tags['og:image']) {
      state.imageDimensions = await probeImageDimensions(tags['og:image']);
    } else {
      state.imageDimensions = null;
    }

    // Render with educational annotations
    renderMetaSummary(tags);
    renderPreviews(tags);
    renderSuggestions(tags);

    // Put the example URL in the input so it's clear what's being previewed
    dom.urlInput.value = exampleUrl;
  } catch (err) {
    showError(
      'Could not load example',
      'Failed to fetch example.html. Make sure the file exists alongside index.html.'
    );
  } finally {
    setLoading(false);
  }
}

/**
 * Educational explanations for each meta tag.
 * Shown in the meta tag summary when viewing a built-in example,
 * so users can learn what each tag does and why it matters.
 *
 * Each entry maps a tag name to a short explanation string.
 * These are intentionally concise — the example.html page has
 * longer explanations with additional context.
 */
const TAG_EXPLANATIONS = {
  'og:title':
    'The headline shown in link previews. Keep under 60 characters. Use the page title, not your site name.',
  'og:description':
    'Snippet text below the title. Aim for 120-160 characters. Front-load the important information.',
  'og:image':
    'The preview image URL. Must be absolute. 1200x630px at 1.91:1 works across all major platforms.',
  'og:image:width':
    'Tells platforms the image width in pixels without downloading it. Prevents broken or delayed previews.',
  'og:image:height':
    'Tells platforms the image height in pixels. Paired with og:image:width for instant rendering.',
  'og:image:alt':
    'Alt text for the preview image. Critical for screen readers in social feeds.',
  'og:image:type':
    'MIME type (e.g., image/png). Helps platforms handle the image before downloading it.',
  'og:url':
    'Canonical URL for deduplication. Ensures shares via different URLs count as the same content.',
  'og:type':
    'Content type (website, article, video.other). Facebook uses this to show extra fields like publish date.',
  'og:site_name':
    'Your brand name (not the page title). Shown as a label above or below the preview on some platforms.',
  'twitter:card':
    'Controls Twitter layout. "summary_large_image" = large image above text (recommended). "summary" = small square thumbnail.',
  'twitter:title':
    'Overrides og:title on Twitter. Useful when you want a different headline for Twitter vs Facebook.',
  'twitter:description':
    'Overrides og:description on Twitter. Keeps within Twitter\'s ~200 character display limit.',
  'twitter:image':
    'Overrides og:image on Twitter. Use when you want a different image for Twitter specifically.',
  'twitter:image:alt':
    'Alt text for Twitter. 420-character limit enforced by Twitter.',
  'twitter:site':
    'Your publication\'s @username. Shown as "via @site" on some Twitter card layouts.',
  'twitter:creator':
    'The author\'s @username. Useful for multi-author sites where author differs from the site account.',
  'theme-color':
    'Used by Discord to color the embed sidebar, and by some mobile browsers for the address bar.',
  'description':
    'Standard HTML meta description. Not an OG tag, but used as fallback by Slack and search engines.',
};

/* ============================================================
   FETCHING & PARSING
   Core logic for getting HTML and extracting meta tags.
   ============================================================ */

/**
 * Fetch the HTML content of a URL via the selected CORS proxy.
 *
 * @param {string} url - The target URL to fetch
 * @returns {Promise<string>} The HTML content
 * @throws {Error} If the fetch fails or times out
 */
async function fetchHtml(url) {
  // Determine which proxy to use based on the radio selection
  const selectedProxy = document.querySelector('input[name="proxy"]:checked').value;
  const proxy = PROXY_CONFIG[selectedProxy];

  if (!proxy) {
    throw new Error('No proxy selected');
  }

  // For custom proxy, validate that a URL was provided
  if (selectedProxy === 'custom') {
    const customUrl = document.getElementById('custom-proxy-url')?.value;
    if (!customUrl) {
      throw new Error('Please enter a custom proxy URL in the proxy settings below.');
    }
  }

  const proxyUrl = proxy.buildUrl(url);

  // Use AbortController for timeout — this is the modern way to cancel fetches.
  // It's cleaner than Promise.race with a timeout because it actually cancels
  // the network request rather than just ignoring the result.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(proxyUrl, {
      signal: controller.signal,
      headers: {
        // Some proxies pass through the Accept header to the target server.
        // Requesting text/html helps ensure we get the HTML version of the page
        // rather than a JSON API response or other format.
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Map HTTP status codes to user-friendly messages
      if (response.status === 403) {
        throw new Error(
          'BLOCKED: This site blocks external access to its content. ' +
          'Try a different proxy, or use the platform-specific debug tools in the footer.'
        );
      } else if (response.status === 404) {
        throw new Error('NOT_FOUND: The URL returned a 404 (page not found).');
      } else if (response.status === 429) {
        throw new Error(
          'RATE_LIMITED: The CORS proxy is rate-limited. ' +
          'Wait a moment and try again, or switch to a different proxy.'
        );
      } else {
        throw new Error(`HTTP_ERROR: Server returned ${response.status} ${response.statusText}`);
      }
    }

    return await proxy.parseResponse(response);
  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      throw new Error(
        'TIMEOUT: The request took too long. The site may be slow or blocking proxy requests.'
      );
    }

    throw err;
  }
}

/**
 * Parse meta tags from an HTML string.
 *
 * Why DOMParser instead of regex?
 * - DOMParser handles malformed HTML gracefully (browsers are very forgiving)
 * - It correctly handles edge cases like tags in comments, CDATA sections, etc.
 * - Regex-based parsing breaks on multiline attributes, varied quoting, etc.
 * - DOMParser is built into every modern browser — no library needed.
 *
 * @param {string} html - Raw HTML string
 * @param {string} baseUrl - The original URL (used to resolve relative image URLs)
 * @returns {Object} Key-value map of meta tag properties
 */
function parseMetaTags(html, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tags = {};

  // Strategy: look for <meta> tags with property= or name= attributes.
  // OG tags use property="og:..." while Twitter uses name="twitter:..."
  // Some sites incorrectly use name= for OG tags — we handle both.
  const metaElements = doc.querySelectorAll('meta[property], meta[name]');

  metaElements.forEach((el) => {
    const property = el.getAttribute('property') || el.getAttribute('name');
    const content = el.getAttribute('content');

    if (property && content && META_TAGS_TO_FIND.includes(property.toLowerCase())) {
      // Store using lowercase key for consistent lookup
      // Only keep the first value if a tag appears multiple times
      const key = property.toLowerCase();
      if (!tags[key]) {
        tags[key] = content;
      }
    }
  });

  // Also grab the <title> tag as a fallback for og:title
  if (!tags['og:title']) {
    const titleEl = doc.querySelector('title');
    if (titleEl) {
      tags['_fallback:title'] = titleEl.textContent.trim();
    }
  }

  // Resolve relative image URLs to absolute URLs.
  // Some sites use relative paths for og:image (technically against the spec,
  // but it happens often enough that we should handle it).
  const imageUrl = tags['og:image'] || tags['twitter:image'];
  if (imageUrl && !imageUrl.startsWith('http')) {
    try {
      const resolved = new URL(imageUrl, baseUrl).href;
      if (tags['og:image']) tags['og:image'] = resolved;
      if (tags['twitter:image']) tags['twitter:image'] = resolved;
    } catch {
      // If URL resolution fails, leave the original value
      // (it will trigger a warning in the preview)
    }
  }

  return tags;
}

/**
 * Probe an image URL to get its actual pixel dimensions.
 *
 * We create a hidden <img> element and wait for it to load.
 * This lets us warn users when their OG image is too small for
 * certain platforms (e.g., LinkedIn recommends 1200px wide).
 *
 * @param {string} imageUrl - The image URL to probe
 * @returns {Promise<{width: number, height: number}|null>}
 */
function probeImageDimensions(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();

    // Don't let CORS block image loading — we just need dimensions,
    // not pixel data, so crossOrigin isn't needed.
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };

    img.onerror = () => {
      // Image failed to load — might be CORS, might be 404.
      // We resolve null instead of rejecting so the rest of the
      // app can continue without the dimension data.
      resolve(null);
    };

    // Timeout for slow-loading images
    setTimeout(() => resolve(null), 10000);

    img.src = imageUrl;
  });
}

/* ============================================================
   RENDERING — META TAG SUMMARY
   Shows which tags were found and which are missing.
   ============================================================ */

/**
 * Render the meta tag summary section.
 * Shows each tag we looked for, its value (or "missing"), and a status badge.
 *
 * @param {Object} tags - Parsed meta tags
 */
function renderMetaSummary(tags) {
  dom.metaSummary.hidden = false;
  dom.metaTagsGrid.innerHTML = '';

  // Important tags that should always be present
  const importantTags = [
    'og:title',
    'og:description',
    'og:image',
    'og:url',
    'twitter:card',
  ];

  META_TAGS_TO_FIND.forEach((tagName) => {
    const value = tags[tagName];
    const isImportant = importantTags.includes(tagName);

    const row = document.createElement('div');
    row.className = 'meta-tag-row';

    // Tag name
    const nameEl = document.createElement('span');
    nameEl.className = 'meta-tag-name';
    nameEl.textContent = tagName;

    // Tag value or "missing" indicator
    const valueEl = document.createElement('span');
    valueEl.className = 'meta-tag-value';

    // Status badge
    const badge = document.createElement('span');
    badge.className = 'status-badge';

    if (value) {
      // Truncate very long values (like base64 images) for display
      valueEl.textContent = value.length > 120 ? value.substring(0, 120) + '...' : value;

      badge.className += ' ok';
      badge.textContent = '✓ Found';
      badge.setAttribute('aria-label', `${tagName}: found`);
    } else if (isImportant) {
      valueEl.textContent = 'Not set';
      valueEl.className += ' missing';

      badge.className += ' warn';
      badge.textContent = '⚠ Missing';
      badge.setAttribute('aria-label', `${tagName}: missing (recommended)`);
    } else {
      valueEl.textContent = 'Not set';
      valueEl.className += ' missing';

      badge.className += ' ok';
      badge.textContent = '— Optional';
      badge.setAttribute('aria-label', `${tagName}: not set (optional)`);
    }

    row.appendChild(badge);
    row.appendChild(nameEl);
    row.appendChild(valueEl);

    // When viewing a built-in example, show educational explanations
    // for each tag so users learn what they do and why they matter.
    if (state.isExample && TAG_EXPLANATIONS[tagName]) {
      const explainEl = document.createElement('p');
      explainEl.className = 'meta-tag-explain';
      explainEl.textContent = TAG_EXPLANATIONS[tagName];
      row.appendChild(explainEl);
    }

    dom.metaTagsGrid.appendChild(row);
  });
}

/* ============================================================
   RENDERING — PLATFORM PREVIEWS
   Creates a preview card for each platform showing simulated
   link preview rendering.
   ============================================================ */

/**
 * Render preview cards for all platforms.
 *
 * @param {Object} tags - Parsed meta tags
 */
function renderPreviews(tags) {
  dom.previewsSection.hidden = false;
  dom.previewsGrid.innerHTML = '';

  const platforms = state.platformData.platforms;
  const imageUrl = tags['og:image'] || tags['twitter:image'];
  const title =
    tags['og:title'] || tags['twitter:title'] || tags['_fallback:title'] || 'Untitled';
  const description =
    tags['og:description'] || tags['twitter:description'] || tags['description'] || '';
  const siteName = tags['og:site_name'] || '';
  const domain = extractDomain(state.currentUrl);

  platforms.forEach((platform, index) => {
    const card = createPreviewCard(platform, {
      imageUrl,
      title,
      description,
      siteName,
      domain,
      tags,
      index,
    });
    dom.previewsGrid.appendChild(card);
  });
}

/**
 * Create a single platform preview card.
 *
 * @param {Object} platform - Platform spec from platforms.json
 * @param {Object} data - Computed preview data (image, title, etc.)
 * @returns {HTMLElement} The card element
 */
function createPreviewCard(platform, data) {
  const { imageUrl, title, description, siteName, domain, tags, index } = data;
  const warnings = generateWarnings(platform, tags, state.imageDimensions);
  const overallStatus = getOverallStatus(warnings);

  // Create card container
  const card = document.createElement('article');
  card.className = 'preview-card';
  card.dataset.platform = platform.id;
  card.dataset.tier = String(platform.tier);
  card.style.setProperty('--card-index', index);

  // --- Card header ---
  const header = document.createElement('div');
  header.className = 'preview-card-header';

  // Platform icon (SVG inline for each platform)
  const icon = document.createElement('span');
  icon.className = 'platform-icon';
  icon.innerHTML = getPlatformIcon(platform.id);
  icon.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'platform-name';
  name.textContent = platform.name;

  const tierBadge = document.createElement('span');
  tierBadge.className = 'tier-badge';
  tierBadge.textContent = `Tier ${platform.tier}`;

  const statusIcon = document.createElement('span');
  statusIcon.className = 'card-status-icon';
  statusIcon.textContent =
    overallStatus === 'ok' ? '✓' : overallStatus === 'warn' ? '⚠' : '✗';
  statusIcon.setAttribute(
    'aria-label',
    overallStatus === 'ok'
      ? 'All checks passed'
      : overallStatus === 'warn'
      ? 'Warnings detected'
      : 'Errors detected'
  );

  header.appendChild(icon);
  header.appendChild(name);
  header.appendChild(tierBadge);
  header.appendChild(statusIcon);

  // --- Image preview ---
  const imageContainer = document.createElement('div');
  imageContainer.className = 'preview-image-container';

  // Handle Twitter summary card (1:1 ratio) vs summary_large_image (1.91:1)
  if (platform.id === 'twitter') {
    const cardType = tags['twitter:card'] || 'summary';
    if (cardType === 'summary') {
      imageContainer.classList.add('ratio-1-1');
    }
  }

  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'preview-image';
    img.src = imageUrl;
    img.alt = tags['og:image:alt'] || tags['twitter:image:alt'] || `Preview image for ${title}`;
    img.loading = 'lazy';

    // Handle image load failure gracefully
    img.onerror = () => {
      img.remove();
      imageContainer.appendChild(createNoImagePlaceholder('Image failed to load'));
    };

    imageContainer.appendChild(img);
  } else {
    imageContainer.appendChild(createNoImagePlaceholder('No og:image tag found'));
  }

  // --- Text content (title, description, domain) ---
  const textContent = document.createElement('div');
  textContent.className = 'preview-text';

  // Some platforms show domain/site name above or below the title
  if (platform.id === 'facebook' || platform.id === 'linkedin') {
    const domainEl = document.createElement('p');
    domainEl.className = 'preview-domain';
    domainEl.textContent = domain;
    textContent.appendChild(domainEl);
  }

  const titleEl = document.createElement('p');
  titleEl.className = 'preview-title';
  titleEl.textContent = title;
  textContent.appendChild(titleEl);

  if (description) {
    const descEl = document.createElement('p');
    descEl.className = 'preview-description';
    descEl.textContent = description;
    textContent.appendChild(descEl);
  }

  // Some platforms show domain at the bottom instead
  if (
    platform.id !== 'facebook' &&
    platform.id !== 'linkedin'
  ) {
    const domainEl = document.createElement('p');
    domainEl.className = 'preview-domain';
    domainEl.textContent = siteName || domain;
    textContent.appendChild(domainEl);
  }

  // --- Warnings ---
  let warningsEl = null;
  if (warnings.length > 0) {
    warningsEl = document.createElement('div');
    warningsEl.className = 'preview-warnings';

    warnings.forEach((w) => {
      const warnLine = document.createElement('p');
      warnLine.className = `preview-warning ${w.level}`;

      const warnIcon = document.createElement('span');
      warnIcon.className = 'preview-warning-icon';
      warnIcon.setAttribute('aria-hidden', 'true');
      warnIcon.textContent =
        w.level === 'success' ? '✓' : w.level === 'warn' ? '⚠' : '✗';

      const warnText = document.createElement('span');
      warnText.textContent = w.message;

      warnLine.appendChild(warnIcon);
      warnLine.appendChild(warnText);
      warningsEl.appendChild(warnLine);
    });
  }

  // Assemble the card
  card.appendChild(header);
  card.appendChild(imageContainer);
  card.appendChild(textContent);
  if (warningsEl) card.appendChild(warningsEl);

  return card;
}

/**
 * Create a placeholder element for when no image is available.
 *
 * @param {string} message - The message to display
 * @returns {HTMLElement}
 */
function createNoImagePlaceholder(message) {
  const placeholder = document.createElement('div');
  placeholder.className = 'preview-no-image';

  const icon = document.createElement('span');
  icon.className = 'preview-no-image-icon';
  icon.textContent = '🖼';
  icon.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.textContent = message;

  placeholder.appendChild(icon);
  placeholder.appendChild(text);
  return placeholder;
}

/* ============================================================
   WARNINGS & VALIDATION
   Generate platform-specific warnings based on the tags and
   image dimensions we detected.
   ============================================================ */

/**
 * Generate a list of warnings for a specific platform.
 *
 * Each warning has:
 * - level: 'success' | 'warn' | 'error'
 * - message: human-readable description
 *
 * @param {Object} platform - Platform spec from platforms.json
 * @param {Object} tags - Parsed meta tags
 * @param {{width: number, height: number}|null} dimensions - Image dimensions
 * @returns {Array<{level: string, message: string}>}
 */
function generateWarnings(platform, tags, dimensions) {
  const warnings = [];
  const imageUrl = tags['og:image'] || tags['twitter:image'];
  const rec = platform.recommended;

  // --- Check: og:image present ---
  if (!imageUrl) {
    warnings.push({
      level: 'error',
      message: `No og:image — ${platform.behavior.fallbackWhenMissing}`,
    });
    return warnings; // No point checking dimensions if there's no image
  }

  // --- Check: image dimensions ---
  if (dimensions) {
    const { width, height } = dimensions;

    // Width check
    if (width < rec.minWidth) {
      warnings.push({
        level: 'error',
        message: `Image width (${width}px) below minimum ${rec.minWidth}px — image may not display`,
      });
    } else if (width < rec.width) {
      warnings.push({
        level: 'warn',
        message: `Image width (${width}px) below recommended ${rec.width}px — may appear blurry`,
      });
    } else {
      warnings.push({
        level: 'success',
        message: `Image size ${width}×${height}px meets ${rec.width}×${rec.height} recommendation`,
      });
    }

    // Aspect ratio check
    const actualRatio = width / height;
    const expectedRatio = rec.width / rec.height;
    const ratioDifference = Math.abs(actualRatio - expectedRatio);

    if (ratioDifference > 0.3) {
      warnings.push({
        level: 'warn',
        message: `Aspect ratio (${actualRatio.toFixed(2)}:1) differs significantly from recommended ${rec.aspectRatio} — will be cropped`,
      });
    }
  } else {
    warnings.push({
      level: 'warn',
      message: 'Could not determine image dimensions — unable to check size requirements',
    });
  }

  // --- Platform-specific checks ---

  // Twitter: check for twitter:card tag
  if (platform.id === 'twitter') {
    const cardType = tags['twitter:card'];
    if (!cardType) {
      warnings.push({
        level: 'warn',
        message: 'twitter:card not set — defaults to "summary" (small thumbnail). Set to "summary_large_image" for a large preview.',
      });
    } else if (cardType === 'summary_large_image') {
      warnings.push({
        level: 'success',
        message: 'twitter:card set to summary_large_image — optimal large preview',
      });
    } else if (cardType === 'summary') {
      warnings.push({
        level: 'success',
        message: 'twitter:card set to summary — small square thumbnail will be shown',
      });
    }
  }

  // Discord: check theme-color for embed sidebar
  if (platform.id === 'discord') {
    if (tags['theme-color']) {
      warnings.push({
        level: 'success',
        message: `theme-color (${tags['theme-color']}) will color the embed sidebar`,
      });
    }
  }

  // General: check og:description
  if (!tags['og:description'] && !tags['twitter:description'] && !tags['description']) {
    warnings.push({
      level: 'warn',
      message: 'No description tag found — preview will show title and image only',
    });
  }

  return warnings;
}

/**
 * Determine the overall status for a set of warnings.
 * Used for the card header status icon.
 *
 * @param {Array<{level: string}>} warnings
 * @returns {'ok' | 'warn' | 'error'}
 */
function getOverallStatus(warnings) {
  if (warnings.some((w) => w.level === 'error')) return 'error';
  if (warnings.some((w) => w.level === 'warn')) return 'warn';
  return 'ok';
}

/* ============================================================
   RENDERING — META TAG SUGGESTIONS
   When tags are missing, generate copy-paste HTML for the user.
   ============================================================ */

/**
 * Generate and render suggested meta tags for missing OG properties.
 *
 * @param {Object} tags - Parsed meta tags
 */
function renderSuggestions(tags) {
  const suggestions = [];

  if (!tags['og:title']) {
    suggestions.push(
      `<meta property="og:title" content="Your Page Title Here">`
    );
  }
  if (!tags['og:description']) {
    const fallback = tags['description'] || 'A brief description of your page.';
    suggestions.push(
      `<meta property="og:description" content="${escapeHtml(fallback)}">`
    );
  }
  if (!tags['og:image']) {
    suggestions.push(
      `<meta property="og:image" content="https://yoursite.com/images/og-image.jpg">`
    );
    suggestions.push(
      `<meta property="og:image:width" content="1200">`
    );
    suggestions.push(
      `<meta property="og:image:height" content="630">`
    );
    suggestions.push(
      `<meta property="og:image:alt" content="Descriptive alt text for your image">`
    );
  }
  if (!tags['og:url']) {
    suggestions.push(
      `<meta property="og:url" content="${escapeHtml(state.currentUrl)}">`
    );
  }
  if (!tags['twitter:card']) {
    suggestions.push(
      `<meta name="twitter:card" content="summary_large_image">`
    );
  }
  if (!tags['og:type']) {
    suggestions.push(
      `<meta property="og:type" content="website">`
    );
  }

  if (suggestions.length === 0) {
    dom.suggestionsSection.hidden = true;
    return;
  }

  dom.suggestionsSection.hidden = false;
  dom.suggestionsCode.textContent = suggestions.join('\n');
}

/* ============================================================
   ERROR HANDLING
   User-friendly error messages that help diagnose the problem.
   ============================================================ */

/**
 * Handle errors from the fetch/parse flow.
 * Maps technical error messages to user-friendly explanations.
 *
 * @param {Error} err
 */
function handleFetchError(err) {
  const message = err.message || 'An unknown error occurred';

  if (message.startsWith('BLOCKED:')) {
    showError('Site blocks external access', message.replace('BLOCKED: ', ''));
  } else if (message.startsWith('NOT_FOUND:')) {
    showError('Page not found', message.replace('NOT_FOUND: ', ''));
  } else if (message.startsWith('RATE_LIMITED:')) {
    showError('Rate limited', message.replace('RATE_LIMITED: ', ''));
  } else if (message.startsWith('TIMEOUT:')) {
    showError('Request timed out', message.replace('TIMEOUT: ', ''));
  } else if (message.startsWith('HTTP_ERROR:')) {
    showError('Server error', message.replace('HTTP_ERROR: ', ''));
  } else if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
    showError(
      'Network error',
      'Could not reach the CORS proxy. Check your internet connection, or try a different proxy in the settings below.'
    );
  } else {
    showError('Something went wrong', message);
  }
}

/**
 * Show an error banner.
 *
 * @param {string} title - Short error title
 * @param {string} detail - Longer explanation
 */
function showError(title, detail) {
  dom.errorSection.hidden = false;
  dom.errorTitle.textContent = title;
  dom.errorDetail.textContent = detail;
  // Scroll to the error so the user sees it
  dom.errorSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Hide the error banner.
 */
function hideError() {
  dom.errorSection.hidden = true;
}

/* ============================================================
   UI HELPERS
   Small utility functions for UI state management.
   ============================================================ */

/**
 * Toggle loading state — disables the button and shows a spinner.
 *
 * @param {boolean} isLoading
 */
function setLoading(isLoading) {
  state.loading = isLoading;
  dom.fetchBtn.disabled = isLoading;
  dom.urlInput.disabled = isLoading;
  dom.btnLabel.hidden = isLoading;
  dom.btnLoading.hidden = !isLoading;
}

/**
 * Update the browser URL bar with a shareable link.
 * Uses replaceState so it doesn't add a history entry for each preview.
 *
 * @param {string} url - The previewed URL
 */
function updateShareableUrl(url) {
  const shareableUrl = new URL(window.location.href);
  shareableUrl.searchParams.set('url', url);
  history.replaceState(null, '', shareableUrl.toString());
}

/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */

/**
 * Extract the domain from a URL for display purposes.
 *
 * @param {string} url
 * @returns {string} e.g., "example.com"
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Escape HTML special characters to prevent XSS when inserting
 * user-provided values into the DOM.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Get a simple inline SVG icon for each platform.
 *
 * Why inline SVGs instead of an icon font or image sprites?
 * - No external dependencies or additional HTTP requests
 * - Scale perfectly at any size
 * - Can be styled with CSS (color inherits from parent)
 * - Total size is small since these are simple logos
 *
 * @param {string} platformId
 * @returns {string} SVG markup
 */
function getPlatformIcon(platformId) {
  // Simplified platform icons — 20×20 viewBox, single color
  const icons = {
    facebook: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,

    twitter: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,

    linkedin: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,

    bluesky: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.785 2.627 3.6 3.476 6.158 3.166-4.476.75-8.423 2.545-3.26 8.9C8.787 28.03 11.035 19.396 12 16.38c.965 3.016 2.59 11.004 8.478 5.933 5.163-6.355 1.216-8.15-3.26-8.9 2.558.31 5.373-.539 6.158-3.166.246-.828.624-5.789.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg>`,

    discord: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/></svg>`,

    slack: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z"/></svg>`,

    imessage: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 5.813 2 10.5c0 2.61 1.47 4.94 3.767 6.48-.186 1.463-.763 2.784-1.625 3.855a.5.5 0 00.397.815c2.11-.08 3.982-.96 5.296-2.09.69.134 1.41.207 2.153.207C17.523 19.767 22 15.954 22 11.267 22 6.08 17.523 2 12 2z"/></svg>`,

    whatsapp: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`,

    mastodon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M23.268 5.313c-.35-2.578-2.617-4.61-5.304-5.004C17.51.242 15.792 0 11.813 0h-.03c-3.98 0-4.835.242-5.288.309C3.882.692 1.496 2.518.917 5.127.64 6.412.61 7.837.661 9.143c.074 1.874.088 3.745.26 5.611.118 1.24.325 2.47.62 3.68.55 2.237 2.777 4.098 4.96 4.857 2.336.792 4.849.923 7.256.38.265-.061.527-.132.786-.213.585-.184 1.27-.39 1.774-.753a.057.057 0 00.023-.043v-1.809a.052.052 0 00-.02-.041.053.053 0 00-.046-.01 20.282 20.282 0 01-4.709.547c-2.73 0-3.463-1.284-3.674-1.818a5.593 5.593 0 01-.319-1.433.053.053 0 01.066-.054c1.517.363 3.072.546 4.632.546.376 0 .75 0 1.125-.01 1.57-.044 3.224-.124 4.768-.422.038-.008.077-.015.11-.024 2.435-.464 4.753-1.92 4.989-5.604.008-.145.03-1.52.03-1.67.002-.512.167-3.63-.024-5.545zm-3.748 9.195h-2.561V8.29c0-1.309-.55-1.976-1.67-1.976-1.23 0-1.846.79-1.846 2.35v3.403h-2.546V8.663c0-1.56-.617-2.35-1.848-2.35-1.112 0-1.668.668-1.67 1.977v6.218H4.822V8.102c0-1.31.337-2.35 1.011-3.12.696-.77 1.608-1.164 2.74-1.164 1.311 0 2.302.5 2.962 1.498l.638 1.06.638-1.06c.66-.999 1.65-1.498 2.96-1.498 1.13 0 2.043.395 2.74 1.164.675.77 1.012 1.81 1.012 3.12z"/></svg>`,

    threads: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.287 3.263-.809.993-1.916 1.573-3.208 1.682-1.042.088-2.07-.09-2.974-.515-1.05-.493-1.846-1.304-2.239-2.284-.33-.822-.383-1.722-.153-2.6.441-1.685 1.874-2.87 3.907-3.233.85-.152 1.718-.189 2.58-.158-.125-.636-.348-1.158-.672-1.555-.486-.595-1.218-.908-2.176-.931h-.036c-.792.01-1.484.236-1.996.654a2.857 2.857 0 00-.456.513l-1.7-1.129c.298-.45.675-.852 1.13-1.192.878-.656 2.014-1 3.035-1.012h.06c1.44.035 2.598.554 3.438 1.543.487.573.84 1.276 1.072 2.076.352.133.692.287 1.018.462 1.15.619 2.06 1.508 2.631 2.576.825 1.542.896 4.168-1.128 6.2-1.768 1.774-3.93 2.534-7.003 2.558z"/><path d="M14.155 14.565c-.11-.437-.316-.834-.62-1.163-.457-.492-1.123-.752-1.924-.752h-.006c-.654.004-1.266.2-1.728.55-.417.315-.677.736-.773 1.238-.124.638-.024 1.219.279 1.616.337.44.89.7 1.543.7h.003c.07 0 .14-.004.212-.01.84-.071 1.459-.44 1.89-1.127.302-.484.502-1.032.604-1.64.174.06.343.13.507.208l-.187-.62z"/></svg>`,

    telegram: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`,

    reddit: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 00.029-.463.33.33 0 00-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.232-.095z"/></svg>`,
  };

  return icons[platformId] || `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>`;
}

/* ============================================================
   BOOT
   Start the application once the DOM is ready.
   Since the script is loaded at the end of <body>, the DOM is
   already available — no need for DOMContentLoaded.
   ============================================================ */
init();
