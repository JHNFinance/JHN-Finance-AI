import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PORT = process.env.PORT || 3000;
const WIX_WEBHOOK_URL = process.env.WIX_WEBHOOK_URL || 'https://manage.wix.com/_api/webhook-trigger/report/63793e4c-78ef-428f-ac61-a109a30f29d1/507452c8-fff6-48f6-b12b-dbe871e8fed9';

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && (req.url === '/api/submit-quote' || req.url === '/api/submit-quote/')) {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body);
      const wh = await fetch(WIX_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      res.writeHead(wh.ok ? 200 : wh.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: wh.ok, status: wh.status }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  let file = req.url === '/' ? '/index.html' : req.url;
  file = path.join(DIST, path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, ''));

  fs.readFile(file, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(DIST, 'index.html'), (e, fallback) => {
          if (e) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Permissions-Policy': 'microphone=*',
          });
          res.end(fallback);
        });
        return;
      }
      res.writeHead(500);
      res.end('Server error');
      return;
    }

    const ext = path.extname(file);
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Permissions-Policy': 'microphone=*',
    };
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Serving on port ${PORT}`);
});
