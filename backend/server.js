/**
 * server.js – Updated
 * – Auto-generates certificate numbers from a starting number
 * – Supports variables: name, course, date, certificate_id (auto), validity, cnic
 * – A4 Portrait output (2480 × 3508)
 */

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const { parseCSV }             = require('./csv-parser');
const { generateCertificates } = require('./generator');

const app  = express();
const PORT = 3000;

/* ── Directory bootstrap ─────────────────────────────────── */
['../templates','../uploads','../output','../assets']
  .map(d => path.join(__dirname, d))
  .forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

/* ── Middleware ──────────────────────────────────────────── */
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/templates', express.static(path.join(__dirname, '../templates')));
app.use('/output',    express.static(path.join(__dirname, '../output')));

const upload = multer({ dest: path.join(__dirname, '../uploads') });

/* ── In-memory job store ─────────────────────────────────── */
const jobs = {};
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  Object.keys(jobs).forEach(id => { if (Number(id) < cutoff) delete jobs[id]; });
}, 15 * 60 * 1000);

/* ── Root redirect ───────────────────────────────────────── */
app.get('/', (_req, res) => res.redirect('/templates.html'));

/* ════════════════════════════════════════════════════════════
   CERTIFICATE NUMBER AUTO-GENERATION
   Input:  "VT-2026-4842-WMS"
   Output: ["VT-2026-4842-WMS", "VT-2026-4843-WMS", ...]
   Finds the LAST purely-numeric segment and increments it.
════════════════════════════════════════════════════════════ */
function generateCertNumbers(startCert, count) {
  if (!startCert || !startCert.trim()) {
    return Array.from({ length: count }, (_, i) => `CERT-${String(i + 1).padStart(4, '0')}`);
  }

  const parts    = startCert.trim().split('-');
  let   numIdx   = -1;
  let   padLen   = 4;

  // Find the LAST purely-numeric segment
  parts.forEach((p, i) => {
    if (/^\d+$/.test(p)) { numIdx = i; padLen = p.length; }
  });

  if (numIdx === -1) {
    // No numeric segment – append a counter
    return Array.from({ length: count }, (_, i) => `${startCert}-${String(i + 1).padStart(4, '0')}`);
  }

  const base = parseInt(parts[numIdx], 10);
  return Array.from({ length: count }, (_, i) => {
    const newParts  = [...parts];
    newParts[numIdx] = String(base + i).padStart(padLen, '0');
    return newParts.join('-');
  });
}

