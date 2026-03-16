/**
 * server.js
 * Main Express server for the Certificate Generator.
 * Serves static frontend files and exposes a REST API for:
 *   – Template CRUD
 *   – Certificate generation (job-based with polling)
 *   – ZIP / PDF export
 */

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const { parseCSV }              = require('./csv-parser');
const { generateCertificates }  = require('./generator');

const app  = express();
const PORT = 3000;

/* ═══════════════════════════════════════════════════════════════════════
   DIRECTORY BOOTSTRAP
   ═══════════════════════════════════════════════════════════════════════ */
const DIRS = [
  '../templates',
  '../uploads',
  '../output',
  '../assets',
].map(d => path.join(__dirname, d));

DIRS.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/* ═══════════════════════════════════════════════════════════════════════
   MIDDLEWARE
   ═══════════════════════════════════════════════════════════════════════ */
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Serve frontend HTML/JS/CSS
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve generated certificates & template assets
app.use('/templates', express.static(path.join(__dirname, '../templates')));
app.use('/output',    express.static(path.join(__dirname, '../output')));
app.use('/assets',    express.static(path.join(__dirname, '../assets')));

/* ═══════════════════════════════════════════════════════════════════════
   MULTER – file upload storage
   ═══════════════════════════════════════════════════════════════════════ */
const upload = multer({ dest: path.join(__dirname, '../uploads') });

/* ═══════════════════════════════════════════════════════════════════════
   IN-MEMORY JOB STORE  (generation progress tracking)
   ═══════════════════════════════════════════════════════════════════════ */
const jobs = {}; // { [jobId]: { status, progress, total, files, error } }

// Clean up jobs older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  Object.keys(jobs).forEach(id => {
    if (Number(id) < cutoff) delete jobs[id];
  });
}, 15 * 60 * 1000);

/* ═══════════════════════════════════════════════════════════════════════
   ROOT REDIRECT
   ═══════════════════════════════════════════════════════════════════════ */
app.get('/', (_req, res) => res.redirect('/templates.html'));

/* ═══════════════════════════════════════════════════════════════════════
   TEMPLATE ROUTES
   ═══════════════════════════════════════════════════════════════════════ */

