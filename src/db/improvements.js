module.exports = function extend(DB) {
  const p = DB.prototype;
  const tables = p.createTables;
  p.createTables = function () {
    tables.call(this);
    const cols = this.query('PRAGMA table_info(transactions)').map(c => c.name);
    if (!cols.includes('due_date')) this.db.run("ALTER TABLE transactions ADD COLUMN due_date TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('request_id')) this.db.run('ALTER TABLE transactions ADD COLUMN request_id TEXT');
    this.db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_request ON transactions(request_id);
      CREATE TABLE IF NOT EXISTS period_control (id INTEGER PRIMARY KEY CHECK(id=1), locked_through TEXT NOT NULL DEFAULT '');
      INSERT OR IGNORE INTO period_control(id,locked_through) VALUES(1,'');
      CREATE TABLE IF NOT EXISTS transaction_history (id INTEGER PRIMARY KEY, transaction_id INTEGER NOT NULL,
        action TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, reason TEXT NOT NULL,
        user_name TEXT NOT NULL, created_at TEXT NOT NULL);`);
  };
  const save = p.saveToDisk;
  p.saveToDisk = function () { if (!this.atomicDepth) save.call(this); };
  p.atomic = function (action) {
    if (this.atomicDepth) return action();
    const snapshot = this.db.export();
    this.atomicDepth = 1;
    try {
      this.db.run('BEGIN IMMEDIATE');
      const result = action();
      this.db.run('COMMIT');
      this.atomicDepth = 0;
      this.saveToDisk();
      return result;
    } catch (error) {
      this.atomicDepth = 0;
      this.db.close(); this.db = new this.SQL.Database(snapshot);
      throw error;
    }
  };
  p.getPeriodLock = function () { return this.query('SELECT locked_through FROM period_control WHERE id=1')[0]; };
  p.assertPeriodOpen = function (date) {
    const lock = this.getPeriodLock().locked_through;
    if (lock && date <= lock) throw Error(`Accounts are closed through ${lock}. An Administrator must reopen the period with a reason.`);
  };
  p.setPeriodLock = function (date, reason, user) {
    if (user?.role !== 'Admin') throw Error('Only an Administrator can close or reopen a period.');
    if (!String(reason || '').trim()) throw Error('A reason is required.');
    if (date) { this.validateDate(date); if (date > this.localToday()) throw Error('Cannot close a future date.'); }
    return this.atomic(() => {
      const previous = this.getPeriodLock().locked_through;
      this.run('UPDATE period_control SET locked_through=? WHERE id=1', [date || '']);
      this.logAudit('PERIOD', 'SYSTEM', 1, `Period lock: ${previous || 'open'} → ${date || 'open'}. Reason: ${reason.trim()}`, user);
      return this.getPeriodLock();
    });
  };
  p.findDuplicateTransactions = function (data) {
    return this.query('SELECT transaction_code FROM transactions WHERE customer_id=? AND transaction_date=? AND transaction_type=? AND amount=?',
      [data.customer_id, data.transaction_date || this.localToday(), data.transaction_type, data.amount]);
  };
  const create = p.createTransaction;
  p.createTransaction = function (data, user) {
    return this.atomic(() => {
      if (data.request_id) {
        if (typeof data.request_id !== 'string' || data.request_id.length > 100) throw Error('Invalid submission ID.');
        const existing = this.query('SELECT * FROM transactions WHERE request_id=?', [data.request_id])[0];
        if (existing) {
          if (Number(data.customer_id) !== existing.customer_id || data.amount !== existing.amount || data.transaction_type !== existing.transaction_type || data.transaction_date !== existing.transaction_date) throw Error('Submission ID already used. Reopen the form.');
          return { transaction: existing, receipt: this.getReceiptByTransactionId(existing.id) };
        }
      }
      this.assertPeriodOpen(data.transaction_date || this.localToday());
      if (data.due_date) { this.validateDate(data.due_date); if (data.due_date < data.transaction_date) throw Error('Due date cannot be before transaction date.'); }
      const result = create.call(this, data, user);
      this.run('UPDATE transactions SET due_date=?, request_id=? WHERE id=?', [data.due_date || '', data.request_id || null, result.transaction.id]);
      result.transaction = this.getTransactionById(result.transaction.id);
      return result;
    });
  };
  p.getTransactionHistory = function (id) { return id == null ? this.query('SELECT * FROM transaction_history ORDER BY id DESC LIMIT 200') : this.query('SELECT * FROM transaction_history WHERE transaction_id=? ORDER BY id DESC', [id]); };
  const update = p.updateTransaction, remove = p.deleteTransaction;
  p.updateTransaction = function (id, data, user) {
    return this.atomic(() => {
      const before = this.getTransactionById(id);
      if (!before) throw Error('Transaction not found.');
      this.assertPeriodOpen(before.transaction_date); this.assertPeriodOpen(data.transaction_date || before.transaction_date);
      if (!String(data.correction_reason || '').trim()) throw Error('Enter a reason for this correction.');
      const due = data.due_date === undefined ? before.due_date : data.due_date;
      if (due) { this.validateDate(due); if (due < (data.transaction_date || before.transaction_date)) throw Error('Due date cannot be before transaction date.'); }
      update.call(this, id, data, user);
      this.run('UPDATE transactions SET due_date=? WHERE id=?', [due || '', id]);
      const after = this.getTransactionById(id);
      this.run('INSERT INTO transaction_history(transaction_id,action,before_json,after_json,reason,user_name,created_at) VALUES(?,?,?,?,?,?,?)',
        [id,'UPDATE',JSON.stringify(before),JSON.stringify(after),data.correction_reason.trim(),user?.name || 'Admin',new Date().toISOString()]);
      return after;
    });
  };
  p.deleteTransaction = function (id, user) {
    return this.atomic(() => {
      const before = this.getTransactionById(id); if (!before) throw Error('Transaction not found.');
      this.assertPeriodOpen(before.transaction_date);
      this.run('INSERT INTO transaction_history(transaction_id,action,before_json,after_json,reason,user_name,created_at) VALUES(?,?,?,?,?,?,?)',
        [id,'DELETE',JSON.stringify(before),'{}','Deletion confirmed',user?.name || 'Admin',new Date().toISOString()]);
      return remove.call(this,id,user);
    });
  };
  const createCustomer = p.createCustomer, updateCustomer = p.updateCustomer, deleteCustomer = p.deleteCustomer;
  p.createCustomer = function(data,user) {
    if(Number(data.opening_balance) && this.getPeriodLock().locked_through) throw Error('Reopen the closed period before adding an opening balance.');
    return this.atomic(()=>createCustomer.call(this,data,user));
  };
  p.updateCustomer = function (id,data,user) {
    const old = this.getCustomerById(id);
    if (old && this.getPeriodLock().locked_through && (Number(data.opening_balance) !== old.opening_balance || data.opening_balance_type !== old.opening_balance_type)) throw Error('Reopen the closed period before changing an opening balance.');
    return updateCustomer.call(this,id,data,user);
  };
  p.deleteCustomer = function (id,user) {
    if (this.getPeriodLock().locked_through) throw Error('Reopen the closed period before deleting a customer.');
    return this.atomic(() => {
      for(const t of this.query('SELECT id FROM transactions WHERE customer_id=?',[id])) this.deleteTransaction(t.id,user);
      return deleteCustomer.call(this,id,user);
    });
  };
  p.getAgingReport = function (asOf = this.localToday(), currency = '') {
    this.validateDate(asOf);
    const rows = [];
    for (const c of this.getCustomers('',true).filter(c => !currency || c.currency === currency)) {
      const items = [];
      let credits = c.opening_balance_type === 'Payable' ? c.opening_balance : 0;
      if (c.opening_balance_type === 'Receivable' && c.opening_balance) items.push({amount:c.opening_balance,due_date:'',transaction_code:'Opening balance'});
      for (const t of this.query('SELECT * FROM transactions WHERE customer_id=? AND transaction_date<=? ORDER BY transaction_date,id',[c.id,asOf])) {
        if(t.transaction_type === 'Credit') credits += t.amount;
        else items.push({...t});
      }
      // FIFO settlement of debits; due dates only classify the remaining amount.
      const buckets = {not_due:0,days_1_7:0,days_8_30:0,days_31_60:0,days_61_90:0,days_90_plus:0,undated:0};
      for (const item of items) {
        const paid = Math.min(credits,item.amount); credits -= paid; const balance=item.amount-paid;
        if (!balance) continue;
        const days = item.due_date ? Math.floor((Date.parse(asOf)-Date.parse(item.due_date))/86400000) : null;
        const key=days===null?'undated':days<=0?'not_due':days<=7?'days_1_7':days<=30?'days_8_30':days<=60?'days_31_60':days<=90?'days_61_90':'days_90_plus';
        buckets[key]+=balance;
      }
      const total=Object.values(buckets).reduce((a,b)=>a+b,0);
      if(total) rows.push({customer_id:c.id,account_code:c.account_code,name:c.name,currency:c.currency,...buckets,total});
    }
    return rows;
  };
};
