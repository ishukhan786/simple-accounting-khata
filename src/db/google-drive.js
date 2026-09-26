const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3/files';
const MAX_BYTES = 256 * 1024 * 1024;

// Desktop-only: user tokens never enter the renderer, database or its backups.
class GoogleDriveBackup {
  constructor({ directory, backupManager, safeStorage, openExternal, defaultClient, fetchImpl = fetch }) {
    this.directory = directory;
    this.backupManager = backupManager;
    this.safeStorage = safeStorage;
    this.openExternal = openExternal;
    this.fetch = fetchImpl;
    this.pendingDir = path.join(directory, 'pending');
    this.vaultPath = path.join(directory, 'connection.bin');
    this.statusPath = path.join(directory, 'status.json');
    fs.mkdirSync(this.pendingDir, { recursive: true });
    this.saved = {};
    try { this.saved = JSON.parse(fs.readFileSync(this.statusPath, 'utf8')); } catch { /* First launch. */ }
    this.credentials = {};
    if (fs.existsSync(this.vaultPath)) {
      try { this.credentials = JSON.parse(safeStorage.decryptString(fs.readFileSync(this.vaultPath))); }
      catch { this.lastError = 'Windows could not unlock the Google connection. Import credentials and connect again.'; }
    }
    // A Desktop OAuth client identifies the distributed app, not a Gmail user.
    // Preserve imported clients so existing app-data backups stay accessible.
    if (!this.credentials.client_id && defaultClient) this.credentials = this.validateClient(defaultClient);
  }

  persistCredentials() {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable. Google sign-in was not saved.');
    const temporary = this.vaultPath + '.tmp';
    fs.writeFileSync(temporary, this.safeStorage.encryptString(JSON.stringify(this.credentials)));
    fs.renameSync(temporary, this.vaultPath);
  }

  persistStatus() {
    fs.writeFileSync(this.statusPath + '.tmp', JSON.stringify(this.saved));
    fs.renameSync(this.statusPath + '.tmp', this.statusPath);
  }

  pendingFiles() { return fs.readdirSync(this.pendingDir).filter(name => /^Khata_Backup_[\w.-]+\.db$/.test(name)).sort(); }

  status() {
    return { configured: Boolean(this.credentials.client_id), connected: Boolean(this.credentials.refresh_token),
      accountEmail: this.credentials.account?.emailAddress || null,
      accountName: this.credentials.account?.displayName || null,
      needsReconnect: Boolean(this.needsReconnect),
      busy: Boolean(this.busy), lastSuccessAt: this.saved.lastSuccessAt || null,
      pending: this.pendingFiles().length, lastError: this.lastError || null };
  }

  validateClient(json) {
    const config = json.installed;
    if (!config || typeof config.client_id !== 'string' || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(config.client_id) || typeof config.client_secret !== 'string' || !config.client_secret) {
      throw new Error('Choose the JSON credentials downloaded for a Google Desktop app OAuth client.');
    }
    return { client_id: config.client_id, client_secret: config.client_secret };
  }

  configure(json) {
    if (this.busy || this.credentials.refresh_token) throw new Error('Disconnect Google Drive before changing its setup.');
    const config = this.validateClient(json);
    this.preservePendingLocally();
    this.saved = {}; this.persistStatus();
    this.credentials = config;
    this.persistCredentials();
    this.lastError = null;
    return this.status();
  }

  async exclusive(action) {
    if (this.busy) throw new Error('A Google Drive operation is already running. Please wait.');
    this.busy = true;
    try { return await action(); }
    catch (error) { this.lastError = error.message; throw error; }
    finally { this.busy = false; }
  }

