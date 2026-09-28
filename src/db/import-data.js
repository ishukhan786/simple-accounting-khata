const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ImportData {
  constructor(db, backup) { this.db=db; this.backup=backup; this.previews=new Map(); }
  async read(file,kind) {
    if(!['customers','transactions'].includes(kind)) throw Error('Choose customers or transactions.');
    if(fs.statSync(file).size>5*1024*1024) throw Error('Import files must be 5 MB or smaller.');
    const Excel=require('exceljs'); const book=new Excel.Workbook();
    if(path.extname(file).toLowerCase()==='.xlsx') await book.xlsx.readFile(file);
    else if(path.extname(file).toLowerCase()==='.csv') await book.csv.readFile(file,{map:value=>value});
    else throw Error('Use an .xlsx or .csv file.');
    const sheet=book.worksheets[0]; if(!sheet || sheet.rowCount<2 || sheet.rowCount>1001) throw Error('Use the first sheet with 1–1000 data rows.');
    const headers=[]; sheet.getRow(1).eachCell((cell,col)=>{headers[col]=String(cell.value||'').trim().toLowerCase();});
    const required=kind==='customers'?['name','currency']:['account_code','transaction_date','transaction_type','amount','description'];
    if(required.some(h=>!headers.includes(h))) throw Error('Required columns: '+required.join(', '));
    if(new Set(headers.filter(Boolean)).size!==headers.filter(Boolean).length) throw Error('Column headings must be unique.');
    const rows=[];
    sheet.eachRow((row,n)=>{
      if(n===1)return;
      const values={}; let invalid=false;
      headers.forEach((h,col)=>{ if(!h)return; const value=row.getCell(col).value;
        if(value && typeof value==='object' && !(value instanceof Date)) invalid=true;
        values[h]=value instanceof Date?value.toISOString().slice(0,10):String(value??'').trim(); });
      if(Object.values(values).every(v=>!v))return;
      rows.push({row:n,values,parseError:invalid?'Formulas, rich text and links are not accepted. Paste plain values.':''});
    });
    const token=crypto.randomUUID(); this.previews.clear();
    this.previews.set(token,{kind,rows,created:Date.now()});
    return {token,kind,...this.validate(kind,rows)};
  }
  cents(value) {
    if(!/^\d+(\.\d{1,2})?$/.test(value||'0'))throw Error('Amount must be a positive number with at most 2 decimals (no separators).');
    const [whole,fraction='']=String(value||'0').split('.'); const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
    if(!Number.isSafeInteger(cents))throw Error('Amount too large.'); return cents;
  }
  validate(kind,rows) {
    const seen=new Set(), totals={AED:0,PKR:0}, results=[];
    for(const item of rows) {
      let data,duplicate=false,error=item.parseError;
      try {
        if(error)throw Error(error); const v=item.values;
        if(kind==='customers') {
          if(!v.name)throw Error('Name is required.');
          if(!['AED','PKR'].includes(v.currency))throw Error('Currency must be AED or PKR.');
          const amount=this.cents(v.opening_balance);
          const type=v.opening_balance_type||(amount?'Receivable':'Zero Balance');
          if(!['Receivable','Payable','Zero Balance'].includes(type)||type==='Zero Balance'&&amount)throw Error('Invalid opening balance type.');
          if(amount && this.db.getPeriodLock().locked_through)throw Error('Reopen the period before importing opening balances.');
          data={name:v.name,currency:v.currency,mobile:v.mobile||'',address:v.address||'',opening_balance:amount,opening_balance_type:type};
          const key=[v.name.toLowerCase(),v.mobile||'',v.currency].join('|');
          duplicate=seen.has(key)||this.db.getCustomers('',true).some(c=>c.name.toLowerCase()===v.name.toLowerCase()&&c.mobile===(v.mobile||'')&&c.currency===v.currency); seen.add(key);
          if(!duplicate)totals[v.currency]+=type==='Payable'?-amount:amount;
        } else {
          const c=this.db.getCustomerByAccountCode(v.account_code);
          if(!c||c.is_archived)throw Error('Account code not found or archived.');
          this.db.validateDate(v.transaction_date); this.db.assertPeriodOpen(v.transaction_date);
          if(!['Debit','Credit'].includes(v.transaction_type))throw Error('Type must be Debit or Credit.');
          const amount=this.cents(v.amount); if(!amount)throw Error('Amount must be greater than zero.');
          if(!v.description)throw Error('Description is required.');
          if(v.due_date) {this.db.validateDate(v.due_date); if(v.due_date<v.transaction_date)throw Error('Due date cannot precede transaction date.');}
          data={customer_id:c.id,transaction_date:v.transaction_date,transaction_type:v.transaction_type,amount,description:v.description,due_date:v.due_date||'',reference_number:v.reference_number||''};
          const key=[c.id,v.transaction_date,v.transaction_type,amount].join('|');
          duplicate=seen.has(key)||this.db.findDuplicateTransactions(data).length>0; seen.add(key);
          if(!duplicate)totals[c.currency]+=v.transaction_type==='Debit'?amount:-amount;
        }
      } catch(e) {error=e.message;}
      results.push({...item,data,duplicate,error});
    }
    return {rows:results,totals,errors:results.filter(r=>r.error).length,duplicates:results.filter(r=>r.duplicate).length,ready:results.filter(r=>!r.error&&!r.duplicate).length};
  }
  commit(token,user) {
    if(user?.role!=='Admin')throw Error('Only an Administrator can import.');
    const preview=this.previews.get(token); if(!preview||Date.now()-preview.created>30*60000)throw Error('Preview expired. Select the file again.');
    const result=this.validate(preview.kind,preview.rows);
    if(result.errors||!result.ready)throw Error('Fix all errors and preview again. At least one new row is required.');
    this.backup.createBackup(null,user);
    const count=this.db.atomic(()=>{
      for(const row of result.rows.filter(r=>!r.duplicate)) {
        if(preview.kind==='customers')this.db.createCustomer(row.data,user);
        else this.db.createTransaction({...row.data,request_id:crypto.randomUUID()},user);
      }
      this.db.logAudit('IMPORT','SYSTEM',0,`Imported ${result.ready} ${preview.kind}; skipped ${result.duplicates} duplicates.`,user);
      return result.ready;
    });
    this.previews.delete(token);return {count,skipped:result.duplicates};
  }
}
module.exports=ImportData;
