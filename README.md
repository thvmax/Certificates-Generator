# 🎓 Certificate Generator

A local web app for visually designing certificate templates and batch-generating
flattened JPEG certificates from CSV data.

---

## Quick Start

```bash
# 1. Install dependencies (takes ~2 min the first time — Puppeteer downloads Chromium)
npm install

# 2. Start the server
node backend/server.js

# 3. Open in browser
open http://localhost:3000
```

---

## Workflow

### 1. Design a Template → `/builder.html`
- Upload a background image (JPG/PNG)
- Add text elements and drag them into position
- Use variable buttons to insert `{{name}}`, `{{course}}`, etc.
- Adjust font, size, colour, and alignment in the right panel
- Enter a template name and click **Save Template**

### 2. Manage Templates → `/templates.html`
- View all saved templates with previews
- Edit, duplicate, or delete templates
- Click **Generate** to go straight to generation

### 3. Generate Certificates → `/generate.html`
- Select a saved template
- Upload a CSV file (see format below)
- Click **Generate Certificates**
- Download as ZIP (individual JPEGs) or PDF (all pages combined)

---

## CSV Format

```csv
name,course,date,certificate_id,instructor
Ali Khan,Basic Safety,12 Mar 2026,VTI-001,Dr. Smith
Sara Ahmed,Basic Safety,12 Mar 2026,VTI-002,Dr. Smith
Omar Hassan,Fire Safety,15 Mar 2026,VTI-003,Prof. Lee
```

A sample CSV is downloadable from the Generate page.

### Supported variables
| Variable            | CSV column        |
|---------------------|-------------------|
| `{{name}}`          | `name`            |
| `{{course}}`        | `course`          |
| `{{date}}`          | `date`            |
| `{{certificate_id}}`| `certificate_id`  |
| `{{instructor}}`    | `instructor`      |

---

## Output

- **Location:** `/output/certificate_001.jpg`, `certificate_002.jpg`, …
- **Resolution:** Full A4 landscape at 300 dpi (3508 × 2480 px)
- **Format:** Flattened JPEG at 95% quality
- **PDF:** A4 landscape, one certificate per page

---

## Folder Structure

```
certificate-generator/
├── backend/
│   ├── server.js        ← Express REST API
│   ├── generator.js     ← Puppeteer rendering engine
│   └── csv-parser.js    ← CSV file parser
├── frontend/
│   ├── builder.html     ← Visual template editor (Fabric.js)
│   ├── templates.html   ← Template manager
│   └── generate.html    ← Batch certificate generator
├── templates/           ← Saved templates (layout.json + background.jpg)
├── uploads/             ← Temporary upload staging
├── output/              ← Generated certificate JPEGs
├── assets/              ← Static assets
└── package.json
```

---

## Tech Stack

| Layer    | Technology                              |
|----------|-----------------------------------------|
| Frontend | HTML · TailwindCSS CDN · Vanilla JS     |
| Canvas   | Fabric.js 5                             |
| Backend  | Node.js · Express.js                    |
| Render   | Puppeteer (headless Chromium)           |
| Export   | JSZip · PDFKit                          |

---

## Notes

- First `npm install` downloads Chromium (~170 MB) for Puppeteer.
- Generation speed: ~3-5 seconds per certificate on a modern machine.
- All data is local — no internet connection needed after install.
