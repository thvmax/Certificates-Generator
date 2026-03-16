/**
 * generator.js
 * Uses Puppeteer to render each certificate as a full-resolution JPEG.
 * Builds a self-contained HTML page per certificate and screenshots it.
 */

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');

/**
 * Generate certificates for all participants.
 *
 * @param {string}   templateName - Folder name inside /templates
 * @param {Object[]} participants  - Array of data objects from CSV
 * @param {Function} onProgress   - Called as (current, total) for progress updates
 * @returns {Promise<string[]>}   Array of output filenames (relative to /output)
 */
async function generateCertificates(templateName, participants, onProgress) {
  const templateDir = path.join(__dirname, '../templates', templateName);
  const layoutPath  = path.join(templateDir, 'layout.json');
  const bgPath      = path.join(templateDir, 'background.jpg');
  const outputDir   = path.join(__dirname, '../output');

  // --- Validation ---
  if (!fs.existsSync(layoutPath)) {
    throw new Error(`Layout file not found for template "${templateName}".`);
  }

  const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));

  // Ensure output directory exists and clear previous certificates
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.jpg'))
    .forEach(f => fs.unlinkSync(path.join(outputDir, f)));

  // Pre-encode background image as base64 (avoids file-path issues in Puppeteer)
  let bgDataURL = null;
  if (fs.existsSync(bgPath)) {
    const ext  = path.extname(bgPath).toLowerCase().replace('.', '');
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    bgDataURL  = `data:${mime};base64,${fs.readFileSync(bgPath).toString('base64')}`;
  }

  // Launch a single browser instance for all certificates
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ],
  });

  const outputFiles = [];

  try {
    for (let i = 0; i < participants.length; i++) {
      const participant = participants[i];
      const html        = buildCertificateHTML(layout, participant, bgDataURL);
      const filename    = `certificate_${String(i + 1).padStart(3, '0')}.jpg`;
      const outputPath  = path.join(outputDir, filename);

      const page = await browser.newPage();

      // Set viewport to exact certificate dimensions (full A4 landscape resolution)
      await page.setViewport({
        width:             layout.width  || 3508,
        height:            layout.height || 2480,
        deviceScaleFactor: 1,
      });

      // Load the certificate HTML
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Small pause to allow font rendering to settle
      await new Promise(r => setTimeout(r, 150));

      // Screenshot as JPEG directly
      await page.screenshot({
        type:    'jpeg',
        quality: 95,
        path:    outputPath,
        clip: {
          x:      0,
          y:      0,
          width:  layout.width  || 3508,
          height: layout.height || 2480,
        },
      });

      await page.close();
      outputFiles.push(filename);

      console.log(`  [${i + 1}/${participants.length}] Generated: ${filename}`);
      if (typeof onProgress === 'function') onProgress(i + 1, participants.length);
    }
  } finally {
    await browser.close();
  }

  return outputFiles;
}

/**
 * Build a self-contained HTML string for one certificate.
 * All coordinates in layout.json are at full A4 resolution (3508 × 2480).
 *
 * @param {Object} layout      - Parsed layout.json
 * @param {Object} data        - Single participant data object
 * @param {string|null} bgDataURL - Base64-encoded background image data URL
 * @returns {string} Complete HTML document
 */
function buildCertificateHTML(layout, data, bgDataURL) {
  const W = layout.width  || 3508;
  const H = layout.height || 2480;

  /* ── Replace template variables ──────────────────────────────────────── */
  function replaceVars(text) {
    if (!text) return '';
    return text
      .replace(/\{\{name\}\}/gi,           escapeHtml(data.name           || ''))
      .replace(/\{\{course\}\}/gi,         escapeHtml(data.course         || ''))
      .replace(/\{\{date\}\}/gi,           escapeHtml(data.date           || ''))
      .replace(/\{\{certificate_id\}\}/gi, escapeHtml(data.certificate_id || ''))
      .replace(/\{\{instructor\}\}/gi,     escapeHtml(data.instructor     || ''));
  }

  /* ── Build element HTML ──────────────────────────────────────────────── */
  const elementsHTML = (layout.elements || []).map(el => {
    if (el.type !== 'text') return '';

    const text      = replaceVars(el.value);
    const fontSize  = el.fontSize  || 48;
    const fontFam   = el.fontFamily || 'Arial, sans-serif';
    const color     = el.color     || '#000000';
    const align     = el.align     || 'left';
    const fontW     = el.fontWeight || 'normal';
    const fontS     = el.fontStyle  || 'normal';
    const elWidth   = el.width || W;
    const x         = el.x || 0;
    const y         = el.y || 0;

    return `<div style="
      position:    absolute;
      left:        ${x}px;
      top:         ${y}px;
      width:       ${elWidth}px;
      font-size:   ${fontSize}px;
      font-family: ${fontFam};
      font-weight: ${fontW};
      font-style:  ${fontS};
      color:       ${color};
      text-align:  ${align};
      line-height: 1.3;
      white-space: pre-wrap;
      word-wrap:   break-word;
    ">${text}</div>`;
  }).join('\n');

  /* ── Background style ────────────────────────────────────────────────── */
  const bgStyle = bgDataURL
    ? `background-image: url('${bgDataURL}');
       background-size: ${W}px ${H}px;
       background-repeat: no-repeat;
       background-position: center center;`
    : 'background-color: #ffffff;';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width:    ${W}px;
      height:   ${H}px;
      overflow: hidden;
    }
    .certificate {
      position: relative;
      width:    ${W}px;
      height:   ${H}px;
      ${bgStyle}
    }
  </style>
</head>
<body>
  <div class="certificate">
    ${elementsHTML}
  </div>
</body>
</html>`;
}

/** Minimal HTML entity escaping to prevent XSS in rendered output. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

module.exports = { generateCertificates };