/* ════════════════════════════════════════════════════════════
   TEMPLATE ROUTES
════════════════════════════════════════════════════════════ */
app.get('/api/templates', (_req, res) => {
  const dir = path.join(__dirname, '../templates');
  try {
    const templates = fs.readdirSync(dir)
      .filter(n => fs.statSync(path.join(dir, n)).isDirectory())
      .map(name => {
        const lp  = path.join(dir, name, 'layout.json');
        const bgp = path.join(dir, name, 'background.jpg');
        let   cnt = 0;
        if (fs.existsSync(lp)) {
          try { cnt = (JSON.parse(fs.readFileSync(lp, 'utf8')).elements || []).length; } catch (_) {}
        }
        return { name, hasLayout: fs.existsSync(lp), hasBackground: fs.existsSync(bgp),
          previewUrl: fs.existsSync(bgp) ? `/templates/${encodeURIComponent(name)}/background.jpg` : null,
          elementCount: cnt };
      });
    res.json(templates);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/templates/:name', (req, res) => {
  const lp = path.join(__dirname, '../templates', req.params.name, 'layout.json');
  if (!fs.existsSync(lp)) return res.status(404).json({ error: 'Template not found.' });
  try { res.json(JSON.parse(fs.readFileSync(lp, 'utf8'))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/templates/:name', upload.single('background'), (req, res) => {
  try {
    const name = req.params.name.trim();
    if (!name || /[\\/:*?"<>|]/.test(name)) return res.status(400).json({ error: 'Invalid template name.' });
    const dir = path.join(__dirname, '../templates', name);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (req.body.layout) {
      JSON.parse(req.body.layout);
      fs.writeFileSync(path.join(dir, 'layout.json'), req.body.layout, 'utf8');
    }
    if (req.file) fs.renameSync(req.file.path, path.join(dir, 'background.jpg'));
    res.json({ success: true, name });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/templates/:name', (req, res) => {
  try {
    const d = path.join(__dirname, '../templates', req.params.name);
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/templates/:name/duplicate', (req, res) => {
  try {
    const src = path.join(__dirname, '../templates', req.params.name);
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'Template not found.' });
    let dest = path.join(__dirname, '../templates', `${req.params.name}_copy`);
    let i = 1;
    while (fs.existsSync(dest)) dest = path.join(__dirname, '../templates', `${req.params.name}_copy_${i++}`);
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(f => fs.copyFileSync(path.join(src, f), path.join(dest, f)));
    res.json({ success: true, newName: path.basename(dest) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ════════════════════════════════════════════════════════════
   CERTIFICATE GENERATION
   Accepts: templateName, startCertNumber, csv (file)
════════════════════════════════════════════════════════════ */
app.post('/api/generate', upload.single('csv'), async (req, res) => {
  const jobId = String(Date.now());
  if (!req.body.templateName) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'templateName is required.' });
  }
  if (!req.file) return res.status(400).json({ error: 'CSV file is required.' });

  jobs[jobId] = { status: 'parsing', progress: 0, total: 0, files: [], error: null };
  res.json({ jobId });

  ;(async () => {
    const csvPath = req.file.path;
    try {
      const participants     = await parseCSV(csvPath);
      const startCertNumber  = (req.body.startCertNumber || '').trim();
      const certNumbers      = generateCertNumbers(startCertNumber, participants.length);

      // Inject auto-generated certificate_id into each participant
      participants.forEach((p, i) => { p.certificate_id = certNumbers[i]; });

      jobs[jobId].total  = participants.length;
      jobs[jobId].status = 'generating';

      const files = await generateCertificates(
        req.body.templateName, participants,
        (cur, tot) => { jobs[jobId].progress = cur; jobs[jobId].total = tot; }
      );

      jobs[jobId].files    = files;
      jobs[jobId].progress = files.length;
      jobs[jobId].status   = 'done';
    } catch (err) {
      console.error('Generation error:', err);
      jobs[jobId].status = 'error';
      jobs[jobId].error  = err.message;
    } finally {
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  })();
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(job);
});

/* ════════════════════════════════════════════════════════════
   OUTPUT & EXPORT
════════════════════════════════════════════════════════════ */
app.get('/api/output', (_req, res) => {
  const dir = path.join(__dirname, '../output');
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort()
      .map(f => ({ name: f, url: `/output/${f}` }));
    res.json(files);
  } catch { res.json([]); }
});

app.delete('/api/output', (_req, res) => {
  const dir = path.join(__dirname, '../output');
  try {
    if (fs.existsSync(dir))
      fs.readdirSync(dir).filter(f => f.endsWith('.jpg'))
        .forEach(f => fs.unlinkSync(path.join(dir, f)));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/export/zip', async (_req, res) => {
  const JSZip = require('jszip');
  const dir   = path.join(__dirname, '../output');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();
  if (files.length === 0) return res.status(404).json({ error: 'No certificates to export.' });
  try {
    const zip = new JSZip();
    files.forEach(f => zip.file(f, fs.readFileSync(path.join(dir, f))));
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="certificates.zip"');
    res.send(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/export/pdf', (_req, res) => {
  const PDFDocument = require('pdfkit');
  const dir   = path.join(__dirname, '../output');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();
  if (files.length === 0) return res.status(404).json({ error: 'No certificates to export.' });
  try {
    // A4 portrait
    const doc = new PDFDocument({ layout: 'portrait', size: 'A4', margin: 0, autoFirstPage: false });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="certificates.pdf"');
    doc.pipe(res);
    files.forEach(f => {
      doc.addPage();
      doc.image(path.join(dir, f), 0, 0, { width: doc.page.width, height: doc.page.height });
    });
    doc.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* Preview a cert number sequence */
app.get('/api/cert-preview', (req, res) => {
  const { start, count } = req.query;
  const n   = Math.min(parseInt(count) || 5, 10);
  const nums = generateCertNumbers(start || '', n);
  res.json({ preview: nums });
});

app.get('/api/sample-csv', (_req, res) => {
  const csv = [
    'name,course,date,validity,cnic',
    'Ali Khan,Basic Safety,12 Mar 2026,12 Mar 2028,42101-1234567-1',
    'Sara Ahmed,Basic Safety,12 Mar 2026,12 Mar 2028,42201-7654321-2',
    'Omar Hassan,Fire Safety,15 Mar 2026,15 Mar 2028,35202-9876543-3',
    'Leila Nour,First Aid,20 Mar 2026,20 Mar 2028,61101-1122334-4',
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sample_participants.csv"');
  res.send(csv);
});

/* ── Start ──────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log('');
  console.log('  🎓  Certificate Generator');
  console.log(`  ➜   http://localhost:${PORT}`);
  console.log('');
});
