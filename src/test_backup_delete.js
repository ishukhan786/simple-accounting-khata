const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const DB = require('./db/database'), Backup = require('./db/backup'), Guard = require('./session-guard');

test('backup deletion is Admin-only, confined to local backups, and preserves live records and other copies', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-delete-test-'));
  const db = new DB(path.join(directory, 'live.db')); await db.init();
  try {
    const admin = db.getUsers()[0], staff = {role:'Staff'};
    const backups = new Backup(db, path.join(directory, 'backups'));
    db.createCustomer({name:'Keep this customer',currency:'AED'}, admin);
    const first = backups.createBackup(null, admin), second = backups.createBackup(null, admin);
    const external = path.join(directory, first.filename); fs.copyFileSync(first.filepath, external);
    const guard = new Guard(db);
    db.createUser('Staff','staff','staff-password','Staff',admin);
    await guard.invoke('authenticate','staff',['staff','staff-password']);
    await assert.rejects(guard.invoke('deleteBackup','staff',[first.filename,admin],args=>backups.deleteBackup(...args)), /Administrator/);
    assert.throws(()=>backups.deleteBackup(first.filename, staff), /Administrator/);
    for (const name of ['../live.db','..\\live.db',external,'live.db:stream','missing.db']) {
      assert.throws(()=>backups.deleteBackup(name,admin));
    }
    const before = db.getCustomers();
    await guard.invoke('deleteBackup','admin',[first.filename,staff],args=>backups.deleteBackup(...args));
    assert.equal(fs.existsSync(first.filepath),false);
    assert.equal(fs.existsSync(second.filepath),true);
    assert.equal(fs.existsSync(external),true);
    assert.deepEqual(db.getCustomers(),before);
    assert(db.getAuditLogs().some(r=>r.action==='DELETE'&&r.description.includes(first.filename)));
    assert.throws(()=>backups.deleteBackup(first.filename,admin), /not found/);
    const liveFolder = new Backup(db,directory);
    assert.throws(()=>liveFolder.deleteBackup('live.db',admin), /active database/);
    assert(fs.existsSync(db.dbPath));
    backups.deleteBackup(second.filename,admin);
    assert.equal(backups.getStatus().backupCount,0);
    assert.equal(backups.getStatus().overdue,true);
  } finally { db.db.close(); fs.rmSync(directory,{recursive:true,force:true}); }
});
