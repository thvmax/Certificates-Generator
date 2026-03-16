/**
 * generator.js – Updated
 * A4 Portrait: 2480 × 3508 px at 300 dpi.
 * Supported variables: {{name}} {{course}} {{date}} {{certificate_id}} {{validity}} {{cnic}}
 */

const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');

async function generateCertificates(templateName, participants, onProgress) {
  const templateDir = path.join(__dirname, '../templates', templateName);
  const layoutPath  = path.join(templateDir, 'layout.json');
  const bgPath      = path.join(templateDir, 'background.jpg');
  const outputDir   = path.join(__dirname, '../output');

  if (!fs.existsSync(layoutPath))
    throw new Error(`Layout not found for template "${templateName}".`);

  const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.readdirSync(outputDir).filter(f => f.endsWith('.jpg'))
    .forEach(f => fs.unlinkSync(path.join(outputDir, f)));

  let bgDataURL = null;
  if (fs.existsSync(bgPath)) {
    const ext  = path.extname(bgPath).toLowerCase().replace('.', '');
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    bgDataURL  = `data:${mime};base64,${fs.readFileSync(bgPath).toString('base64')}`;
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage'],
  });

  const outputFiles = [];
  try {
    for (let i = 0; i < participants.length; i++) {
      const html     = buildCertificateHTML(layout, participants[i], bgDataURL);
      const filename = `certificate_${String(i + 1).padStart(3, '0')}.jpg`;
      const outPath  = path.join(outputDir, filename);

      const page = await browser.newPage();
      await page.setViewport({ width: layout.width||2480, height: layout.height||3508, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 200));
      await page.screenshot({
        type: 'jpeg', quality: 95, path: outPath,
        clip: { x:0, y:0, width: layout.width||2480, height: layout.height||3508 },
      });
      await page.close();

      outputFiles.push(filename);
      console.log(`  [${i+1}/${participants.length}] ${filename}`);
      if (typeof onProgress === 'function') onProgress(i + 1, participants.length);
    }
  } finally {
    await browser.close();
  }
  return outputFiles;
}

function buildCertificateHTML(layout, data, bgDataURL) {
  const W = layout.width  || 2480;
  const H = layout.height || 3508;

  function replaceVars(text) {
    if (!text) return '';
    return text
      .replace(/\{\{name\}\}/gi,           escHtml(data.name           || ''))
      .replace(/\{\{course\}\}/gi,         escHtml(data.course         || ''))
      .replace(/\{\{date\}\}/gi,           escHtml(data.date           || ''))
      .replace(/\{\{certificate_id\}\}/gi, escHtml(data.certificate_id || ''))
      .replace(/\{\{validity\}\}/gi,       escHtml(data.validity       || ''))
      .replace(/\{\{cnic\}\}/gi,           escHtml(data.cnic           || ''));
  }

  const elements = (layout.elements || []).map(el => {
    if (el.type !== 'text') return '';
    return `<div style="position:absolute;left:${el.x||0}px;top:${el.y||0}px;width:${el.width||W}px;
      font-size:${el.fontSize||48}px;font-family:${el.fontFamily||'Arial,sans-serif'};
      font-weight:${el.fontWeight||'normal'};font-style:${el.fontStyle||'normal'};
      color:${el.color||'#000'};text-align:${el.align||'left'};
      line-height:1.35;white-space:pre-wrap;word-wrap:break-word;">${replaceVars(el.value)}</div>`;
  }).join('');

  const bg = bgDataURL
    ? `background-image:url('${bgDataURL}');background-size:${W}px ${H}px;background-repeat:no-repeat;background-position:center;`
    : 'background:#fff;';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px;overflow:hidden}
.c{position:relative;width:${W}px;height:${H}px;${bg}}</style>
</head><body><div class="c">${elements}</div></body></html>`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = { generateCertificates };
