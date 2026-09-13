const http = require('http');
const fs = require('fs');
const path = require('path');

const host = process.env.ANSWERTRAVEL_WEB_HOST || '127.0.0.1';
const port = Number(process.env.ANSWERTRAVEL_WEB_PORT || 4173);
const apiPort = Number(process.env.ANSWERTRAVEL_API_PORT || 0);
const apiHost = process.env.ANSWERTRAVEL_API_HOST || host;
const root = __dirname;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  }, headers));
  res.end(body);
}

const server = http.createServer((req, res) => {
  let requestUrl;
  let pathname;
  try {
    requestUrl = new URL(req.url, `http://${host}:${port}`);
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch { return send(res, 400, 'Bad request'); }
  if (apiPort && (pathname === '/' || pathname === '/index.html') && requestUrl.searchParams.get('api') !== '1') {
    requestUrl.searchParams.set('api', '1');
    requestUrl.searchParams.set('apiBase', `http://${apiHost}:${apiPort}/api/v1`);
    const location = `${pathname === '/' ? '/index.html' : pathname}${requestUrl.search}${requestUrl.hash}`;
    return send(res, 302, `Redirecting to ${location}`, { Location: location });
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return send(res, 403, 'Forbidden');
  fs.stat(file, (statError, stat) => {
    if (statError || !stat.isFile()) return send(res, 404, 'Not found');
    fs.readFile(file, (readError, body) => {
      if (readError) return send(res, 500, 'Read error');
      send(res, 200, body, { 'Content-Type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    });
  });
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, host, () => console.log(`AnswerTravel web listening on http://${host}:${port}`));
