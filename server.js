const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const isDev = process.env.NODE_ENV === 'development';

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
};
const link = (url) => `${c.cyan}${url}${c.reset}`;

app.use(express.json({ limit: '5mb' }));

// En desarrollo, servir index.html con el script de live reload inyectado (una sola URL)
if (isDev) {
  const indexPath = path.join(__dirname, 'index.html');
  const reloadScript = '<script src="/reload-client.js"></script>';
  app.get('/', (req, res, next) => {
    fs.readFile(indexPath, 'utf8', (err, html) => {
      if (err) return next(err);
      const injected = html.replace('</body>', reloadScript + '\n</body>');
      res.setHeader('Content-Type', 'text/html');
      res.send(injected);
    });
  });
  app.get('/index.html', (req, res, next) => {
    fs.readFile(indexPath, 'utf8', (err, html) => {
      if (err) return next(err);
      const injected = html.replace('</body>', reloadScript + '\n</body>');
      res.setHeader('Content-Type', 'text/html');
      res.send(injected);
    });
  });
}

app.use(express.static(__dirname));

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    return [];
  }
}

function writeData(data) {
  if (!Array.isArray(data)) data = [];
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

app.get('/api/data', (req, res) => {
  res.json(readData());
});

app.post('/api/data', (req, res) => {
  const body = req.body;
  const data = Array.isArray(body) ? body : [];
  writeData(data);
  res.json({ ok: true });
});

// Live reload en desarrollo: SSE para notificar cambios en archivos
let reloadClients = [];

if (isDev) {
  const chokidar = require('chokidar');
  const watcher = chokidar.watch(
    [path.join(__dirname, '*.html'), path.join(__dirname, '*.css'), path.join(__dirname, '*.js')],
    { ignored: /node_modules|data\.json/, ignoreInitial: true }
  );
  watcher.on('change', (file) => {
    const name = path.basename(file);
    console.log(`${c.dim}↻${c.reset} ${c.green}${name}${c.reset} ${c.dim}→ recargando${c.reset}`);
    reloadClients.forEach((res) => {
      try {
        res.write('data: reload\n\n');
      } catch (_) {}
    });
  });

  app.get('/__reload__', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    reloadClients.push(res);
    req.on('close', () => {
      reloadClients = reloadClients.filter((r) => r !== res);
    });
  });

  app.get('/reload-client.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`
(function() {
  var es = new EventSource('/__reload__');
  es.onmessage = function() { window.location.reload(); };
})();
`);
  });
}

function startServer(port) {
  const server = app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log(`  ${c.bold}Prompt Injection DB${c.reset}`);
    console.log(`  ${c.dim}─────────────────${c.reset}`);
    console.log(`  ${link(url)}${isDev ? `  ${c.dim}(live reload)${c.reset}` : ''}`);
    console.log(`  ${c.dim}Data${c.reset}   ${c.yellow}${path.relative(process.cwd(), DATA_FILE) || DATA_FILE}${c.reset}`);
    console.log('');
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.log(`${c.dim}↻${c.reset} ${c.yellow}Puerto ${port} ocupado${c.reset} ${c.dim}→ probando ${port + 1}${c.reset}`);
      startServer(port + 1);
      return;
    }
    throw err;
  });
}

startServer(PORT);
