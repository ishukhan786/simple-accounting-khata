const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
let baseUrl;
let clientCookie = '';

function post(url, data) {
  url = url.replace('http://localhost:4567', baseUrl);
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: clientCookie,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      if (res.headers['set-cookie']) clientCookie = res.headers['set-cookie'][0].split(';')[0];
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(url) {
  url = url.replace('http://localhost:4567', baseUrl);
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function runE2ETests() {
  console.log('=== Starting End-to-End API and Workflow Verification ===\n');

  // 1. Static asset verification
  console.log('1. Checking static web server serving UI...');
  const indexRes = await get('http://localhost:4567/');
  if (indexRes.status !== 200 || !indexRes.body.includes('Simple Khata')) {
    throw new Error(`Failed to load index.html, status: ${indexRes.status}`);
  }
  console.log('✓ UI index.html served successfully (contains "Simple Khata")');

  // 2. Peek next account code
  console.log('\n2. Testing auto-generated Account Code preview...');
  const peek = await post('http://localhost:4567/api/peek-account-code', {});
  console.log(`✓ Next Account Code preview: ${peek.data}`);

  // 3. Create Customer 1: Ali Khan (AED)
  console.log('\n3. Creating Customer 1 (Ali Khan, AED)...');
  const cust1 = await post('http://localhost:4567/api/create-customer', {
    data: {
      name: 'Ali Khan',
      mobile: '0501234567',
      address: 'Dubai',
      currency: 'AED',
      opening_balance: 0,
      opening_balance_type: 'Zero Balance'
    }
  });
  console.log(`✓ Created Customer: Account ${cust1.data.account_code} — ${cust1.data.name} (${cust1.data.currency})`);

  // 4. Create Customer 2: Ahmed Malik (PKR)
  console.log('\n4. Creating Customer 2 (Ahmed Malik, PKR)...');
  const cust2 = await post('http://localhost:4567/api/create-customer', {
    data: {
      name: 'Ahmed Malik',
      mobile: '03001234567',
      address: 'Lahore',
      currency: 'PKR',
      opening_balance: 1000000, // 10,000.00 PKR
      opening_balance_type: 'Receivable'
    }
  });
  console.log(`✓ Created Customer: Account ${cust2.data.account_code} — ${cust2.data.name} (${cust2.data.currency})`);

  // 5. Verify sequential code: cust1 code should be '01', cust2 code should be '02'
  if (cust1.data.account_code !== '01' || cust2.data.account_code !== '02') {
    throw new Error(`Account code generation failed: ${cust1.data.account_code}, ${cust2.data.account_code}`);
  }
  console.log('✓ Sequential unique account codes verified: 01 and 02');

  // 6. Test Debit entry for Ali Khan (AED 500.00)
  console.log('\n5. Recording Debit Transaction (AED 500.00) for Ali Khan...');
  const debTrx = await post('http://localhost:4567/api/create-transaction', {
    data: {
      customer_id: cust1.data.id,
      transaction_date: '2026-09-23',
      transaction_type: 'Debit',
      amount: 50000,
      description: 'Goods supplied on credit',
      payment_method: 'Cash'
    }
  });
  console.log(`✓ Created Debit: ${debTrx.data.transaction.transaction_code}`);

  // 7. Test Credit entry for Ali Khan (AED 200.00)
  console.log('\n6. Recording Credit Transaction (AED 200.00) for Ali Khan...');
  const credTrx = await post('http://localhost:4567/api/create-transaction', {
    data: {
      customer_id: cust1.data.id,
      transaction_date: '2026-09-23',
      transaction_type: 'Credit',
      amount: 20000,
      description: 'Partial cash payment',
      payment_method: 'Cash'
    }
  });
  console.log(`✓ Created Credit: ${credTrx.data.transaction.transaction_code}, Receipt: ${credTrx.data.receipt.receipt_number}`);

  // 8. Check Running Ledger for Ali Khan
  console.log('\n7. Verifying Customer Running Ledger...');
  const ledger = await post('http://localhost:4567/api/get-customer-ledger', {
    id: cust1.data.id,
    sort: 'ASC'
  });
  console.log(`Total transactions in ledger: ${ledger.data.transactions.length}`);
  console.log(`Closing Balance: AED ${(ledger.data.summary.closing_balance/100).toFixed(2)} [${ledger.data.summary.closing_status}]`);
  if (ledger.data.summary.closing_balance !== 30000 || ledger.data.summary.closing_status !== 'Receivable') {
    throw new Error(`Ali Khan ledger balance mismatch: ${ledger.data.summary.closing_balance}`);
  }
  console.log('✓ Ali Khan running balance correctly calculated: AED 300.00 Receivable');

  // 9. Check Receipt details
  console.log('\n8. Checking Receipt Details...');
  const receipt = await post('http://localhost:4567/api/get-receipt', {
    trxId: credTrx.data.transaction.id
  });
  console.log(`✓ Receipt #${receipt.data.receipt_number}: Customer ${receipt.data.customer_name}, Previous: AED ${(receipt.data.previous_balance_cents/100).toFixed(2)}, Received: AED ${(receipt.data.amount/100).toFixed(2)}, Remaining: AED ${(receipt.data.remaining_balance_cents/100).toFixed(2)}`);

  // 10. Customer Notes
  console.log('\n9. Testing Customer Notes...');
  const note = await post('http://localhost:4567/api/add-customer-note', {
    customerId: cust1.data.id,
    note: 'Customer promised to settle remaining 300 AED next week.'
  });
  console.log(`✓ Added Customer Note: "${note.data.note}"`);

  // 11. Dashboard Multi-Currency Isolation Check
  console.log('\n10. Checking Dashboard AED and PKR Separation...');
  const dash = await post('http://localhost:4567/api/dashboard-data', {});
  console.log(`Dashboard Total Customers: ${dash.data.total_customers}`);
  console.log(`AED Summary: Receivable = AED ${(dash.data.aed_summary.receivable_cents/100).toFixed(2)}, Received Today = AED ${(dash.data.aed_summary.today_received_cents/100).toFixed(2)}`);
  console.log(`PKR Summary: Receivable = PKR ${(dash.data.pkr_summary.receivable_cents/100).toFixed(2)}, Received Today = PKR ${(dash.data.pkr_summary.today_received_cents/100).toFixed(2)}`);

  if (dash.data.aed_summary.receivable_cents !== 30000) {
    throw new Error(`AED Receivable mismatch: expected 30000, got ${dash.data.aed_summary.receivable_cents}`);
  }
  if (dash.data.pkr_summary.receivable_cents !== 1000000) {
    throw new Error(`PKR Receivable mismatch: expected 1000000, got ${dash.data.pkr_summary.receivable_cents}`);
  }
  console.log('✓ Currencies are 100% isolated: AED 300.00 and PKR 10,000.00 never combined!');

  // 12. Reports
  console.log('\n11. Checking Financial Balance Report...');
  const rep = await post('http://localhost:4567/api/report-balance', { currency: 'ALL' });
  console.log(`Report Rows: ${rep.data.rows.length}`);
  console.log(`AED Total Receivable: AED ${(rep.data.aedTotals.receivable/100).toFixed(2)}`);
  console.log(`PKR Total Receivable: PKR ${(rep.data.pkrTotals.receivable/100).toFixed(2)}`);

  // 13. Backup
  console.log('\n12. Testing Database Backup Creation...');
  const bkp = await post('http://localhost:4567/api/create-backup', {});
  console.log(`✓ Backup created: ${bkp.data.filename}`);

  const bkpList = await post('http://localhost:4567/api/get-backups', {});
  console.log(`✓ Backups found on disk: ${bkpList.data.length}`);

  console.log('\n=== ALL END-TO-END TESTS COMPLETED SUCCESSFULLY! ===');
}

async function runIsolated() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-e2e-'));
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
    windowsHide: true,
    env: { ...process.env, PORT: String(port), KHATA_DB_PATH: path.join(dir, 'khata.db'), KHATA_BACKUP_DIR: path.join(dir, 'backups') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Test server startup timed out')), 10000);
      child.once('error', err => { clearTimeout(timeout); reject(err); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error('Test server exited: ' + code)); });
      child.stdout.on('data', data => { if (String(data).includes('Server running')) { clearTimeout(timeout); resolve(); } });
    });
    await runE2ETests();
    const transaction = await post(baseUrl + '/api/get-transaction-by-id', { id: 1 });
    if (transaction.data?.transaction_code !== 'TRX-000001') throw new Error('Transaction edit lookup failed');
    const filters = await post(baseUrl + '/api/get-all-transactions', { filters: { customer_id: 1, amount_min: 40000, amount_max: 60000, payment_method: 'Cash' } });
    if (filters.data?.length !== 1) throw new Error('Combined filters failed through API');
    const backupStatus = await post(baseUrl + '/api/backup-status', {});
    if (!backupStatus.data?.lastSuccessAt || !backupStatus.data?.nextBackupAt) throw new Error('Backup status unavailable through API');
    const changed = await post(baseUrl + '/api/change-password', { currentPassword: 'admin123', newPassword: 'test-password-updated' });
    if (!changed.success) throw new Error('Password change failed through API');
    const authenticated = await post(baseUrl + '/api/authenticate', { username: 'admin', password: 'test-password-updated' });
    if (!authenticated.data?.id) throw new Error('Updated password cannot sign in');
    console.log('PASS edit lookup, advanced filters, backup status and password change endpoints');
    const asset = await get('http://localhost:4567/js/app.js?v=test');
    if (!asset.body.includes('const khataApi')) throw new Error('Versioned JavaScript asset not served correctly');
    const missing = await get('http://localhost:4567/missing.js');
    if (missing.status !== 404) throw new Error('Missing scripts must return 404');
    console.log('PASS versioned assets and missing asset responses');
    const assert = require('node:assert/strict');
    const api = (name, data = {}) => post(baseUrl + '/api/' + name, data);
    assert.equal((await api('create-user', { name: 'Staff', username: 'staff', password: 'staff-password', role: 'Staff' })).success, true);
    assert.equal((await api('update-settings', { data: { require_login: '1' } })).success, true);
    await api('logout');
    assert.equal((await api('get-customers')).success, false);
    assert.equal((await api('update-settings', { data: { require_login: '0' }, user: { id: 1, role: 'Admin' } })).success, false);
    clientCookie = '';
    assert.equal((await api('get-customers')).success, false, 'New browser bypassed login');
    assert.equal((await api('authenticate', { username: 'staff', password: 'staff-password' })).data.role, 'Staff');
    assert.equal((await api('get-customers')).success, true);
    assert.equal((await api('get-users')).success, false);
    assert.equal((await api('delete-customer', { id: 1, user: { id: 1, role: 'Admin' } })).success, false);
    assert.equal((await api('authenticate', { username: 'admin', password: 'test-password-updated' })).data.role, 'Admin');
    const restore = (await api('create-backup')).data;
    assert.equal((await api('restore-backup', { filepath: restore.filepath })).success, true);
    assert.equal((await api('get-session')).data, null);
    assert.equal((await api('get-customers')).success, false);
    console.log('PASS HTTP cookies, forged roles, logout, staff permissions, and restore session invalidation');
  } finally { child.kill(); }
}

runIsolated().catch(err => {
  console.error('\n❌ E2E TEST FAILED:', err);
  process.exit(1);
});
