const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{performance}=require('perf_hooks');
const DB=require('./db/database');
(async()=>{
 const db=new DB(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'khata-performance-')),'test.db'));await db.init();
 db.db.run('BEGIN');
 const customer=db.db.prepare('INSERT INTO customers(account_code,name,currency,opening_balance,opening_balance_type,is_archived,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
 for(let i=1;i<=1000;i++)customer.run([String(i),'Customer '+i,i%2?'AED':'PKR',1049,i%3?'Receivable':'Payable',i%4===0?1:0,'2026-01-01','2026-01-01']);customer.free();
 const ids=db.query('SELECT id FROM customers').map(c=>c.id);
 const transaction=db.db.prepare('INSERT INTO transactions(transaction_code,customer_id,transaction_date,transaction_type,amount,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
 for(let i=0;i<50000;i++)transaction.run(['B'+i,ids[i%1000],['2026-09-30','2026-10-01','2026-10-31','2026-11-01'][i%4],i%3?'Debit':'Credit',1049,'2026-10-11','2026-10-11']);transaction.free();db.db.run('COMMIT');
 const reference=['AED','PKR'].map(currency=>({currency,opening:0,debit:0,credit:0,closing:0,count:0}));
 const before=performance.now();
 for(const c of db.getCustomers('',true)){
  const ledger=db.getCustomerLedger(c.id,'ASC','2026-10-01','2026-10-31'),s=ledger.summary,row=reference.find(r=>r.currency===c.currency);
  row.opening+=s.opening_balance_type==='Payable'?-s.opening_balance:s.opening_balance;
  row.debit+=s.total_debit;row.credit+=s.total_credit;row.closing+=s.closing_balance;row.count+=ledger.transactions.length;
 }
 const oldTime=performance.now()-before;
 let queries=0;const original=db.query;db.query=function(...args){queries++;return original.apply(this,args)};
 const start=performance.now(),summary=db.getMonthlySummary('2026-10'),newTime=performance.now()-start;db.query=original;
 assert.deepEqual(summary.totals,reference);assert.equal(queries,1);
 const filtered=db.getAllTransactions({currency:'AED',date_from:'2026-10-01',sort:'newest'});
 const collected=[];let last;
 for(let page=1;page<=Math.ceil(filtered.length/100);page++){
  last=db.getAllTransactions({currency:'AED',date_from:'2026-10-01',sort:'newest',page_size:100,page});
  assert.equal(last.total,filtered.length);assert(last.rows.length<=100);collected.push(...last.rows.map(r=>r.id));
 }
 assert.deepEqual(collected,filtered.map(r=>r.id));
 assert.equal(db.getAllTransactions({search:'does not exist',page_size:50,page:3}).total,0);
 assert.equal(db.getAllTransactions({page_size:50,page:Number.MAX_SAFE_INTEGER}).page,Math.ceil(50000/50));
 assert.throws(()=>db.getAllTransactions({page_size:1000}),/Invalid/);
 assert.throws(()=>db.getAllTransactions({page_size:50,page:-1}),/Invalid/);
 console.log(`PASS: 1000 customers / 50000 entries; monthly summary ${oldTime.toFixed(1)} ms -> ${newTime.toFixed(1)} ms, exact same totals in 1 query; filtered pagination has no missing or duplicate rows.`);
 db.db.close();
})().catch(error=>{console.error(error);process.exitCode=1});
