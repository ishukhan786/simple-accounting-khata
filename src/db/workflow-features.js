module.exports = DB => {
  const p = DB.prototype, tables = p.createTables;
  const tags = ['Customer', 'Party', 'Bank', 'Cash'];
  p.createTables = function () {
    tables.call(this);
    const migrateDeleted = !this.query("SELECT name FROM sqlite_master WHERE type='table' AND name='deleted_transactions'").length;
    if (!this.query('PRAGMA table_info(customers)').some(c => c.name === 'tag'))
      this.db.run("ALTER TABLE customers ADD COLUMN tag TEXT NOT NULL DEFAULT 'Customer'");
    this.db.run(`CREATE TABLE IF NOT EXISTS deleted_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_json TEXT NOT NULL,
      receipt_json TEXT NOT NULL, customer_id INTEGER NOT NULL,
      customer_name TEXT NOT NULL, currency TEXT NOT NULL,
      deleted_by TEXT NOT NULL, deleted_at TEXT NOT NULL, restored_at TEXT NOT NULL DEFAULT '')`);
    if (migrateDeleted) {
      const seen = new Set();
      for (const history of this.query("SELECT * FROM transaction_history WHERE action='DELETE' ORDER BY id DESC")) {
        const t = JSON.parse(history.before_json);
        if (!t.transaction_code || seen.has(t.transaction_code)) continue;
        seen.add(t.transaction_code);
        if (this.query('SELECT id FROM transactions WHERE transaction_code=?',[t.transaction_code]).length) continue;
        const c = this.query('SELECT * FROM customers WHERE id=?',[t.customer_id])[0];
        this.run('INSERT INTO deleted_transactions(transaction_json,receipt_json,customer_id,customer_name,currency,deleted_by,deleted_at) VALUES(?,?,?,?,?,?,?)',
          [history.before_json,'{"legacy":true}',t.customer_id,c?.name || 'Deleted customer',c?.currency || t.currency || '',history.user_name,history.created_at]);
      }
    }
  };
  const create = p.createCustomer, update = p.updateCustomer, remove = p.deleteTransaction;
  p.createCustomer = function (data, user) {
    const tag = data.tag || 'Customer';
    if (!tags.includes(tag)) throw Error('Choose Customer, Party, Bank or Cash.');
    return this.atomic(() => {
      const c = create.call(this, data, user);
      this.run('UPDATE customers SET tag=? WHERE id=?', [tag, c.id]);
      return this.getCustomerById(c.id);
    });
  };
  p.updateCustomer = function (id, data, user) {
    if (data.tag !== undefined && !tags.includes(data.tag)) throw Error('Invalid customer tag.');
    return this.atomic(() => {
      update.call(this, id, data, user);
      if (data.tag !== undefined) this.run('UPDATE customers SET tag=? WHERE id=?', [data.tag, id]);
      return this.getCustomerById(id);
    });
  };
  p.deleteTransaction = function (id, user) {
    return this.atomic(() => {
      const transaction = this.getTransactionById(id);
      if (!transaction) throw Error('Transaction not found.');
      const c = this.getCustomerById(transaction.customer_id);
      const receipt = this.query('SELECT * FROM receipts WHERE transaction_id=?', [id])[0] || null;
      this.run('INSERT INTO deleted_transactions(transaction_json,receipt_json,customer_id,customer_name,currency,deleted_by,deleted_at) VALUES(?,?,?,?,?,?,?)',
        [JSON.stringify(transaction), JSON.stringify(receipt), c.id, c.name, c.currency, user?.name || 'Admin', new Date().toISOString()]);
      return remove.call(this, id, user);
    });
  };
  p.getDeletedTransactions = function () {
    return this.query("SELECT * FROM deleted_transactions WHERE restored_at='' ORDER BY id DESC").map(r => ({...r, transaction: JSON.parse(r.transaction_json)}));
  };
  p.restoreDeletedTransaction = function (id, reason, user) {
    if (user?.role !== 'Admin') throw Error('Only an Administrator can restore entries.');
    if (!String(reason || '').trim()) throw Error('Enter a reason for restoring this entry.');
    return this.atomic(() => {
      const saved = this.query("SELECT * FROM deleted_transactions WHERE id=? AND restored_at=''", [id])[0];
      if (!saved) throw Error('Entry is already restored or not found.');
      const t = JSON.parse(saved.transaction_json), c = this.getCustomerById(t.customer_id);
      if (!c || c.is_archived) throw Error('Restore the customer account first. Deleted customers cannot be restored here.');
      this.assertPeriodOpen(t.transaction_date);
      if (this.query('SELECT id FROM transactions WHERE transaction_code=?', [t.transaction_code]).length) throw Error('This entry already exists.');
      const cols = this.query('PRAGMA table_info(transactions)').map(c => c.name).filter(k => k !== 'id' && Object.hasOwn(t, k));
      this.run(`INSERT INTO transactions(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, cols.map(k => t[k]));
      const restored = this.query('SELECT * FROM transactions WHERE transaction_code=?', [t.transaction_code])[0];
      const receipt = JSON.parse(saved.receipt_json);
      if (receipt?.legacy) {
        this.createReceipt(restored.id,c.id,restored.amount);
      } else if (receipt) {
        receipt.transaction_id = restored.id;
        const keys = this.query('PRAGMA table_info(receipts)').map(c => c.name).filter(k => k !== 'id' && Object.hasOwn(receipt, k));
        this.run(`INSERT INTO receipts(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, keys.map(k => receipt[k]));
      }
      // Recovery assigns a new row ID; move the complete history with the entry.
      this.run('UPDATE transaction_history SET transaction_id=? WHERE transaction_id=?', [restored.id, t.id]);
      this.run('INSERT INTO transaction_history(transaction_id,action,before_json,after_json,reason,user_name,created_at) VALUES(?,?,?,?,?,?,?)',
        [restored.id,'RESTORE',JSON.stringify(t),JSON.stringify(restored),reason.trim(),user.name,new Date().toISOString()]);
      this.run('UPDATE deleted_transactions SET restored_at=? WHERE id=?', [new Date().toISOString(), id]);
      this.logAudit('RESTORE', 'TRANSACTION', restored.id, `Restored ${t.transaction_code}. Reason: ${reason.trim()}`, user);
      return restored;
    });
  };
  p.getMonthlySummary = function (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Select a valid month.');
    const from = month + '-01';
    const end = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
    this.validateDate(from); this.validateDate(end);
    const totals = ['AED', 'PKR'].map(currency => ({currency, opening:0, debit:0, credit:0, closing:0, count:0}));
    const grouped=this.query(`SELECT c.currency,
      SUM(CASE c.opening_balance_type WHEN 'Receivable' THEN c.opening_balance WHEN 'Payable' THEN -c.opening_balance ELSE 0 END + COALESCE(t.prior,0)) AS opening,
      SUM(COALESCE(t.debit,0)) AS debit,SUM(COALESCE(t.credit,0)) AS credit,SUM(COALESCE(t.count,0)) AS count
      FROM customers c LEFT JOIN (
        SELECT customer_id,
          SUM(CASE WHEN transaction_date < ? THEN CASE transaction_type WHEN 'Debit' THEN amount ELSE -amount END ELSE 0 END) AS prior,
          SUM(CASE WHEN transaction_date >= ? AND transaction_type='Debit' THEN amount ELSE 0 END) AS debit,
          SUM(CASE WHEN transaction_date >= ? AND transaction_type='Credit' THEN amount ELSE 0 END) AS credit,
          SUM(CASE WHEN transaction_date >= ? THEN 1 ELSE 0 END) AS count
        FROM transactions WHERE transaction_date <= ? GROUP BY customer_id
      ) t ON t.customer_id=c.id GROUP BY c.currency`,[from,from,from,from,end]);
    for(const row of totals){const data=grouped.find(g=>g.currency===row.currency);if(data)Object.assign(row,data,{closing:data.opening+data.debit-data.credit});}
    return {month, from, to:end, totals};
  };
};
