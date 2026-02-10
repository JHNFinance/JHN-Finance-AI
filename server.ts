import { createServer } from 'http';
import { readFile, readdir } from 'fs/promises';
import { join, extname } from 'path';
import process from 'process';

/**
 * JHN Finance AI Agent - Production Static Server
 * Injects the GOOGLE_GEMINI_API_KEY into the browser's process.env context.
 */

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.tsx': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  let urlPath = req.url || '/';
  if (urlPath === '/') urlPath = '/index.html';
  
  const cleanPath = urlPath.split('?')[0].replace(/^(\.\.[\/\\])+/, '');
  const filePath = join(process.cwd(), cleanPath);

  try {
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    if (cleanPath === '/index.html') {
      let html = await readFile(filePath, 'utf-8');
      
      // Use GOOGLE_GEMINI_API_KEY as requested, fallback to API_KEY
      const effectiveApiKey = process.env.GOOGLE_GEMINI_API_KEY || process.env.API_KEY || '';
      
      const apiKeyScript = `
        <script>
          window.process = window.process || { env: {} };
          window.process.env = window.process.env || {};
          window.process.env.API_KEY = ${JSON.stringify(effectiveApiKey)};
          window.process.env.GOOGLE_GEMINI_API_KEY = ${JSON.stringify(effectiveApiKey)};
        </script>
      `;
      html = html.replace('<head>', `<head>${apiKeyScript}`);
      
      res.writeHead(200, { 
        'Content-Type': 'text/html',
        'Permissions-Policy': 'microphone=*'
      });
      return res.end(html);
    }

    const data = await readFile(filePath);
    res.writeHead(200, { 
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy': 'microphone=*'
    });
    res.end(data);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      res.writeHead(404);
      res.end('404 Not Found');
    } else {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
});

server.listen(Number(PORT), HOST, () => {
  console.log(`JHN Finance Agent running on http://${HOST}:${PORT}`);
});
