// LAN sync server for Kites and Threads Workflow. Run on one computer: node sync-server.js
// Other devices on the same wifi open http://<this-computer-ip>:8787 and use "Pull"/"Push".
// No dependencies. Anyone on your network who can reach the port can read and change the data,
// so only run it on a network you trust.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('./workflow.js');

const PORT = Number(process.env.PORT) || 8787;
const DIR = __dirname;
const DATA_FILE = path.join(DIR, 'sync-data.json');
const MAX_BODY = 5 * 1024 * 1024;

// Only these files are served. The data file is never exposed directly.
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/workflow.js': ['workflow.js', 'text/javascript; charset=utf-8'],
};

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { code: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function saveAtomic(text) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, DATA_FILE);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/state') {
    if (req.method === 'GET') {
      if (!fs.existsSync(DATA_FILE)) return send(res, 404, 'text/plain', 'No data on the server yet.');
      return send(res, 200, 'application/json; charset=utf-8', fs.readFileSync(DATA_FILE, 'utf8'));
    }
    if (req.method === 'PUT') {
      try {
        const text = await readBody(req);
        const data = W.importData(text); // throws on anything that is not a valid backup
        saveAtomic(W.exportData(data));
        return send(res, 200, 'application/json', JSON.stringify({ ok: true }));
      } catch (e) {
        return send(res, e.code === 413 ? 413 : 400, 'text/plain', 'Rejected: ' + e.message);
      }
    }
    return send(res, 405, 'text/plain', 'Method not allowed');
  }

  const entry = STATIC[url.pathname];
  if (req.method === 'GET' && entry) {
    return send(res, 200, entry[1], fs.readFileSync(path.join(DIR, entry[0])));
  }
  return send(res, 404, 'text/plain', 'Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kites and Threads sync server on port ${PORT}`);
  console.log(`  this computer: http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  other devices: http://${i.address}:${PORT}`);
    }
  }
});
