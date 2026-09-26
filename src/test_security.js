const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const DB = require('./db/database');
const Backup = require('./db/backup');
const Guard = require('./session-guard');

test('sessions reject forged roles, revoked accounts, logout and restored identities', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-security-'));
  const db = new DB(path.join(dir, 'db.sqlite')); await db.init();
  const guard = new Guard(db);
  const call = (name, key, args = [], fn = () => true) => guard.invoke(name, key, args, fn);
  const admin = db.getUsers()[0];
  db.createUser('Staff', 'staff', 'staff-password', 'Staff', admin);
  db.updateSettings({ require_login: '1' }, admin);
  await assert.rejects(call('getCustomers', 'anonymous'), /Sign in/);
  await assert.rejects(call('updateSettings', 'anonymous', [{}, admin]), /Sign in/);
  assert.deepEqual(Object.keys(await call('getSettings', 'anonymous')).sort(), ['business_name', 'require_login']);
  await call('authenticate', 'staff', ['staff', 'staff-password']);
  await assert.rejects(call('updateSettings', 'staff', [{}, admin]), /Administrator/);
  await assert.rejects(call('getUsers', 'staff'), /Administrator/);
  await call('createTransaction', 'staff', [{}, admin], args => assert.equal(args[1].role, 'Staff'));
  await call('authenticate', 'admin', ['admin', 'admin123']);
  await call('createUser', 'admin', ['x', 'x', 'password', 'Staff', { id: 99 }], args => assert.equal(args[4].id, admin.id));
  await call('logout', 'admin');
  await assert.rejects(call('getCustomers', 'admin'), /Sign in/);
  db.deleteUser(db.getUsers().find(user => user.username === 'staff').id, admin);
  await assert.rejects(call('getCustomers', 'staff'), /Sign in/);
  await call('authenticate', 'admin', ['admin', 'admin123']);
  await call('restoreBackup', 'admin', ['backup', admin]);
  assert.equal(await call('getSession', 'admin'), null);
  db.updateSettings({ require_login: '0' }, admin);
  assert.equal(await call('getSession', 'new-client'), null, 'Restore must lock even no-login backups');
  db.db.close();
});

test('passwords use unique salts and legacy credentials upgrade after successful login', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-password-'));
  const db = new DB(path.join(dir, 'db.sqlite')); await db.init();
  assert.notEqual(db.hashPassword('same'), db.hashPassword('same'));
  const old = crypto.createHash('sha256').update('admin123_simple_khata_salt').digest('hex');
  db.run('UPDATE users SET password_hash = ? WHERE id = 1', [old]);
  assert.equal(db.authenticate('admin', 'incorrect'), null);
  assert.equal(db.authenticate('admin', 'admin123').role, 'Admin');
  assert.match(db.query('SELECT password_hash FROM users')[0].password_hash, /^scrypt\$/);
  db.changePassword('admin123', 'updated-password', { id: 1 });
  assert.equal(db.authenticate('admin', 'admin123'), null);
  assert.equal(db.authenticate('admin', 'updated-password').id, 1);
  db.db.close();
});

test('restore rejects orphan records and preserves current database', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-restore-'));
  const db = new DB(path.join(dir, 'db.sqlite')); await db.init();
  const backups = new Backup(db, path.join(dir, 'backups'));
  const candidate = new db.SQL.Database(db.db.export());
  candidate.run("INSERT INTO customer_notes (customer_id, note, created_at) VALUES (999, 'orphan', '2026-01-01')");
  const file = path.join(dir, 'bad.sqlite'); fs.writeFileSync(file, candidate.export()); candidate.close();
  const before = fs.readFileSync(db.dbPath);
  await assert.rejects(backups.restoreBackup(file, { id: 1, role: 'Admin' }), /broken record references/);
  assert.deepEqual(fs.readFileSync(db.dbPath), before);
  db.db.close();
});
