const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const GoogleDriveBackup = require('./db/google-drive');
const Database = require('./db/database');
const Backup = require('./db/backup');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const admin = { id: 1, name: 'Admin', role: 'Admin' };

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-drive-test-'));
  const db = new Database(path.join(directory, 'khata.db')); await db.init();
  const backup = new Backup(db, path.join(directory, 'backups'));
  // Test double only. Production uses Windows-backed Electron safeStorage.
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
  const remote = []; let offline = false, loseResponse = false, refreshes = 0;
  const network = async (url, options = {}) => {
    if (offline) throw new Error('Network offline');
    if (url.includes('/token')) { refreshes++; return json({ access_token: 'test-access', expires_in: 3600 }); }
    if (url.includes('/revoke')) return json({});
    if (url.includes('/upload/')) {
      const boundary = options.headers['Content-Type'].split('boundary=')[1];
      const body = options.body;
      const metadataEnd = body.indexOf('\r\n--' + boundary);
      const metadata = JSON.parse(body.subarray(body.indexOf('\r\n\r\n') + 4, metadataEnd).toString());
      const start = body.indexOf('\r\n\r\n', metadataEnd) + 4;
      const end = body.lastIndexOf('\r\n--' + boundary);
      const data = body.subarray(start, end);
      const item = { id: 'backup_' + remote.length, ...metadata, size: data.length, createdTime: new Date().toISOString(), md5Checksum: crypto.createHash('md5').update(data).digest('hex'), data };
      remote.push(item);
      if (loseResponse) { loseResponse = false; throw new Error('Upload response lost'); }
      return json(item);
    }
    const u = new URL(url);
    const id = u.pathname.split('/').pop();
    if (id !== 'files') {
      const item = remote.find(f => f.id === id);
      return u.searchParams.get('alt') === 'media' ? new Response(item.data) : json(item);
    }
    const q = u.searchParams.get('q');
    const name = q?.match(/name = '([^']+)'/)?.[1];
    return json({ files: name ? remote.filter(f => f.name === name) : remote });
  };
  const args = { directory: path.join(directory, 'drive'), backupManager: backup, safeStorage, fetchImpl: network, openExternal: async () => {} };
  const drive = new GoogleDriveBackup(args);
  drive.configure({ installed: { client_id: 'test.apps.googleusercontent.com', client_secret: 'test-secret' } });
  drive.credentials.refresh_token = 'test-refresh'; drive.persistCredentials();
  backup.onBackupCreated = b => drive.enqueue(b);
  t.after(() => { db.db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { drive, db, backup, remote, args, setOffline: v => offline = v, loseResponse: () => loseResponse = true, refreshes: () => refreshes };
}

test('offline snapshots survive restart and upload once after a lost response', async t => {
  const f = await fixture(t); f.setOffline(true);
  await assert.rejects(f.drive.backupNow(admin), /offline/);
  assert.equal(f.drive.status().pending, 1); assert.equal(f.drive.status().lastSuccessAt, null);
  const restarted = new GoogleDriveBackup(f.args); assert.equal(restarted.status().pending, 1);
  f.setOffline(false); f.loseResponse();
  await assert.rejects(restarted.exclusive(() => restarted.flush()), /response lost/);
  assert.equal(f.remote.length, 1); assert.equal(restarted.status().pending, 1);
  await restarted.exclusive(() => restarted.flush());
  assert.equal(f.remote.length, 1); assert.equal(restarted.status().pending, 0); assert(restarted.status().lastSuccessAt);
  assert(!JSON.stringify(restarted.status()).includes('test-refresh'));
  assert.equal(f.refreshes(), 1);
});

test('verified restore recovers snapshot and makes a safety copy; corruption leaves current data intact', async t => {
  const f = await fixture(t);
  f.db.createCustomer({ name: 'Original customer', currency: 'AED' });
  await f.drive.backupNow(admin);
  f.db.createCustomer({ name: 'Later customer', currency: 'AED' });
  await f.drive.restore(f.remote[0].id, admin);
  assert.equal(f.db.getCustomers('', false).length, 1);
  assert(f.backup.getBackupList().some(b => b.filename.startsWith('Khata_PreRestore_')));
  f.remote[0].data = Buffer.from('corrupt');
  await assert.rejects(f.drive.restore(f.remote[0].id, admin), /integrity check/);
  assert.equal(f.db.getCustomers('', false).length, 1);
});

test('disconnect preserves pending backups locally and removes saved access', async t => {
  const f = await fixture(t); f.setOffline(true);
  await assert.rejects(f.drive.backupNow(admin));
  const name = f.drive.pendingFiles()[0];
  fs.unlinkSync(path.join(f.backup.backupsDir, name));
  await f.drive.disconnect();
  assert.equal(f.drive.status().connected, false); assert.equal(f.drive.status().pending, 0);
  assert(fs.existsSync(path.join(f.backup.backupsDir, name)));
  assert.equal(new GoogleDriveBackup(f.args).status().connected, false);
});

test('rejects incorrect credentials, overlapping operations and unsupported restore files', async t => {
  const f = await fixture(t);
  await assert.rejects(f.drive.connect(), /already connected/);
  f.drive.busy = true; await assert.rejects(f.drive.backupNow(admin), /already running/); f.drive.busy = false;
  await f.drive.backupNow(admin); f.remote[0].appProperties.application = 'unrelated';
  await assert.rejects(f.drive.restore(f.remote[0].id, admin), /not a supported/);
  await f.drive.disconnect();
  assert.throws(() => f.drive.configure({ web: {} }), /Desktop app/);
});

test('OAuth callback rejects wrong state and exchanges a valid code with PKCE', async t => {
  const f = await fixture(t); await f.drive.disconnect();
  let challenge;
  f.drive.openExternal = async address => {
    const auth = new URL(address); challenge = auth.searchParams.get('code_challenge');
    const callback = new URL(auth.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: 'wrong', code: 'fake' }).toString();
    assert.equal((await fetch(callback)).status, 400);
    callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'valid-code' }).toString();
    assert.equal((await fetch(callback)).status, 200);
  };
  f.drive.fetch = async (url, options) => {
    if (url.includes('/about?')) return json({ user: { emailAddress: 'first@gmail.com', displayName: 'First User', permissionId: 'first-account' } });
    assert.equal(options.body.get('code'), 'valid-code');
    assert.equal(crypto.createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), challenge);
    return json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
  };
  await f.drive.connect(); assert.equal(f.drive.status().connected, true);
  assert.equal(f.drive.status().accountEmail, 'first@gmail.com');
  assert.equal(new GoogleDriveBackup(f.args).status().accountEmail, 'first@gmail.com');
});

