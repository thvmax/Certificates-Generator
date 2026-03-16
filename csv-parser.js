/**
 * csv-parser.js
 * Parses a CSV file into an array of participant objects.
 * Supports quoted fields and flexible headers.
 */

const fs = require('fs');

/**
 * Parse a CSV file at the given path.
 * @param {string} filePath - Absolute path to the CSV file.
 * @returns {Promise<Array<Object>>} Array of participant objects.
 */
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');

      // Normalize line endings, split into non-empty lines
      const lines = raw
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim()
        .split('\n')
        .filter(l => l.trim().length > 0);

      if (lines.length < 2) {
        return reject(new Error('CSV must have a header row and at least one data row.'));
      }

      // Parse header row – lowercase, spaces → underscores
      const headers = parseCSVLine(lines[0]).map(h =>
        h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      );

      // Parse each data row
      const participants = lines.slice(1)
        .map(line => {
          const values = parseCSVLine(line);
          const obj = {};
          headers.forEach((header, i) => {
            obj[header] = (values[i] || '').trim();
          });
          return obj;
        })
        // Filter out completely empty rows
        .filter(p => Object.values(p).some(v => v.length > 0));

      resolve(participants);
    } catch (err) {
      reject(new Error(`CSV parse error: ${err.message}`));
    }
  });
}

/**
 * Parse a single CSV line, respecting quoted fields.
 * @param {string} line
 * @returns {string[]}
 */
function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // Handle escaped double-quote ("") inside a quoted field
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  values.push(current);
  return values;
}

module.exports = { parseCSV };