  async tokenRequest(params) {
    const response = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({ client_id: this.credentials.client_id, client_secret: this.credentials.client_secret, ...params }),
      signal: AbortSignal.timeout(30000)
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.error === 'invalid_grant' && params.grant_type === 'refresh_token') this.needsReconnect = true;
      throw new Error(result.error === 'invalid_grant' ? 'Google permission expired or was revoked. Click Reconnect Google Account.' : 'Google sign-in failed. Check your OAuth setup and try again.');
    }
    if (!result.access_token) throw new Error('Google did not return an access token.');
    return result;
  }

  async connect(replaceConnection = false) {
    return this.exclusive(async () => {
      if (!this.credentials.client_id) throw new Error('Import the Google Desktop app credentials first.');
      if (this.credentials.refresh_token && !replaceConnection) throw new Error('Google Drive is already connected. Use Change Google Account.');
      const verifier = crypto.randomBytes(48).toString('base64url');
      const nonce = crypto.randomBytes(32).toString('base64url');
      let finish, timer;
      const callback = new Promise((resolve, reject) => { finish = (err, code) => err ? reject(err) : resolve(code); });
      // Attach immediately so a browser-launch failure cannot leave an unhandled rejection.
      callback.catch(() => {});
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET' || url.pathname !== '/oauth2callback' || url.searchParams.get('state') !== nonce) {
          res.writeHead(400); res.end('Invalid sign-in response.'); return;
        }
        const code = url.searchParams.get('code');
        res.end(code ? 'Sign-in received. Return to Simple Khata to finish connecting.' : 'Sign-in cancelled. Return to Simple Khata.');
        finish(code ? null : new Error('Google sign-in was cancelled or denied. Your previous connection has been kept.'), code);
      });
      try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`;
        const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        auth.search = new URLSearchParams({ client_id: this.credentials.client_id, redirect_uri: redirect,
          response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent select_account',
          state: nonce, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
        timer = setTimeout(() => finish(new Error('Sign-in timed out. Click Connect Google Drive to retry.')), 180000);
        await this.openExternal(auth.toString());
        const code = await callback;
        const tokens = await this.tokenRequest({ code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' });
        if (!tokens.refresh_token) throw new Error('Google did not grant offline backup access. Connect again and allow backup access.');
        const accountResponse = await this.fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,permissionId)', {
          headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(30000)
        });
        if (!accountResponse.ok) throw new Error('Could not verify the selected Google account. Ensure Google Drive API is enabled, then retry.');
        const { user: account } = await accountResponse.json();
        if (!account?.emailAddress || !account?.permissionId) throw new Error('Google did not identify the selected backup account. Please retry.');
        const previous = this.credentials;
        const sameAccount = previous.account?.permissionId === account.permissionId;
        // Never send the previous account's queued files to a different Gmail.
        if (!sameAccount) this.preservePendingLocally();
        this.credentials = { client_id: previous.client_id, client_secret: previous.client_secret, refresh_token: tokens.refresh_token,
          account: { emailAddress: account.emailAddress, displayName: account.displayName || '', permissionId: account.permissionId } };
        try { this.persistCredentials(); } catch (err) { this.credentials = previous; throw err; }
        this.accessToken = tokens.access_token;
        this.expiresAt = Date.now() + tokens.expires_in * 1000;
        this.needsReconnect = false;
        if (!sameAccount) { this.saved = {}; this.persistStatus(); }
        this.lastError = null;
        return this.status();
      } finally { clearTimeout(timer); server.close(); server.closeAllConnections?.(); }
    });
  }

  switchAccount() { return this.connect(true); }

  async access() {
    if (!this.credentials.refresh_token) throw new Error('Connect Google Drive first.');
    if (!this.accessToken || Date.now() >= this.expiresAt - 60000) {
      const tokens = await this.tokenRequest({ refresh_token: this.credentials.refresh_token, grant_type: 'refresh_token' });
      this.accessToken = tokens.access_token;
      this.expiresAt = Date.now() + tokens.expires_in * 1000;
    }
    return this.accessToken;
  }

  async request(url, options = {}, retry = true) {
    const token = await this.access();
    const response = await this.fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000) });
    if (response.status === 401 && retry) { this.accessToken = null; return this.request(url, options, false); }
    if (!response.ok) throw new Error(response.status === 403 ? 'Google Drive denied access. Check that Drive API is enabled and your account has storage available.' : `Google Drive request failed (${response.status}). It can be retried.`);
    return response;
  }

  enqueue(backup) {
    if (!this.credentials.refresh_token) return;
    const name = path.basename(backup.filepath);
    if (!/^Khata_Backup_[\w.-]+\.db$/.test(name)) throw new Error('Invalid backup filename.');
    const destination = path.join(this.pendingDir, name);
    fs.copyFileSync(backup.filepath, destination + '.tmp');
    fs.renameSync(destination + '.tmp', destination);
  }

  async flush() {
    for (const name of this.pendingFiles()) {
      const file = path.join(this.pendingDir, name);
      const size = fs.statSync(file).size;
      if (size > MAX_BYTES) throw new Error('This backup exceeds the 256 MB cloud backup limit. Keep the local backup.');
      const data = fs.readFileSync(file);
      const hash = crypto.createHash('md5').update(data).digest('hex');
      // Resolve an upload whose response was lost, without creating duplicate snapshots.
      const query = new URLSearchParams({ spaces: 'appDataFolder', q: `trashed = false and name = '${name}'`, fields: 'files(id,md5Checksum)', pageSize: '100' });
      const existing = await (await this.request(`${API}?${query}`)).json();
      if (!existing.files?.some(item => item.md5Checksum === hash)) {
        const boundary = 'khata_' + crypto.randomBytes(16).toString('hex');
        const metadata = { name, parents: ['appDataFolder'], appProperties: { application: 'simple-khata', format: 'sqlite-v1' } };
        const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
        const uploaded = await (await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,md5Checksum', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json();
        if (uploaded.md5Checksum !== hash) throw new Error('Uploaded backup checksum could not be verified. The local copy is kept for retry.');
      }
      this.saved.lastSuccessAt = new Date().toISOString();
      this.persistStatus();
      fs.unlinkSync(file);
    }
    this.lastError = null;
  }

  async backupNow(user) {
    return this.exclusive(async () => {
      if (!this.credentials.refresh_token) throw new Error('Connect Google Drive first.');
      const backup = this.backupManager.createBackup(null, user);
      this.enqueue(backup);
      await this.flush();
      return this.status();
    });
  }

  async list() {
    return this.exclusive(async () => {
      const files = [];
      let pageToken;
      do {
        const query = new URLSearchParams({ spaces: 'appDataFolder', q: "trashed = false and appProperties has { key='application' and value='simple-khata' }", fields: 'nextPageToken,files(id,name,size,createdTime,md5Checksum)', pageSize: '100', orderBy: 'createdTime desc' });
        if (pageToken) query.set('pageToken', pageToken);
        const page = await (await this.request(`${API}?${query}`)).json();
        files.push(...(page.files || [])); pageToken = page.nextPageToken;
      } while (pageToken);
      this.lastError = null;
      return files;
    });
  }

  async restore(id, user) {
    return this.exclusive(async () => {
      if (!/^[\w-]+$/.test(id)) throw new Error('Invalid Google Drive backup ID.');
      const meta = await (await this.request(`${API}/${id}?fields=id,name,size,md5Checksum,appProperties,parents`)).json();
      if (meta.appProperties?.application !== 'simple-khata' || meta.appProperties?.format !== 'sqlite-v1' || !meta.md5Checksum || Number(meta.size) > MAX_BYTES) throw new Error('This is not a supported Simple Khata backup.');
      const response = await this.request(`${API}/${id}?alt=media`);
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) { bytes += chunk.length; if (bytes > MAX_BYTES) throw new Error('Backup is too large.'); chunks.push(Buffer.from(chunk)); }
      const data = Buffer.concat(chunks);
      if (crypto.createHash('md5').update(data).digest('hex') !== meta.md5Checksum) throw new Error('Downloaded backup failed its integrity check. Current records were not changed.');
      const temporary = path.join(this.directory, 'restore-' + crypto.randomUUID() + '.db');
      try { fs.writeFileSync(temporary, data); return await this.backupManager.restoreBackup(temporary, user); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    });
  }

  preservePendingLocally() {
    for (const name of this.pendingFiles()) {
      const pending = path.join(this.pendingDir, name);
      fs.copyFileSync(pending, path.join(this.backupManager.backupsDir, name));
      fs.unlinkSync(pending);
    }
  }

  async disconnect() {
    return this.exclusive(async () => {
      // Remove local access even offline. Revoke remote access when reachable.
      const token = this.credentials.refresh_token;
      this.credentials = { client_id: this.credentials.client_id, client_secret: this.credentials.client_secret };
      this.persistCredentials(); this.accessToken = null;
      this.needsReconnect = false;
      // Pending snapshots remain local, but are not sent to a subsequently connected account.
      this.preservePendingLocally();
      this.saved = {}; this.persistStatus(); this.lastError = null;
      if (token) {
        try { const r = await this.fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(); }
        catch { this.lastError = 'Disconnected locally. To revoke Google permission as well, visit your Google Account connections.'; }
      }
      return this.status();
    });
  }

  start() {
    const retry = async () => {
      if (this.busy || !this.credentials.refresh_token || !this.pendingFiles().length) return;
      try { await this.exclusive(() => this.flush()); } catch { /* Visible status; pending snapshots survive restart. */ }
    };
    this.scheduler = setInterval(retry, 60000); this.scheduler.unref();
    retry();
  }
}
module.exports = GoogleDriveBackup;
