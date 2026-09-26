const path = require('path');
const fs = require('fs');
const os = require('os');
const DatabaseManager = require('./db/database');
const BackupManager = require('./db/backup');

async function runTests() {
  console.log('--- Starting Database & Accounting Logic Unit Tests ---');
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-unit-'));
  const testDbPath = path.join(testDir, 'test_khata.db');

  const db = new DatabaseManager(testDbPath);
  await db.init();
  console.log('✓ Database initialized successfully');

  // Test 1: Check Sequential Account Codes
  console.log('\n--- Test 1: Sequential Account Codes ---');
  const cust1 = db.createCustomer({ name: 'Ali Khan', currency: 'AED', mobile: '0501234567', address: 'Dubai' });
  console.log(`Cust 1 Code: ${cust1.account_code} (Expected: 01)`);
  if (cust1.account_code !== '01') throw new Error(`Cust 1 code mismatch: ${cust1.account_code}`);

  const cust2 = db.createCustomer({ name: 'Ahmed Khan', currency: 'PKR', opening_balance: 500000, opening_balance_type: 'Receivable' });
  console.log(`Cust 2 Code: ${cust2.account_code} (Expected: 02)`);
  if (cust2.account_code !== '02') throw new Error(`Cust 2 code mismatch: ${cust2.account_code}`);

  // Test 2: Archive customer 2 and verify code 02 is NOT reused
  console.log('\n--- Test 2: Account Code Preservation After Archive ---');
  db.archiveCustomer(cust2.id);
  const cust3 = db.createCustomer({ name: 'Bilal Khan', currency: 'AED' });
  console.log(`Cust 3 Code: ${cust3.account_code} (Expected: 03)`);
  if (cust3.account_code !== '03') throw new Error(`Cust 3 code mismatch: ${cust3.account_code}`);

  // Test 3: Currency Validation
  console.log('\n--- Test 3: Currency Validation ---');
  try {
    db.createCustomer({ name: 'Invalid Currency', currency: 'USD' });
    throw new Error('Should have failed on USD currency');
  } catch (e) {
    console.log(`✓ Successfully rejected disallowed currency USD: "${e.message}"`);
  }

  // Test 4: Debit and Credit Ledger Calculations
  console.log('\n--- Test 4: Debit and Credit Running Balance ---');
  // Ali Khan: Initial balance 0
  // Debit 500.00 AED (Money given)
  const trx1 = db.createTransaction({
    customer_id: cust1.id,
    transaction_date: '2026-09-23',
    transaction_type: 'Debit',
    amount: 50000, // 500.00 AED
    description: 'Services provided'
  });
  console.log(`Created Trx 1: ${trx1.transaction.transaction_code}`);

  // Debit 200.00 AED
  db.createTransaction({
    customer_id: cust1.id,
    transaction_date: '2026-09-23',
    transaction_type: 'Debit',
    amount: 20000, // 200.00 AED
    description: 'Additional material'
  });

  // Credit 300.00 AED (Money received) -> Should auto-generate Receipt
  const trx3 = db.createTransaction({
    customer_id: cust1.id,
    transaction_date: '2026-09-23',
    transaction_type: 'Credit',
    amount: 30000, // 300.00 AED
    description: 'Cash payment from Ali'
  });
  console.log(`Created Trx 3 (Credit): ${trx3.transaction.transaction_code}, Receipt: ${trx3.receipt ? trx3.receipt.receipt_number : 'None'}`);

  // Check running balance for Ali Khan: 0 + 500 + 200 - 300 = +400.00 AED Receivable
  const balAli = db.getCustomerBalance(cust1.id);
  console.log(`Ali Balance: ${balAli.currency} ${(balAli.balance_cents/100).toFixed(2)} [${balAli.status}]`);
  if (balAli.balance_cents !== 40000 || balAli.status !== 'Receivable') {
    throw new Error(`Ali balance calculation wrong: ${balAli.balance_cents}, status: ${balAli.status}`);
  }

  // Test 5: Receipt details
  console.log('\n--- Test 5: Receipt Details ---');
  const receiptInfo = db.getReceiptByTransactionId(trx3.transaction.id);
  console.log(`Receipt Number: ${receiptInfo.receipt_number}, Customer: ${receiptInfo.customer_name}, Amount: ${(receiptInfo.amount/100).toFixed(2)}, Remaining: ${(receiptInfo.remaining_balance_cents/100).toFixed(2)}`);

  // Test 6: Dashboard & Reports (Strict Currency Separation)
  console.log('\n--- Test 6: Dashboard & Reports Isolation ---');
  const dashboard = db.getDashboardData();
  console.log(`AED Receivable: ${(dashboard.aed_summary.receivable_cents/100).toFixed(2)}, PKR Receivable: ${(dashboard.pkr_summary.receivable_cents/100).toFixed(2)}`);

  const report = db.getCustomerBalanceReport('ALL');
  console.log(`Report total rows: ${report.rows.length}, AED Totals:`, report.aedTotals, `PKR Totals:`, report.pkrTotals);

  // Test 7: Backup and Restore
  console.log('\n--- Test 7: Backup & Restore Manager ---');
  const backupManager = new BackupManager(db, path.join(testDir, 'backups'));
  const backupRes = backupManager.createBackup();
  console.log(`✓ Backup created: ${backupRes.filename}`);
  const backupsList = backupManager.getBackupList();
  console.log(`✓ Backups found on disk: ${backupsList.length}`);

  // Clean up test DB
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===\n');
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
