const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], port = +process.argv[3];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(root, u);
  const tries = [f, f + '.html', path.join(f, 'index.html'), path.join(root, 'index.html')];
  const hit = tries.find((t) => t.startsWith(root) && fs.existsSync(t) && fs.statSync(t).isFile());
  res.writeHead(200, { 'Content-Type': types[path.extname(hit)] || 'application/octet-stream' });
  fs.createReadStream(hit).pipe(res);
}).listen(port, () => console.log('serving', root, 'on', port));
