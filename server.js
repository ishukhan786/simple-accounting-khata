const http = require('http');
const crypto = require('crypto');
const SessionGuard = require('./src/session-guard');
const fs = require('fs');
const path = require('path');
const DatabaseManager = require('./src/db/database');
const BackupManager = require('./src/db/backup');

const PORT = process.env.PORT || 4567;
const dbPath = process.env.KHATA_DB_PATH || path.join(__dirname, 'data', 'khata.db');
const db = new DatabaseManager(dbPath);
const backupManager = new BackupManager(db, process.env.KHATA_BACKUP_DIR || path.join(__dirname, 'backups'));

const guard = new SessionGuard(db);
const endpointNames = { 'dashboard-data': 'getDashboardData', 'backup-status': 'getBackupStatus', 'peek-account-code': 'peekNextAccountCode', 'report-balance': 'getCustomerBalanceReport', 'report-receivable': 'getReceivableReport', 'report-payable': 'getPayableReport' };
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

async function startServer() {
  await db.init();
  backupManager.checkAutoBackup();
  backupManager.startScheduler();

  const server = http.createServer(async (req, res) => {
    const allowedHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
    if (!allowedHosts.has(req.headers.host) || (req.headers.origin && ![`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`].includes(req.headers.origin))) {
      res.writeHead(403);
      return res.end('Local application requests only.');
    }
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // API Routing
    if (req.url.startsWith('/api/')) {
      if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) {
        res.writeHead(405);
        return res.end('Use POST with application/json.');
      }
      const endpoint = req.url.replace('/api/', '');
      let body = '';
      let oversized = false;
      req.on('data', chunk => {
        if (oversized) return;
        body += chunk;
        if (Buffer.byteLength(body) > 2 * 1024 * 1024) {
          oversized = true; body = ''; res.writeHead(413); res.end('Request too large.');
        }
      });
      req.on('end', async () => {
        if (oversized) return;
        let payload = {};
        try { if (body) payload = JSON.parse(body); } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Invalid JSON.' }));
        }

        try {
          let data = null;
          let sessionKey = /(?:^|;\s*)khata_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
          if (!sessionKey) {
            sessionKey = crypto.randomBytes(32).toString('hex');
            res.setHeader('Set-Cookie', 'khata_session=' + sessionKey + '; HttpOnly; SameSite=Strict; Path=/');
          }
          const name = endpointNames[endpoint] || endpoint.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          data = await guard.invoke(name, sessionKey, name === 'authenticate' ? [payload.username, payload.password] : [], async (_, user) => {

          switch (endpoint) {
            case 'get-transaction-by-id':
              data = db.getTransactionById(payload.id);
              break;
            case 'backup-status':
              data = backupManager.getStatus();
              break;
            case 'change-password':
              data = db.changePassword(payload.currentPassword, payload.newPassword, user);
              break;
            case 'dashboard-data':
              data = db.getDashboardData();
              break;
            case 'get-customers':
              data = db.getCustomers(payload.search, payload.includeArchived);
              break;
            case 'get-customer-by-id':
              data = db.getCustomerById(payload.id);
              break;
            case 'peek-account-code':
              data = db.peekNextAccountCode();
              break;
            case 'create-customer':
              data = db.createCustomer(payload.data, user);
              break;
            case 'update-customer':
              data = db.updateCustomer(payload.id, payload.data, user);
              break;
            case 'archive-customer':
              data = db.archiveCustomer(payload.id, user);
              break;
            case 'delete-customer':
              data = db.deleteCustomer(payload.id, user);
              break;
            case 'get-customer-ledger':
              data = db.getCustomerLedger(payload.id, payload.sort, payload.from, payload.to);
              break;
            case 'create-transaction':
              data = db.createTransaction(payload.data, user);
              break;
            case 'update-transaction':
              data = db.updateTransaction(payload.id, payload.data, user);
              break;
            case 'delete-transaction':
              data = db.deleteTransaction(payload.id, user);
              break;
            case 'get-all-transactions':
              data = db.getAllTransactions(payload.filters);
              break;
            case 'get-receipt':
              data = db.getReceiptByTransactionId(payload.trxId);
              break;
            case 'get-customer-notes':
              data = db.getCustomerNotes(payload.customerId);
              break;
            case 'add-customer-note':
              data = db.addCustomerNote(payload.customerId, payload.note, user);
              break;
            case 'get-settings':
              data = db.getSettings();
              break;
            case 'update-settings':
              data = db.updateSettings(payload.data, user);
              break;
            case 'get-backups':
              data = backupManager.getBackupList();
              break;
            case 'create-backup':
              data = backupManager.createBackup(null, user);
              break;
            case 'restore-backup':
              data = await backupManager.restoreBackup(payload.filepath, user);
              break;
            case 'get-users':
              data = db.getUsers();
              break;
            case 'create-user':
              data = db.createUser(payload.name, payload.username, payload.password, payload.role, user);
              break;
            case 'delete-user':
              data = db.deleteUser(payload.id, user);
              break;
            case 'get-audit-logs':
              data = db.getAuditLogs(payload.limit);
              break;
            case 'report-balance':
              data = db.getCustomerBalanceReport(payload.currency);
              break;
            case 'report-receivable':
              data = db.getReceivableReport(payload.currency);
              break;
            case 'report-payable':
              data = db.getPayableReport(payload.currency);
              break;
            case 'authenticate':
              data = db.authenticate(payload.username, payload.password);
              break;
            default:
              throw new Error('Endpoint not found');
          }

            return data;
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data }));
        } catch (err) {
          console.error('API Error:', err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // Static Files
    const rendererRoot = path.join(__dirname, 'src', 'renderer');
    let requestPath;
    try { requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); return res.end('Invalid path.'); }
    const filePath = path.resolve(rendererRoot, '.' + (requestPath === '/' ? '/index.html' : requestPath));
    const relativePath = path.relative(rendererRoot, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) { res.writeHead(403); return res.end('Forbidden.'); }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { res.writeHead(404); return res.end('Not found.'); }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading ' + req.url);
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Simple Khata Server running at http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
