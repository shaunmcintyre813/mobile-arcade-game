import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PORT = process.env.PORT || 8080;
export const ROOT = __dirname;

export const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.webmanifest': 'application/manifest+json; charset=UTF-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

export function createPreviewServer(rootDirectory = ROOT) {
  return http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = parsedUrl.pathname;
    if (pathname === '/' || pathname === '') pathname = '/index.html';

    const filePath = path.join(rootDirectory, pathname);

    // Security: prevent directory traversal
    if (!filePath.startsWith(rootDirectory)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const headers = { 'Content-Type': contentType };

      // Never cache service worker on preview
      if (path.basename(filePath) === 'sw.js') {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      }

      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    });
  });
}

export const server = createPreviewServer(ROOT);

// Run automatically if executed directly as entrypoint
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMainModule) {
  server.listen(PORT, () => {
    console.log(`[Preview Server] AntiGravity Neon Pulse running at http://localhost:${PORT}/`);
  });
}