/** GET /api/templates – list all templates */
app.get('/api/templates', (_req, res) => {
  const dir = path.join(__dirname, '../templates');
  try {
    const templates = fs
      .readdirSync(dir)
      .filter(name => fs.statSync(path.join(dir, name)).isDirectory())
      .map(name => {
        const layoutPath = path.join(dir, name, 'layout.json');
        const bgPath     = path.join(dir, name, 'background.jpg');
        let elementCount = 0;
        if (fs.existsSync(layoutPath)) {
          try {
            const l = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
            elementCount = (l.elements || []).length;
          } catch (_) {}
        }
        return {
          name,
          hasLayout:    fs.existsSync(layoutPath),
          hasBackground: fs.existsSync(bgPath),
          previewUrl:   fs.existsSync(bgPath) ? `/templates/${encodeURIComponent(name)}/background.jpg` : null,
          elementCount,
        };
      });
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/templates/:name – get layout JSON */
app.get('/api/templates/:name', (req, res) => {
  const layoutPath = path.join(__dirname, '../templates', req.params.name, 'layout.json');
  if (!fs.existsSync(layoutPath)) return res.status(404).json({ error: 'Template not found.' });
  try {
    res.json(JSON.parse(fs.readFileSync(layoutPath, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/templates/:name – create or update a template.
 * Body (multipart): layout (JSON string), background (optional image file)
 */
app.post('/api/templates/:name', upload.single('background'), (req, res) => {
  try {
    const name        = req.params.name.trim();
    const templateDir = path.join(__dirname, '../templates', name);

    if (!name || /[\\/:*?"<>|]/.test(name)) {
      return res.status(400).json({ error: 'Invalid template name.' });
    }

    if (!fs.existsSync(templateDir)) fs.mkdirSync(templateDir, { recursive: true });

    // Save layout JSON
    if (req.body.layout) {
      JSON.parse(req.body.layout); // validate JSON first
      fs.writeFileSync(path.join(templateDir, 'layout.json'), req.body.layout, 'utf8');
    }

    // Save background image (rename from temp location)
    if (req.file) {
      const dest = path.join(templateDir, 'background.jpg');
      fs.renameSync(req.file.path, dest);
    }

    res.json({ success: true, name });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/templates/:name – remove a template directory */
app.delete('/api/templates/:name', (req, res) => {
  try {
    const templateDir = path.join(__dirname, '../templates', req.params.name);
    if (fs.existsSync(templateDir)) {
      fs.rmSync(templateDir, { recursive: true, force: true });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/templates/:name/duplicate – clone a template */
app.post('/api/templates/:name/duplicate', (req, res) => {
  try {
    const srcDir = path.join(__dirname, '../templates', req.params.name);
    if (!fs.existsSync(srcDir)) return res.status(404).json({ error: 'Template not found.' });

    const newName = `${req.params.name}_copy`;
    const destDir = path.join(__dirname, '../templates', newName);

    // Find a non-colliding name
    let counter  = 1;
    let finalDir = destDir;
    while (fs.existsSync(finalDir)) {
      finalDir = `${destDir}_${counter++}`;
    }
    const finalName = path.basename(finalDir);

    fs.mkdirSync(finalDir, { recursive: true });
    fs.readdirSync(srcDir).forEach(file => {
      fs.copyFileSync(path.join(srcDir, file), path.join(finalDir, file));
    });

    res.json({ success: true, newName: finalName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   CERTIFICATE GENERATION
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * POST /api/generate – kick off a certificate generation job.
 * Body (multipart): templateName (string), csv (file)
 * Returns: { jobId }
 */
app.post('/api/generate', upload.single('csv'), async (req, res) => {
  const jobId = String(Date.now());

  if (!req.body.templateName) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'templateName is required.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required.' });
  }

  // Initialise job record immediately so the client can start polling
  jobs[jobId] = { status: 'parsing', progress: 0, total: 0, files: [], error: null };
  res.json({ jobId });

  // ── Run asynchronously so the response returns straight away ──────────
  ;(async () => {
    const csvPath = req.file.path;
    try {
      const participants = await parseCSV(csvPath);
      jobs[jobId].total  = participants.length;
      jobs[jobId].status = 'generating';

      const files = await generateCertificates(
        req.body.templateName,
        participants,
        (current, total) => {
          jobs[jobId].progress = current;
          jobs[jobId].total    = total;
        }
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

/** GET /api/jobs/:jobId – poll generation progress */
app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(job);
});

/* ═══════════════════════════════════════════════════════════════════════
   OUTPUT MANAGEMENT
   ═══════════════════════════════════════════════════════════════════════ */

/** GET /api/output – list generated certificate files */
app.get('/api/output', (_req, res) => {
  const dir = path.join(__dirname, '../output');
  try {
    const files = fs
      .readdirSync(dir)
      .filter(f => f.endsWith('.jpg'))
      .sort()
      .map(f => ({ name: f, url: `/output/${f}` }));
    res.json(files);
  } catch {
    res.json([]);
  }
});

/** DELETE /api/output – clear all generated certificates */
app.delete('/api/output', (_req, res) => {
  const dir = path.join(__dirname, '../output');
  try {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir)
        .filter(f => f.endsWith('.jpg'))
        .forEach(f => fs.unlinkSync(path.join(dir, f)));
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   EXPORT ROUTES
   ═══════════════════════════════════════════════════════════════════════ */

/** GET /api/export/zip – download all certificates as a ZIP archive */
app.get('/api/export/zip', async (_req, res) => {
  const JSZip  = require('jszip');
  const dir    = path.join(__dirname, '../output');
  const files  = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();

  if (files.length === 0) {
    return res.status(404).json({ error: 'No certificates to export.' });
  }

  try {
    const zip = new JSZip();
    files.forEach(f => zip.file(f, fs.readFileSync(path.join(dir, f))));
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="certificates.zip"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/export/pdf – download all certificates as a multi-page PDF (A4 landscape) */
app.get('/api/export/pdf', (_req, res) => {
  const PDFDocument = require('pdfkit');
  const dir         = path.join(__dirname, '../output');
  const files       = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();

  if (files.length === 0) {
    return res.status(404).json({ error: 'No certificates to export.' });
  }

  try {
    // A4 landscape at 72 dpi: 841.89 × 595.28 pt
    const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 0, autoFirstPage: false });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="certificates.pdf"');
    doc.pipe(res);

    files.forEach(f => {
      doc.addPage();
      // Scale image to fill the A4 landscape page
      doc.image(
        path.join(dir, f),
        0, 0,
        { width: doc.page.width, height: doc.page.height }
      );
    });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   SAMPLE CSV DOWNLOAD
   ═══════════════════════════════════════════════════════════════════════ */
app.get('/api/sample-csv', (_req, res) => {
  const csv = [
    'name,course,date,certificate_id,instructor',
    'Ali Khan,Basic Safety,12 Mar 2026,VTI-001,Dr. Smith',
    'Sara Ahmed,Basic Safety,12 Mar 2026,VTI-002,Dr. Smith',
    'Omar Hassan,Fire Safety,15 Mar 2026,VTI-003,Prof. Lee',
    'Leila Nour,First Aid,20 Mar 2026,VTI-004,Dr. Williams',
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sample_participants.csv"');
  res.send(csv);
});

/* ═══════════════════════════════════════════════════════════════════════
   START SERVER
   ═══════════════════════════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log('');
  console.log('  🎓  Certificate Generator');
  console.log(`  ➜   http://localhost:${PORT}`);
  console.log('');
});
