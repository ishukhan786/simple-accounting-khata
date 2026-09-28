const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('./db/database');
const Backup = require('./db/backup');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-regression-'));
  const db = new Database(path.join(dir, 'khata.db'));
  await db.init();
  let passed = 0;
  const check = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };
  const admin = { id: 1, name: 'Admin', role: 'Admin' };
  const staff = { id: 2, name: 'Staff', role: 'Staff' };
  const customer = db.createCustomer({ name: 'AED Customer', currency: 'AED', opening_balance: 10000, opening_balance_type: 'Receivable' });
  const other = db.createCustomer({ name: 'AED Payable', currency: 'AED', opening_balance: 5000, opening_balance_type: 'Payable' });
  db.createCustomer({ name: 'PKR Customer', currency: 'PKR', opening_balance: 90000, opening_balance_type: 'Receivable' });
  const create = (type, amount, date = '2026-01-01') => db.createTransaction({ customer_id: customer.id, transaction_type: type, amount, transaction_date: date, description: 'Test' }).transaction;
  create('Debit', 5000);
  const credit = create('Credit', 3000, '2026-01-02');
  create('Debit', 2000, '2026-01-03');
  check('Filtered ledger carries forward previous balance and excludes later entries', () => {
    const ledger = db.getCustomerLedger(customer.id, 'ASC', '2026-01-02', '2026-01-02');
    assert.equal(ledger.summary.opening_balance, 15000);
    assert.equal(ledger.summary.total_debit, 0);
    assert.equal(ledger.summary.total_credit, 3000);
    assert.equal(ledger.summary.closing_balance, 12000);
    assert.equal(ledger.transactions[0].running_balance, 12000);
  });
  check('Empty date range carries forward balance', () => {
    const ledger = db.getCustomerLedger(customer.id, 'DESC', '2026-02-01', '2026-02-02');
    assert.equal(ledger.summary.opening_balance, 14000);
    assert.equal(ledger.summary.closing_balance, 14000);
    assert.equal(ledger.summary.total_debit, 0);
  });
  check('Reverse date range rejected', () => assert.throws(() => db.getCustomerLedger(customer.id, 'ASC', '2026-02-01', '2026-01-01')));
  check('String receipt ID resolves balances', () => assert.equal(db.getReceiptByTransactionId(String(credit.id)).previous_balance_cents, 15000));
  check('Editing credit updates receipt amount and balance', () => {
    db.updateTransaction(credit.id, { correction_reason: 'Regression correction', amount: 4000 }, admin);
    assert.equal(db.getReceiptByTransactionId(credit.id).amount, 4000);
    assert.equal(db.getReceiptByTransactionId(credit.id).remaining_balance_cents, 11000);
  });
  check('Changing credit to debit removes obsolete receipt', () => {
    db.updateTransaction(credit.id, { correction_reason: 'Regression correction', amount: 4000, transaction_type: 'Debit' }, admin);
    assert.equal(db.getReceiptByTransactionId(credit.id), null);
  });
  check('Changing debit to credit creates receipt', () => {
    db.updateTransaction(credit.id, { correction_reason: 'Regression correction', amount: 4000, transaction_type: 'Credit' }, admin);
    assert.equal(db.getReceiptByTransactionId(credit.id).amount, 4000);
  });
  for (const bad of [-1, 0, 1.5, '12oops', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    check('Invalid amount rejected: ' + bad, () => assert.throws(() => create('Debit', bad)));
  }
  check('Invalid dates rejected', () => assert.throws(() => create('Debit', 100, '2026-02-30')));
  check('Invalid opening balance rejected', () => assert.throws(() => db.createCustomer({ name: 'Invalid', currency: 'AED', opening_balance: -100, opening_balance_type: 'Receivable' })));
  check('Receivable report totals match filtered rows and isolate currency', () => {
    const report = db.getReceivableReport('AED');
    assert.equal(report.rows.length, 1);
    assert.equal(report.aedTotals.payable, 0);
    assert.equal(report.aedTotals.receivable, 13000);
    assert.equal(report.pkrTotals.receivable, 0);
  });
  check('Payable report totals exclude receivables', () => {
    const report = db.getPayableReport();
    assert.equal(report.aedTotals.receivable, 0);
    assert.equal(report.aedTotals.payable, 5000);
    assert.equal(report.pkrTotals.receivable, 0);
  });
  check('Self deletion with string ID rejected', () => assert.throws(() => db.deleteUser('1', admin)));
  check('Last administrator cannot be deleted', () => assert.throws(() => db.deleteUser(1)));
  check('Blank users and unknown roles rejected', () => {
    assert.throws(() => db.createUser(' ', 'test', 'test', 'Staff', admin));
    assert.throws(() => db.createUser('Test', 'test', 'test', 'Owner', admin));
  });
  check('Staff cannot change settings, archive, or edit historical entries', () => {
    assert.throws(() => db.updateSettings({ require_login: '0' }, staff));
    assert.throws(() => db.archiveCustomer(other.id, staff));
    assert.throws(() => db.updateTransaction(credit.id, { amount: 100 }, staff));
  });
  const backups = new Backup(db, path.join(dir, 'backups'));
  check('Advanced filters combine customer, amount and payment method', () => {
    const rows = db.getAllTransactions({ customer_id: customer.id, amount_min: 3000, amount_max: 5000, payment_method: 'Cash' });
    assert.equal(rows.length, 2);
    assert(rows.every(row => row.customer_id === customer.id && row.amount >= 3000 && row.amount <= 5000));
    assert.equal(db.getAllTransactions({ customer_id: other.id }).length, 0);
    assert.throws(() => db.getAllTransactions({ amount_min: 2000, amount_max: 1000 }));
  });
  check('Editing lookup returns the selected transaction', () => assert.equal(db.getTransactionById(credit.id).id, credit.id));
  check('Password change requires current password and validates new password', () => {
    assert.throws(() => db.changePassword('wrong', 'updated-password', admin));
    assert.throws(() => db.changePassword('admin123', 'short', admin));
    assert.throws(() => db.changePassword('admin123', 'admin123', admin));
    db.changePassword('admin123', 'updated-password', admin);
    assert.equal(db.authenticate('admin', 'admin123'), null);
    assert.equal(db.authenticate('admin', 'updated-password').id, 1);
    assert(!JSON.stringify(db.getAuditLogs()).includes('updated-password'));
  });
  check('Missing backups report due now', () => assert.equal(backups.getStatus().overdue, true));
  const first = backups.createBackup();
  const second = backups.createBackup();
  check('Rapid backups have distinct filenames', () => assert.notEqual(first.filepath, second.filepath));
  check('Successful backups show last and next schedule times', () => {
    const status = backups.getStatus();
    assert(status.lastSuccessAt);
    assert.equal(Date.parse(status.nextBackupAt) - Date.parse(status.lastSuccessAt), 24 * 3600000);
    assert.equal(status.overdue, false);
    db.updateSettings({ auto_backup_frequency: 'Manual Only' }, admin);
    assert.equal(backups.getStatus().nextBackupAt, null);
    assert.equal(backups.getStatus().overdue, false);
    db.updateSettings({ auto_backup_frequency: 'Daily' }, admin);
  });
  check('Overdue backups retry and expose failure status', () => {
    const oldTime = new Date(Date.now() - 2 * 86400000);
    fs.utimesSync(first.filepath, oldTime, oldTime);
    fs.utimesSync(second.filepath, oldTime, oldTime);
    assert.equal(backups.getStatus().overdue, true);
    const originalCreate = backups.createBackup;
    backups.createBackup = () => { throw new Error('Simulated backup failure'); };
    assert.throws(() => backups.checkAutoBackup(), /Simulated backup failure/);
    assert.equal(backups.getStatus().lastError, 'Simulated backup failure');
    backups.createBackup = originalCreate;
    backups.checkAutoBackup();
    assert.equal(backups.getStatus().lastError, null);
    assert.equal(backups.getStatus().overdue, false);
  });
  db.createCustomer({ name: 'Later Customer', currency: 'AED' });
  const currentCount = db.getCustomers().length;
  const foreignDb = new db.SQL.Database();
  foreignDb.run('CREATE TABLE unrelated (id INTEGER)');
  const invalidPath = path.join(dir, 'unrelated.db');
  fs.writeFileSync(invalidPath, Buffer.from(foreignDb.export()));
  await assert.rejects(() => backups.restoreBackup(invalidPath), /valid Simple Khata backup/);
  check('Unrelated SQLite backup leaves live records intact', () => assert.equal(db.getCustomers().length, currentCount));
  const save = db.saveToDisk;
  let saves = 0;
  db.saveToDisk = function() { saves++; if (saves === 3) throw new Error('Simulated disk failure'); return save.call(this); };
  await assert.rejects(() => backups.restoreBackup(first.filepath), /Simulated disk failure/);
  db.saveToDisk = save;
  check('Failed restore rolls back memory and disk together', () => {
    assert.equal(db.getCustomers().length, currentCount);
    const disk = new db.SQL.Database(fs.readFileSync(db.dbPath));
    assert.equal(disk.exec('SELECT COUNT(*) FROM customers')[0].values[0][0], currentCount);
    disk.close();
  });
  await assert.rejects(() => backups.restoreBackup(first.filepath, staff), /Administrator/);
  passed++; console.log('PASS Staff restore rejected');
  await backups.restoreBackup(first.filepath);
  check('Valid restore reinstates backup records', () => assert.equal(db.getCustomers().length, 3));
  const corruptPath = path.join(dir, 'corrupt.db');
  const corruptBytes = Buffer.from('not a database');
  fs.writeFileSync(corruptPath, corruptBytes);
  await assert.rejects(() => new Database(corruptPath).init());
  check('Corrupt database is never overwritten on startup', () => assert.deepEqual(fs.readFileSync(corruptPath), corruptBytes));
  console.log(`All ${passed} regression checks passed. Temporary data: ${dir}`);
})().catch(err => { console.error(err); process.exitCode = 1; });
