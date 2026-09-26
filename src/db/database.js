const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

class DatabaseManager {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, '..', '..', 'data', 'khata.db');
    this.SQL = null;
    this.db = null;
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) return;
    this.SQL = await initSqlJs();

    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(this.dbPath)) {
      try {
        const fileBuffer = fs.readFileSync(this.dbPath);
        this.db = new this.SQL.Database(fileBuffer);
      } catch (err) {
        throw new Error('Could not open the existing database. The original file has been preserved. ' + err.message);
      }
    } else {
      this.db = new this.SQL.Database();
    }

    this.createTables();
    this.seedDefaults();
    this.saveToDisk();
    this.isInitialized = true;
  }

  saveToDisk() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const temporaryPath = this.dbPath + '.tmp';
      fs.writeFileSync(temporaryPath, Buffer.from(data));
      fs.renameSync(temporaryPath, this.dbPath);
    } catch (err) {
      console.error('Failed saving database to disk:', err);
      throw new Error('Could not persist data to disk.');
    }
  }

  createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Admin',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        mobile TEXT DEFAULT '',
        address TEXT DEFAULT '',
        currency TEXT NOT NULL CHECK(currency IN ('AED', 'PKR')),
        opening_balance INTEGER NOT NULL DEFAULT 0,
        opening_balance_type TEXT NOT NULL DEFAULT 'Zero Balance' CHECK(opening_balance_type IN ('Zero Balance', 'Receivable', 'Payable')),
        is_archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_code TEXT UNIQUE NOT NULL,
        customer_id INTEGER NOT NULL,
        transaction_date TEXT NOT NULL,
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('Debit', 'Credit')),
        amount INTEGER NOT NULL CHECK(amount >= 0),
        description TEXT DEFAULT '',
        payment_method TEXT DEFAULT 'Cash',
        reference_number TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_by TEXT DEFAULT 'Admin',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      );

      CREATE TABLE IF NOT EXISTS receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_number TEXT UNIQUE NOT NULL,
        transaction_id INTEGER NOT NULL,
        customer_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(transaction_id) REFERENCES transactions(id),
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      );

      CREATE TABLE IF NOT EXISTS customer_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        note TEXT NOT NULL,
        created_by TEXT DEFAULT 'Admin',
        created_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT 1,
        user_name TEXT DEFAULT 'Admin',
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT DEFAULT '',
        description TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT UNIQUE NOT NULL,
        setting_value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sequences (
        name TEXT PRIMARY KEY,
        current_val INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return 'scrypt$' + salt + '$' + crypto.scryptSync(String(password), salt, 64).toString('hex');
  }

  verifyPassword(password, stored) {
    if (typeof stored !== 'string') return false;
    if (stored.startsWith('scrypt$')) {
      const [, salt, hash] = stored.split('$');
      if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
      return crypto.timingSafeEqual(crypto.scryptSync(String(password), salt, 64), Buffer.from(hash, 'hex'));
    }
    const actual = crypto.createHash('sha256').update(String(password) + '_simple_khata_salt').digest('hex');
    return stored.length === actual.length && crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(actual));
  }

  seedDefaults() {
    // Default admin user if none exists
    const users = this.query("SELECT COUNT(*) as count FROM users");
    if (users[0].count === 0) {
      const now = new Date().toISOString();
      const defaultHash = this.hashPassword('admin123');
      this.run(
        "INSERT INTO users (name, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
        ['Administrator', 'admin', defaultHash, 'Admin', now]
      );
    }

    // Default settings
    const defaultSettings = [
      ['business_name', 'My Business Store'],
      ['owner_name', 'Business Owner'],
      ['mobile', ''],
      ['whatsapp', ''],
      ['address', ''],
      ['logo_base64', ''],
      ['auto_backup_frequency', 'Daily'],
      ['last_backup_date', ''],
      ['require_login', '0']
    ];

    for (const [key, val] of defaultSettings) {
      const exist = this.query("SELECT id FROM settings WHERE setting_key = ?", [key]);
      if (exist.length === 0) {
        this.run("INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)", [key, val]);
      }
    }

    // Initialize sequences if empty
    const initSequences = ['customer_code', 'transaction_code', 'receipt_code'];
    for (const seq of initSequences) {
      const exist = this.query("SELECT name FROM sequences WHERE name = ?", [seq]);
      if (exist.length === 0) {
        let maxVal = 0;
        if (seq === 'customer_code') {
          const maxCust = this.query("SELECT account_code FROM customers");
          for (const c of maxCust) {
            const num = parseInt(c.account_code, 10);
            if (!isNaN(num) && num > maxVal) maxVal = num;
          }
        }
        this.run("INSERT INTO sequences (name, current_val) VALUES (?, ?)", [seq, maxVal]);
      }
    }
  }

  // Helper run query that handles parameterized statements
  run(sql, params = []) {
    try {
      this.db.run(sql, params);
      return { success: true };
    } catch (err) {
      console.error('SQL Run Error:', err.message, sql, params);
      throw err;
    }
  }

  // Helper select query that returns array of JS objects
  query(sql, params = []) {
    try {
      const stmt = this.db.prepare(sql);
      if (params.length > 0) stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('SQL Query Error:', err.message, sql, params);
      throw err;
    }
  }

  // Safe Sequence Incrementor
  getNextSequence(name) {
    this.run(`
      INSERT INTO sequences (name, current_val) VALUES (?, 1)
      ON CONFLICT(name) DO UPDATE SET current_val = current_val + 1
    `, [name]);
    const res = this.query("SELECT current_val FROM sequences WHERE name = ?", [name]);
    return res[0].current_val;
  }

  // Format account code: 01, 02.. 99, 100, 101...
  formatAccountCode(num) {
    return num < 100 ? String(num).padStart(2, '0') : String(num);
  }

  // Audit Log helper
  logAudit(action, entityType, entityId, description, user = { id: 1, name: 'Admin' }) {
    const now = new Date().toISOString();
    this.run(`
      INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [user.id || 1, user.name || 'Admin', action, entityType, String(entityId || ''), description, now]);
    this.saveToDisk();
  }

  // --- Customer Operations ---

  localToday() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  validateAmount(value, allowZero = false) {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1)) {
      throw new Error('Amount must be a valid ' + (allowZero ? 'non-negative' : 'positive') + ' number of cents.');
    }
    return amount;
  }

  validateDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new Error('Invalid transaction date.');
    }
    return value;
  }

  getNextAccountCode() {
    const nextNum = this.getNextSequence('customer_code');
    // Ensure uniqueness in customers table just in case
    let code = this.formatAccountCode(nextNum);
    let check = this.query("SELECT id FROM customers WHERE account_code = ?", [code]);
    while (check.length > 0) {
      const retryNum = this.getNextSequence('customer_code');
      code = this.formatAccountCode(retryNum);
      check = this.query("SELECT id FROM customers WHERE account_code = ?", [code]);
    }
    return code;
  }

  peekNextAccountCode() {
    const res = this.query("SELECT current_val FROM sequences WHERE name = 'customer_code'");
    const current = res.length > 0 ? res[0].current_val : 0;
    return this.formatAccountCode(current + 1);
  }

  createCustomer(data, user) {
    if (!data.name || !data.name.trim()) {
      throw new Error('Customer Name is required.');
    }
    if (data.currency !== 'AED' && data.currency !== 'PKR') {
      throw new Error('Invalid currency. Only AED and PKR are allowed.');
    }

    const openingBalanceType = data.opening_balance_type || 'Zero Balance';
    if (!['Zero Balance', 'Receivable', 'Payable'].includes(openingBalanceType)) throw new Error('Invalid opening balance type.');
    this.validateAmount(data.opening_balance ?? 0, true);
    let openingBalanceCents = 0;
    if (openingBalanceType !== 'Zero Balance') {
      openingBalanceCents = this.validateAmount(data.opening_balance ?? 0, true);
    }

    const accountCode = this.getNextAccountCode();

    const now = new Date().toISOString();
    this.run(`
      INSERT INTO customers (account_code, name, mobile, address, currency, opening_balance, opening_balance_type, is_archived, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `, [
      accountCode,
      data.name.trim(),
      (data.mobile || '').trim(),
      (data.address || '').trim(),
      data.currency,
      openingBalanceCents,
      openingBalanceType,
      now,
      now
    ]);

    const created = this.query("SELECT * FROM customers WHERE account_code = ?", [accountCode])[0];
    this.saveToDisk();

    this.logAudit('CREATE', 'CUSTOMER', created.id, `Created customer Account ${accountCode} — ${created.name} (${created.currency})`, user);
    return created;
  }

  updateCustomer(id, data, user) {
    if (user && user.role !== 'Admin') throw new Error('Only an Administrator can edit customer details.');
    const existing = this.query("SELECT * FROM customers WHERE id = ?", [id]);
    if (existing.length === 0) throw new Error('Customer not found.');

    if (!data.name || !data.name.trim()) {
      throw new Error('Customer Name is required.');
    }

    const openingBalanceType = data.opening_balance_type || 'Zero Balance';
    if (!['Zero Balance', 'Receivable', 'Payable'].includes(openingBalanceType)) throw new Error('Invalid opening balance type.');
    this.validateAmount(data.opening_balance ?? 0, true);
    let openingBalanceCents = 0;
    if (openingBalanceType !== 'Zero Balance') {
      openingBalanceCents = this.validateAmount(data.opening_balance ?? 0, true);
    }

    const now = new Date().toISOString();
    this.run(`
      UPDATE customers 
      SET name = ?, mobile = ?, address = ?, opening_balance = ?, opening_balance_type = ?, updated_at = ?
      WHERE id = ?
    `, [
      data.name.trim(),
      (data.mobile || '').trim(),
      (data.address || '').trim(),
      openingBalanceCents,
      openingBalanceType,
      now,
      id
    ]);

    this.saveToDisk();
    this.logAudit('UPDATE', 'CUSTOMER', id, `Updated customer Account ${existing[0].account_code} — ${data.name.trim()}`, user);
    return this.getCustomerById(id);
  }

  archiveCustomer(id, user) {
    if (user && user.role !== 'Admin') throw new Error('Only an Administrator can archive customers.');
    const existing = this.query("SELECT * FROM customers WHERE id = ?", [id]);
    if (existing.length === 0) throw new Error('Customer not found.');

    const newStatus = existing[0].is_archived === 1 ? 0 : 1;
    const actionDesc = newStatus === 1 ? 'archived' : 'restored';
    this.run("UPDATE customers SET is_archived = ?, updated_at = ? WHERE id = ?", [newStatus, new Date().toISOString(), id]);
    this.saveToDisk();

    this.logAudit('ARCHIVE', 'CUSTOMER', id, `Admin ${actionDesc} Account ${existing[0].account_code} — ${existing[0].name}`, user);
    return { success: true, is_archived: newStatus };
  }

  deleteCustomer(id, user) {
    if (user && user.role !== 'Admin') throw new Error('Only an Administrator can delete customers.');
    const existing = this.query("SELECT * FROM customers WHERE id = ?", [id]);
    if (existing.length === 0) throw new Error('Customer not found.');

    const trxs = this.query("SELECT id FROM transactions WHERE customer_id = ?", [id]);
    for (const trx of trxs) {
      this.run("DELETE FROM receipts WHERE transaction_id = ?", [trx.id]);
    }
    this.run("DELETE FROM transactions WHERE customer_id = ?", [id]);
    this.run("DELETE FROM customer_notes WHERE customer_id = ?", [id]);
    this.run("DELETE FROM customers WHERE id = ?", [id]);
    
    this.saveToDisk();
    this.logAudit('DELETE', 'CUSTOMER', id, `Admin deleted Account ${existing[0].account_code} — ${existing[0].name}`, user);
    return { success: true };
  }

  getCustomerById(id) {
    const res = this.query("SELECT * FROM customers WHERE id = ?", [id]);
    if (res.length === 0) return null;
    const cust = res[0];
    const balanceInfo = this.getCustomerBalance(cust.id);
    return { ...cust, ...balanceInfo };
  }

  getCustomerByAccountCode(code) {
    const res = this.query("SELECT * FROM customers WHERE account_code = ?", [code]);
    if (res.length === 0) return null;
    const cust = res[0];
    const balanceInfo = this.getCustomerBalance(cust.id);
    return { ...cust, ...balanceInfo };
  }

  getCustomers(search = '', includeArchived = false) {
    let sql = "SELECT * FROM customers WHERE 1=1";
    const params = [];

    if (!includeArchived) {
      sql += " AND is_archived = 0";
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      sql += " AND (account_code LIKE ? OR name LIKE ? OR mobile LIKE ?)";
      params.push(q, q, q);
    }

    sql += " ORDER BY id ASC";
    const list = this.query(sql, params);

    return list.map(c => {
      const balanceInfo = this.getCustomerBalance(c.id);
      return { ...c, ...balanceInfo };
    });
  }

  // --- Financial Balances & Calculations (Decimal-Safe Integer Cents) ---

  getCustomerBalance(customerId) {
    const custRes = this.query("SELECT opening_balance, opening_balance_type, currency FROM customers WHERE id = ?", [customerId]);
    if (custRes.length === 0) return { balance_cents: 0, status: 'Zero Balance', total_debit_cents: 0, total_credit_cents: 0 };

    const cust = custRes[0];
    let initialBalance = 0;
    if (cust.opening_balance_type === 'Receivable') {
      initialBalance = cust.opening_balance;
    } else if (cust.opening_balance_type === 'Payable') {
      initialBalance = -cust.opening_balance;
    }

    const totals = this.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'Debit' THEN amount ELSE 0 END), 0) as total_debit,
        COALESCE(SUM(CASE WHEN transaction_type = 'Credit' THEN amount ELSE 0 END), 0) as total_credit
      FROM transactions
      WHERE customer_id = ?
    `, [customerId]);

    const totalDebit = totals[0].total_debit;
    const totalCredit = totals[0].total_credit;
    const balanceCents = initialBalance + totalDebit - totalCredit;

    let status = 'Zero Balance';
    if (balanceCents > 0) status = 'Receivable';
    else if (balanceCents < 0) status = 'Payable';

    return {
      balance_cents: balanceCents,
      status,
      total_debit_cents: totalDebit,
      total_credit_cents: totalCredit,
      currency: cust.currency
    };
  }

  // Centralized Running Ledger
  getCustomerLedger(customerId, sortOrder = 'ASC', dateFrom = '', dateTo = '') {
    if (dateFrom) this.validateDate(dateFrom);
    if (dateTo) this.validateDate(dateTo);
    if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('Start date must not be after end date.');
    const cust = this.query("SELECT * FROM customers WHERE id = ?", [customerId])[0];
    if (!cust) return { transactions: [], summary: null };

    // Get all transactions chronologically to calculate running balance correctly
    const allTrx = this.query(`
      SELECT * FROM transactions 
      WHERE customer_id = ? 
      ORDER BY transaction_date ASC, id ASC
    `, [customerId]);

    let runningBalance = 0;
    if (cust.opening_balance_type === 'Receivable') {
      runningBalance = cust.opening_balance;
    } else if (cust.opening_balance_type === 'Payable') {
      runningBalance = -cust.opening_balance;
    }

    const calculatedList = [];
    let cumulativeDebit = 0;
    let cumulativeCredit = 0;

    for (const trx of allTrx) {
      if (trx.transaction_type === 'Debit') {
        runningBalance += trx.amount;
        cumulativeDebit += trx.amount;
      } else {
        runningBalance -= trx.amount;
        cumulativeCredit += trx.amount;
      }

      let rowStatus = 'Zero Balance';
      if (runningBalance > 0) rowStatus = 'Receivable';
      else if (runningBalance < 0) rowStatus = 'Payable';

      calculatedList.push({
        ...trx,
        debit: trx.transaction_type === 'Debit' ? trx.amount : 0,
        credit: trx.transaction_type === 'Credit' ? trx.amount : 0,
        running_balance: runningBalance,
        status: rowStatus
      });
    }

    // Filter by date range if provided
    let filteredList = calculatedList;
    if (dateFrom) {
      filteredList = filteredList.filter(t => t.transaction_date >= dateFrom);
    }
    if (dateTo) {
      filteredList = filteredList.filter(t => t.transaction_date <= dateTo);
    }

    let periodOpening = cust.opening_balance_type === 'Payable' ? -cust.opening_balance : (cust.opening_balance_type === 'Receivable' ? cust.opening_balance : 0);
    if (dateFrom) {
      for (const trx of calculatedList) {
        if (trx.transaction_date < dateFrom) periodOpening = trx.running_balance;
      }
    }
    cumulativeDebit = filteredList.reduce((sum, t) => sum + t.debit, 0);
    cumulativeCredit = filteredList.reduce((sum, t) => sum + t.credit, 0);

    // Sort order (default ASC, or DESC if requested)
    if (sortOrder === 'DESC') {
      filteredList.reverse();
    }

    const closingBalance = periodOpening + cumulativeDebit - cumulativeCredit;
    let closingStatus = 'Zero Balance';
    if (closingBalance > 0) closingStatus = 'Receivable';
    else if (closingBalance < 0) closingStatus = 'Payable';

    return {
      customer: cust,
      transactions: filteredList,
      summary: {
        opening_balance: Math.abs(periodOpening),
        opening_balance_type: periodOpening > 0 ? 'Receivable' : (periodOpening < 0 ? 'Payable' : 'Zero Balance'),
        total_debit: cumulativeDebit,
        total_credit: cumulativeCredit,
        closing_balance: closingBalance,
        closing_status: closingStatus,
        currency: cust.currency
      }
    };
  }

  // --- Transactions ---

  getNextTransactionCode() {
    const num = this.getNextSequence('transaction_code');
    return `TRX-${String(num).padStart(6, '0')}`;
  }

  createTransaction(data, user) {
    const cust = this.query("SELECT * FROM customers WHERE id = ?", [data.customer_id]);
    if (cust.length === 0) throw new Error('Customer does not exist.');
    if (cust[0].is_archived === 1) {
      throw new Error('Cannot add transaction to an archived customer.');
    }

    if (data.transaction_type !== 'Debit' && data.transaction_type !== 'Credit') {
      throw new Error('Transaction type must be Debit or Credit.');
    }

    const amountCents = this.validateAmount(data.amount);
    if (amountCents <= 0) {
      throw new Error('Transaction amount must be greater than zero.');
    }

    const now = new Date().toISOString();
    const trxDate = this.validateDate(data.transaction_date || this.localToday());
    const trxCode = this.getNextTransactionCode();

    this.run(`
      INSERT INTO transactions (
        transaction_code, customer_id, transaction_date, transaction_type, 
        amount, description, payment_method, reference_number, notes, 
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      trxCode,
      data.customer_id,
      trxDate,
      data.transaction_type,
      amountCents,
      (data.description || '').trim(),
      data.payment_method || 'Cash',
      (data.reference_number || '').trim(),
      (data.notes || '').trim(),
      user ? user.name : 'Admin',
      now,
      now
    ]);

    const created = this.query("SELECT * FROM transactions WHERE transaction_code = ?", [trxCode])[0];

    // Generate a receipt for all transactions
    let receipt = this.createReceipt(created.id, cust[0].id, amountCents);

    this.saveToDisk();

    this.logAudit(
      'CREATE', 
      'TRANSACTION', 
      created.id, 
      `${user ? user.name : 'Admin'} added transaction ${trxCode} (${data.transaction_type} ${cust[0].currency} ${(amountCents/100).toFixed(2)}) for Account ${cust[0].account_code} — ${cust[0].name}`,
      user
    );

    return { transaction: created, receipt };
  }

  updateTransaction(id, data, user) {
    if (user && user.role !== 'Admin') throw new Error('Only an Administrator can edit historical transactions.');
    const existing = this.query("SELECT * FROM transactions WHERE id = ?", [id]);
    if (existing.length === 0) throw new Error('Transaction not found.');
    const trx = existing[0];

    const cust = this.query("SELECT * FROM customers WHERE id = ?", [trx.customer_id])[0];

    const amountCents = this.validateAmount(data.amount);
    if (amountCents <= 0) throw new Error('Amount must be greater than zero.');
    const transactionType = data.transaction_type || trx.transaction_type;
    if (!['Debit', 'Credit'].includes(transactionType)) throw new Error('Invalid transaction type.');
    this.validateDate(data.transaction_date || trx.transaction_date);

    const now = new Date().toISOString();
    this.run(`
      UPDATE transactions 
      SET transaction_date = ?, transaction_type = ?, amount = ?, description = ?, 
          payment_method = ?, reference_number = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `, [
      data.transaction_date || trx.transaction_date,
      data.transaction_type || trx.transaction_type,
      amountCents,
      (data.description || '').trim(),
      data.payment_method || trx.payment_method,
      (data.reference_number || '').trim(),
      (data.notes || '').trim(),
      now,
      id
    ]);

    if (transactionType === 'Debit') {
      this.run('DELETE FROM receipts WHERE transaction_id = ?', [id]);
    } else if (this.query('SELECT id FROM receipts WHERE transaction_id = ?', [id]).length) {
      this.run('UPDATE receipts SET amount = ? WHERE transaction_id = ?', [amountCents, id]);
    } else {
      this.createReceipt(Number(id), trx.customer_id, amountCents);
    }
    this.saveToDisk();

    this.logAudit(
      'UPDATE',
      'TRANSACTION',
      id,
      `${user ? user.name : 'Admin'} edited transaction ${trx.transaction_code} for Account ${cust.account_code}`,
      user
    );

    return this.query("SELECT * FROM transactions WHERE id = ?", [id])[0];
  }

  deleteTransaction(id, user) {
    if (user && user.role !== 'Admin') {
      throw new Error('Only an Administrator can delete historical transactions.');
    }

    const existing = this.query("SELECT * FROM transactions WHERE id = ?", [id]);
    if (existing.length === 0) throw new Error('Transaction not found.');
    const trx = existing[0];

    const cust = this.query("SELECT * FROM customers WHERE id = ?", [trx.customer_id])[0];

    // Delete associated receipt if any
    this.run("DELETE FROM receipts WHERE transaction_id = ?", [id]);
    this.run("DELETE FROM transactions WHERE id = ?", [id]);

    this.saveToDisk();

    this.logAudit(
      'DELETE',
      'TRANSACTION',
      id,
      `${user ? user.name : 'Admin'} deleted transaction ${trx.transaction_code} (${trx.transaction_type} ${(trx.amount/100).toFixed(2)}) from Account ${cust ? cust.account_code : ''}`,
      user
    );

    return { success: true };
  }

  getAllTransactions(filters = {}) {
    let sql = `
      SELECT t.*, c.account_code, c.name as customer_name, c.currency, c.mobile
      FROM transactions t
      JOIN customers c ON t.customer_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      sql += " AND (c.account_code LIKE ? OR c.name LIKE ? OR c.mobile LIKE ? OR t.transaction_code LIKE ? OR t.description LIKE ? OR t.reference_number LIKE ?)";
      params.push(q, q, q, q, q, q);
    }

    if (filters.currency && (filters.currency === 'AED' || filters.currency === 'PKR')) {
      sql += " AND c.currency = ?";
      params.push(filters.currency);
    }

    if (filters.transaction_type && (filters.transaction_type === 'Debit' || filters.transaction_type === 'Credit')) {
      sql += " AND t.transaction_type = ?";
      params.push(filters.transaction_type);
    }

    if (filters.payment_method) {
      sql += " AND t.payment_method = ?";
      params.push(filters.payment_method);
    }
    if (filters.customer_id) {
      sql += ' AND t.customer_id = ?';
      params.push(filters.customer_id);
    }
    for (const [key, operator] of [['amount_min', '>='], ['amount_max', '<=']]) {
      if (filters[key] !== undefined && filters[key] !== '') {
        sql += ` AND t.amount ${operator} ?`;
        params.push(this.validateAmount(filters[key], true));
      }
    }
    if (filters.amount_min !== undefined && filters.amount_max !== undefined && Number(filters.amount_min) > Number(filters.amount_max)) throw new Error('Minimum amount must not exceed maximum amount.');
    if (filters.date_from) this.validateDate(filters.date_from);
    if (filters.date_to) this.validateDate(filters.date_to);
    if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) throw new Error('Start date must not be after end date.');

    if (filters.date_from) {
      sql += " AND t.transaction_date >= ?";
      params.push(filters.date_from);
    }

    if (filters.date_to) {
      sql += " AND t.transaction_date <= ?";
      params.push(filters.date_to);
    }

    sql += " ORDER BY t.transaction_date DESC, t.id DESC";

    if (filters.limit) {
      sql += ` LIMIT ${parseInt(filters.limit, 10)}`;
    }

    return this.query(sql, params);
  }

  // --- Receipts ---
  getTransactionById(id) {
    const transaction = this.query('SELECT * FROM transactions WHERE id = ?', [id])[0];
    if (!transaction) throw new Error('Transaction not found.');
    return transaction;
  }

  getNextReceiptNumber() {
    const num = this.getNextSequence('receipt_code');
    return `REC-${String(num).padStart(6, '0')}`;
  }

  createReceipt(transactionId, customerId, amountCents) {
    const receiptNum = this.getNextReceiptNumber();
    const now = new Date().toISOString();
    this.run(`
      INSERT INTO receipts (receipt_number, transaction_id, customer_id, amount, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [receiptNum, transactionId, customerId, amountCents, now]);
    return this.query("SELECT * FROM receipts WHERE receipt_number = ?", [receiptNum])[0];
  }

  getReceiptByTransactionId(trxId) {
    const res = this.query(`
      SELECT r.*, t.transaction_code, t.transaction_type, t.transaction_date, t.description, t.payment_method,
             c.account_code, c.name as customer_name, c.currency, c.mobile, c.address
      FROM receipts r
      JOIN transactions t ON r.transaction_id = t.id
      JOIN customers c ON r.customer_id = c.id
      WHERE r.transaction_id = ?
    `, [trxId]);

    if (res.length === 0) return null;
    const r = res[0];

    // Compute previous and remaining balances at the time of this transaction
    const ledger = this.getCustomerLedger(r.customer_id, 'ASC');
    let prevBalance = 0;
    let remainingBalance = 0;

    for (const trx of ledger.transactions) {
      if (trx.id === Number(trxId)) {
        remainingBalance = trx.running_balance;
        // Since this was a transaction, calculate previous balance based on type
        prevBalance = remainingBalance + (trx.transaction_type === 'Credit' ? trx.amount : -trx.amount);
        break;
      }
    }

    return {
      ...r,
      previous_balance_cents: prevBalance,
      remaining_balance_cents: remainingBalance
    };
  }

  // --- Customer Notes ---

  getCustomerNotes(customerId) {
    return this.query(`
      SELECT * FROM customer_notes 
      WHERE customer_id = ? 
      ORDER BY id DESC
    `, [customerId]);
  }

  addCustomerNote(customerId, note, user) {
    if (!note || !note.trim()) throw new Error('Note text cannot be empty.');
    const now = new Date().toISOString();
    this.run(`
      INSERT INTO customer_notes (customer_id, note, created_by, created_at)
      VALUES (?, ?, ?, ?)
    `, [customerId, note.trim(), user ? user.name : 'Admin', now]);
    this.saveToDisk();
    return this.query("SELECT * FROM customer_notes WHERE customer_id = ? ORDER BY id DESC LIMIT 1", [customerId])[0];
  }

  deleteCustomerNote(id, user) {
    this.run("DELETE FROM customer_notes WHERE id = ?", [id]);
    this.saveToDisk();
    return { success: true };
  }

  // --- Audit Logs ---

  getAuditLogs(limit = 100) {
    return this.query(`
      SELECT * FROM audit_logs 
      ORDER BY id DESC 
      LIMIT ?
    `, [limit]);
  }

  // --- Settings ---

  getSettings() {
    const rows = this.query("SELECT setting_key, setting_value FROM settings");
    const map = {};
    for (const r of rows) {
      map[r.setting_key] = r.setting_value;
    }
    return map;
  }

  updateSettings(data, user) {
    if (user && user.role !== 'Admin') throw new Error('Only an Administrator can change settings.');
    for (const [key, val] of Object.entries(data)) {
      this.run(`
        INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET setting_value = ?
      `, [key, String(val), String(val)]);
    }
    this.saveToDisk();
    this.logAudit('UPDATE', 'SETTINGS', 0, 'Updated business settings profile', user);
    return this.getSettings();
  }

  // --- Dashboard Data (Never mix AED and PKR) ---

  getDashboardData() {
    const totalCustomersRes = this.query("SELECT COUNT(*) as count FROM customers WHERE is_archived = 0");
    const totalCustomers = totalCustomersRes[0].count;

    const todayStr = this.localToday();

    const todayTrxRes = this.query(`
      SELECT COUNT(*) as count 
      FROM transactions 
      WHERE transaction_date = ?
    `, [todayStr]);
    const todayTransactionsCount = todayTrxRes[0].count;

    // AED Calculations
    const aedCustomers = this.query("SELECT id FROM customers WHERE currency = 'AED' AND is_archived = 0");
    let aedReceivable = 0;
    let aedPayable = 0;
    for (const c of aedCustomers) {
      const b = this.getCustomerBalance(c.id);
      if (b.balance_cents > 0) aedReceivable += b.balance_cents;
      else if (b.balance_cents < 0) aedPayable += Math.abs(b.balance_cents);
    }

    const aedToday = this.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN t.transaction_type = 'Credit' THEN t.amount ELSE 0 END), 0) as received,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'Debit' THEN t.amount ELSE 0 END), 0) as paid
      FROM transactions t
      JOIN customers c ON t.customer_id = c.id
      WHERE c.currency = 'AED' AND t.transaction_date = ?
    `, [todayStr]);

    // PKR Calculations
    const pkrCustomers = this.query("SELECT id FROM customers WHERE currency = 'PKR' AND is_archived = 0");
    let pkrReceivable = 0;
    let pkrPayable = 0;
    for (const c of pkrCustomers) {
      const b = this.getCustomerBalance(c.id);
      if (b.balance_cents > 0) pkrReceivable += b.balance_cents;
      else if (b.balance_cents < 0) pkrPayable += Math.abs(b.balance_cents);
    }

    const pkrToday = this.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN t.transaction_type = 'Credit' THEN t.amount ELSE 0 END), 0) as received,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'Debit' THEN t.amount ELSE 0 END), 0) as paid
      FROM transactions t
      JOIN customers c ON t.customer_id = c.id
      WHERE c.currency = 'PKR' AND t.transaction_date = ?
    `, [todayStr]);

    return {
      total_customers: totalCustomers,
      today_transactions_count: todayTransactionsCount,
      aed_summary: {
        receivable_cents: aedReceivable,
        payable_cents: aedPayable,
        today_received_cents: aedToday[0].received,
        today_paid_cents: aedToday[0].paid
      },
      pkr_summary: {
        receivable_cents: pkrReceivable,
        payable_cents: pkrPayable,
        today_received_cents: pkrToday[0].received,
        today_paid_cents: pkrToday[0].paid
      }
    };
  }

  // --- Reports ---

  getCustomerBalanceReport(currencyFilter = 'ALL', status = null) {
    let sql = "SELECT * FROM customers WHERE is_archived = 0";
    const params = [];
    if (currencyFilter === 'AED' || currencyFilter === 'PKR') {
      sql += " AND currency = ?";
      params.push(currencyFilter);
    }
    sql += " ORDER BY id ASC";

    const customers = this.query(sql, params);
    const rows = customers.map(c => {
      const bal = this.getCustomerBalance(c.id);
      return {
        id: c.id,
        account_code: c.account_code,
        name: c.name,
        currency: c.currency,
        total_debit: bal.total_debit_cents,
        total_credit: bal.total_credit_cents,
        current_balance: bal.balance_cents,
        status: bal.status
      };
    }).filter(row => !status || row.status === status);

    // Compute separate totals for AED and PKR
    let aedTotals = { debit: 0, credit: 0, receivable: 0, payable: 0 };
    let pkrTotals = { debit: 0, credit: 0, receivable: 0, payable: 0 };

    for (const r of rows) {
      if (r.currency === 'AED') {
        aedTotals.debit += r.total_debit;
        aedTotals.credit += r.total_credit;
        if (r.current_balance > 0) aedTotals.receivable += r.current_balance;
        else if (r.current_balance < 0) aedTotals.payable += Math.abs(r.current_balance);
      } else if (r.currency === 'PKR') {
        pkrTotals.debit += r.total_debit;
        pkrTotals.credit += r.total_credit;
        if (r.current_balance > 0) pkrTotals.receivable += r.current_balance;
        else if (r.current_balance < 0) pkrTotals.payable += Math.abs(r.current_balance);
      }
    }

    return { rows, aedTotals, pkrTotals };
  }

  getReceivableReport(currencyFilter = 'ALL') {
    return this.getCustomerBalanceReport(currencyFilter, 'Receivable');
  }

  getPayableReport(currencyFilter = 'ALL') {
    return this.getCustomerBalanceReport(currencyFilter, 'Payable');
  }

  // --- Users & Authentication ---

  getUsers() {
    return this.query("SELECT id, name, username, role, created_at FROM users ORDER BY id ASC");
  }

  authenticate(username, password) {
    const userRes = this.query("SELECT * FROM users WHERE username = ?", [username]);
    if (userRes.length === 0) return null;
    const user = userRes[0];
    if (this.verifyPassword(password, user.password_hash)) {
      if (!user.password_hash.startsWith('scrypt$')) {
        this.run('UPDATE users SET password_hash = ? WHERE id = ?', [this.hashPassword(password), user.id]);
        this.saveToDisk();
      }
      return { id: user.id, name: user.name, username: user.username, role: user.role };
    }
    return null;
  }

  createUser(name, username, password, role = 'Staff', adminUser) {
    if (adminUser && adminUser.role !== 'Admin') throw new Error('Only admins can create users.');
    name = String(name || '').trim();
    username = String(username || '').trim();
    if (!name || !username || !password) throw new Error('Name, username and password are required.');
    if (!['Admin', 'Staff'].includes(role)) throw new Error('Invalid user role.');
    const exist = this.query("SELECT id FROM users WHERE username = ?", [username]);
    if (exist.length > 0) throw new Error('Username already exists.');

    const hash = this.hashPassword(password);
    const now = new Date().toISOString();
    this.run(`
      INSERT INTO users (name, username, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [name.trim(), username.trim(), hash, role, now]);

    this.saveToDisk();
    this.logAudit('CREATE', 'USER', 0, `Created user ${username} with role ${role}`, adminUser);
    return { success: true };
  }

  changePassword(currentPassword, newPassword, user) {
    if (!user?.id) throw new Error('Sign in before changing your password.');
    const account = this.query('SELECT * FROM users WHERE id = ?', [user.id])[0];
    if (!account || !this.verifyPassword(String(currentPassword || ''), account.password_hash)) throw new Error('Current password is incorrect.');
    if (typeof newPassword !== 'string' || newPassword.length < 8) throw new Error('Use at least 8 characters for the new password.');
    if (newPassword === currentPassword) throw new Error('Choose a different new password.');
    const snapshot = this.db.export();
    try {
      this.run('UPDATE users SET password_hash = ? WHERE id = ?', [this.hashPassword(newPassword), account.id]);
      this.logAudit('UPDATE', 'USER', account.id, 'Changed own password', { id: account.id, name: account.name });
    } catch (err) {
      this.db.close();
      this.db = new this.SQL.Database(snapshot);
      throw err;
    }
    return { success: true };
  }

  deleteUser(userId, adminUser) {
    if (adminUser && adminUser.role !== 'Admin') throw new Error('Only admins can delete users.');
    if (adminUser && Number(adminUser.id) === Number(userId)) throw new Error('Cannot delete your own account.');
    const target = this.query('SELECT role FROM users WHERE id = ?', [userId])[0];
    if (!target) throw new Error('User not found.');
    if (target.role === 'Admin' && this.query("SELECT COUNT(*) as count FROM users WHERE role = 'Admin'")[0].count <= 1) throw new Error('Cannot delete the last administrator.');

    this.run("DELETE FROM users WHERE id = ?", [userId]);
    this.saveToDisk();
    this.logAudit('DELETE', 'USER', userId, `Deleted user ID ${userId}`, adminUser);
    return { success: true };
  }
}

module.exports = DatabaseManager;