function mockSignIn(drive, account, cancel = false) {
  drive.openExternal = async address => {
    const auth = new URL(address);
    assert.equal(auth.searchParams.get('prompt'), 'consent select_account');
    assert.equal(auth.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.appdata');
    assert.equal(auth.searchParams.has('hd'), false);
    assert.equal(auth.searchParams.has('login_hint'), false);
    const callback = new URL(auth.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), ...(cancel ? { error: 'access_denied' } : { code: 'valid' }) });
    await fetch(callback);
  };
  drive.fetch = async url => url.includes('/about?') ? json({ user: account }) : json({ access_token: 'access-' + account.permissionId, refresh_token: 'refresh-' + account.permissionId, expires_in: 3600 });
}

test('bundled Desktop client is ready without importing and preserves an existing client', async t => {
  const f = await fixture(t);
  const defaultClient = { installed: { client_id: 'bundled.apps.googleusercontent.com', client_secret: 'app-config' } };
  const fresh = new GoogleDriveBackup({ ...f.args, directory: path.join(path.dirname(f.args.directory), 'fresh-drive'), defaultClient });
  assert.equal(fresh.status().configured, true);
  assert.equal(fresh.status().connected, false);
  assert.equal(fresh.status().accountEmail, null);
  const restored = new GoogleDriveBackup({ ...f.args, defaultClient });
  assert.equal(restored.credentials.client_id, 'test.apps.googleusercontent.com');
});

test('changing Gmail isolates queued backups and saves the verified email', async t => {
  const f = await fixture(t);
  f.drive.credentials.account = { emailAddress: 'first@gmail.com', permissionId: 'first' };
  f.setOffline(true); await assert.rejects(f.drive.backupNow(admin));
  const pending = f.drive.pendingFiles()[0];
  mockSignIn(f.drive, { emailAddress: 'second@gmail.com', displayName: 'Second', permissionId: 'second' });
  await f.drive.switchAccount();
  assert.equal(f.drive.status().accountEmail, 'second@gmail.com');
  assert.equal(f.drive.status().pending, 0);
  assert.equal(f.drive.status().lastSuccessAt, null);
  assert(fs.existsSync(path.join(f.backup.backupsDir, pending)));
  assert.equal(await f.drive.access(), 'access-second');
  assert.equal(new GoogleDriveBackup(f.args).status().accountEmail, 'second@gmail.com');
});

test('cancelled Gmail switch keeps the old connection and its pending uploads', async t => {
  const f = await fixture(t);
  f.drive.credentials.account = { emailAddress: 'first@gmail.com', permissionId: 'first' };
  f.setOffline(true); await assert.rejects(f.drive.backupNow(admin));
  mockSignIn(f.drive, { permissionId: 'second' }, true);
  await assert.rejects(f.drive.switchAccount(), /cancelled or denied/);
  assert.equal(f.drive.status().accountEmail, 'first@gmail.com');
  assert.equal(f.drive.credentials.refresh_token, 'test-refresh');
  assert.equal(f.drive.status().pending, 1);
});

test('reconnecting the same Gmail keeps its queued backups and clears expired access', async t => {
  const f = await fixture(t);
  const account = { emailAddress: 'first@gmail.com', permissionId: 'first' };
  f.drive.credentials.account = account;
  f.setOffline(true); await assert.rejects(f.drive.backupNow(admin));
  f.drive.fetch = async () => json({ error: 'invalid_grant' }, 400);
  await assert.rejects(f.drive.access(), /Reconnect/);
  assert.equal(f.drive.status().needsReconnect, true);
  mockSignIn(f.drive, account);
  await f.drive.switchAccount();
  assert.equal(f.drive.status().pending, 1);
  assert.equal(f.drive.status().needsReconnect, false);
});
