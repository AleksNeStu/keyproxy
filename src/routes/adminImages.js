'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function getMetaPath() {
  return path.join(UPLOAD_DIR, 'meta.json');
}

function loadMeta() {
  const p = getMetaPath();
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function saveMeta(meta) {
  ensureUploadDir();
  fs.writeFileSync(getMetaPath(), JSON.stringify(meta, null, 2));
}

/**
 * Parse multipart/form-data from raw Buffer.
 * Returns array of { fieldname, filename, contentType, data (Buffer) }.
 */
function parseMultipart(buffer, boundary) {
  const parts = [];
  const delim = Buffer.from(`--${boundary}`);
  const endDelim = Buffer.from(`--${boundary}--`);
  const crlf = Buffer.from('\r\n');

  let pos = buffer.indexOf(delim);
  if (pos === -1) return parts;
  pos += delim.length + 2; // skip \r\n after boundary

  while (pos < buffer.length) {
    const nextDelim = buffer.indexOf(delim, pos);
    if (nextDelim === -1) break;

    const partBuf = buffer.slice(pos, nextDelim - 2); // -2 for \r\n before boundary

    // Split headers from body
    const headerEnd = partBuf.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) { pos = nextDelim + delim.length + 2; continue; }

    const headerStr = partBuf.slice(0, headerEnd).toString('utf8');
    const bodyBuf = partBuf.slice(headerEnd + 4);

    // Parse Content-Disposition
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const fileMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*(\S+)/i);

    if (fileMatch && nameMatch) {
      parts.push({
        fieldname: nameMatch[1],
        filename: fileMatch[1],
        contentType: ctMatch ? ctMatch[1] : 'application/octet-stream',
        data: bodyBuf
      });
    }

    if (buffer.indexOf(endDelim, nextDelim) === nextDelim) break;
    pos = nextDelim + delim.length + 2;
  }

  return parts;
}

function handleListImages(server, res) {
  const meta = loadMeta();
  const list = Object.entries(meta).map(([id, info]) => ({
    id,
    ...info,
    url: `/uploads/${id}/${info.filename}`
  })).sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ images: list }));
}

function handleUploadImage(server, req, res) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Expected multipart/form-data' }));
  }

  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing boundary' }));
  }
  const boundary = boundaryMatch[1].replace(/^"|"$/g, '');

  // Collect raw buffer
  const chunks = [];
  let totalSize = 0;

  const done = (err, result) => {
    if (err) {
      res.writeHead(err === 'too_large' ? 413 : 400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: err === 'too_large' ? 'File too large (max 10 MB)' : String(err) }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  };

  req.on('data', (chunk) => {
    totalSize += chunk.length;
    if (totalSize > MAX_FILE_SIZE) {
      req.destroy();
      done('too_large');
      return;
    }
    chunks.push(chunk);
  });

  req.on('error', (e) => done(e.message));

  req.on('end', () => {
    try {
      const buffer = Buffer.concat(chunks);
      const parts = parseMultipart(buffer, boundary);
      const filePart = parts.find(p => p.data && p.data.length > 0);

      if (!filePart) {
        return done('No file found in upload');
      }
      if (!ALLOWED_TYPES.includes(filePart.contentType)) {
        return done(`Type not allowed: ${filePart.contentType}. Allowed: ${ALLOWED_TYPES.join(', ')}`);
      }

      const id = crypto.randomBytes(8).toString('hex');
      const fileDir = path.join(UPLOAD_DIR, id);
      fs.mkdirSync(fileDir, { recursive: true });

      // Sanitize filename
      const safeName = filePart.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.join(fileDir, safeName);
      fs.writeFileSync(filePath, filePart.data);

      // Save metadata
      const meta = loadMeta();
      meta[id] = {
        filename: safeName,
        originalName: filePart.filename,
        contentType: filePart.contentType,
        size: filePart.data.length,
        uploadedAt: new Date().toISOString()
      };
      saveMeta(meta);

      done(null, { success: true, image: { id, ...meta[id], url: `/uploads/${id}/${safeName}` } });
    } catch (e) {
      done(e.message);
    }
  });
}

function handleDeleteImage(server, res, imageId) {
  const meta = loadMeta();
  if (!meta[imageId]) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Image not found' }));
  }

  const fileDir = path.join(UPLOAD_DIR, imageId);
  if (fs.existsSync(fileDir)) {
    fs.rmSync(fileDir, { recursive: true, force: true });
  }

  delete meta[imageId];
  saveMeta(meta);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true }));
}

/**
 * Serve an uploaded image file.
 */
function serveUpload(server, req, res) {
  const url = new URL(req.url, 'http://localhost');
  // Expected: /uploads/{id}/{filename}
  const parts = url.pathname.split('/');
  // parts = ['', 'uploads', id, filename]
  if (parts.length < 4) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }

  const id = parts[2];
  const filename = parts.slice(3).join('/');
  const meta = loadMeta();

  if (!meta[id] || meta[id].filename !== filename) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }

  const filePath = path.join(UPLOAD_DIR, id, filename);
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

  res.writeHead(200, {
    'Content-Type': mimeMap[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=86400',
    'Content-Length': fs.statSync(filePath).size
  });
  fs.createReadStream(filePath).pipe(res);
}

module.exports = { handleListImages, handleUploadImage, handleDeleteImage, serveUpload };
