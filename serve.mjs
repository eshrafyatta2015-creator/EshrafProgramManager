import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { routeSms } from './server/smsGateway.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
  '.gs': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const MAX_BODY = 256 * 1024;

function readJsonBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);

  /* بوابة الإرسال المباشر (Server-side فقط — الأسرار من process.env) */
  if (p.startsWith('/api/sms/')) {
    const body = req.method === 'POST' ? await readJsonBody(req) : null;
    if (req.method === 'POST' && body === null) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, code: 'BAD_JSON', error: 'جسم الطلب ليس JSON صالحاً.' }));
      return;
    }
    try {
      const out = await routeSms({ method: req.method, path: p, body, env: process.env });
      res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(out.json));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, code: 'SERVER_ERROR', error: 'خطأ داخلي في خادم الإرسال.' }));
    }
    return;
  }

  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(parseInt(process.env.PORT || '8177', 10), () => console.log('EshrafProgramManager dev server: http://localhost:' + (process.env.PORT || '8177') + '/'));
