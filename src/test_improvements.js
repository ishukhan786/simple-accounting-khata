const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os');
const DB=require('./db/database'),Backup=require('./db/backup'),Import=require('./db/import-data'),statement=require('./statement');
const admin={id:1,name:'Admin',role:'Admin'};
async function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'khata-features-'));const db=new DB(path.join(dir,'khata.db'));await db.init();const backup=new Backup(db,path.join(dir,'backups'));return {dir,db,backup};}
const customer=db=>db.createCustomer({name:'Test Customer',currency:'AED'},admin);
const entry=(id,extra={})=>({customer_id:id,transaction_date:'2026-01-01',transaction_type:'Debit',amount:10000,description:'Invoice',...extra});
test('same-amount entries are allowed while submission retries remain idempotent',async()=>{
  const {db,dir}=await fixture(),c=customer(db);const data=entry(c.id,{request_id:'same-request'});
  const first=db.createTransaction(data,admin);assert.equal(db.createTransaction(data,admin).transaction.id,first.transaction.id);
  db.createTransaction(entry(c.id,{request_id:'second-request'}),admin);
  db.createTransaction(entry(c.id),admin);
  const reopened=new DB(path.join(dir,'khata.db'));await reopened.init();
  assert.equal(reopened.createTransaction(data,admin).transaction.id,first.transaction.id);
  assert.equal(reopened.getAllTransactions().length,3);
});
test('FIFO aging settles oldest debits, preserves cents and isolates currencies',async()=>{
  const {db}=await fixture(),c=customer(db),p=db.createCustomer({name:'PKR Customer',currency:'PKR'},admin);
  db.createTransaction(entry(c.id,{amount:10001,due_date:'2026-01-02'}),admin);
  db.createTransaction(entry(c.id,{amount:20002,transaction_date:'2026-01-03',due_date:'2026-02-28'}),admin);
  db.createTransaction(entry(c.id,{transaction_type:'Credit',amount:15001,transaction_date:'2026-01-04'}),admin);
  db.createTransaction(entry(p.id,{amount:50000}),admin);
  const rows=db.getAgingReport('2026-02-01');assert.equal(rows.length,2);
  const a=rows.find(r=>r.currency==='AED');assert.equal(a.total,15002);assert.equal(a.not_due,15002);assert.equal(a.days_8_30,0);
  assert.equal(rows.find(r=>r.currency==='PKR').undated,50000);
  assert.equal(db.getAgingReport('2026-01-02','AED')[0].not_due,10001);
});
test('closed period blocks all historical mutation paths; reopen requires Admin and reason',async()=>{
  const {db}=await fixture(),c=customer(db),t=db.createTransaction(entry(c.id),admin).transaction;
  db.setPeriodLock('2026-01-31','Month reconciled',admin);
  assert.throws(()=>db.createTransaction(entry(c.id,{amount:100}),admin),/closed/);
  assert.throws(()=>db.updateTransaction(t.id,{amount:200,transaction_date:'2026-02-01',correction_reason:'Move'},admin),/closed/);
  assert.throws(()=>db.deleteTransaction(t.id,admin),/closed/);
  assert.throws(()=>db.deleteCustomer(c.id,admin),/closed/);
  assert.throws(()=>db.createCustomer({name:'Opening',currency:'AED',opening_balance:100,opening_balance_type:'Receivable'},admin),/closed/);
  assert.throws(()=>db.setPeriodLock('','Reopen',{role:'Staff'}),/Administrator/);
  assert.throws(()=>db.setPeriodLock('','',admin),/reason/);
  db.setPeriodLock('','Correct January invoice',admin);db.deleteTransaction(t.id,admin);
  assert.equal(db.getTransactionHistory(t.id)[0].action,'DELETE');
});
test('correction history captures actor, reason and complete before/after',async()=>{
  const {db}=await fixture(),c=customer(db),t=db.createTransaction(entry(c.id),admin).transaction;
  assert.throws(()=>db.updateTransaction(t.id,{amount:100},admin),/reason/);
  db.updateTransaction(t.id,{amount:12345,description:'Correct invoice',due_date:'2026-02-01',correction_reason:'Invoice amount corrected'},admin);
  const h=db.getTransactionHistory(t.id)[0];assert.equal(JSON.parse(h.before_json).amount,10000);assert.equal(JSON.parse(h.after_json).amount,12345);assert.equal(h.user_name,'Admin');
});
test('CSV preview validates all rows; commit skips duplicates and makes backup',async()=>{
  const {db,dir,backup}=await fixture(),service=new Import(db,backup);
  const file=path.join(dir,'customers.csv');fs.writeFileSync(file,'name,currency,opening_balance\nAlice,AED,12.50\nAlice,AED,12.50\nBob,PKR,20.00\n');
  const preview=await service.read(file,'customers');assert.equal(preview.ready,2);assert.equal(preview.duplicates,1);assert.equal(preview.totals.AED,1250);
  const result=service.commit(preview.token,admin);assert.equal(result.count,2);assert.equal(backup.getBackupList().length,1);assert.equal(db.getCustomers().length,2);
  assert.throws(()=>service.commit(preview.token,admin),/expired/);
});
test('Excel transactions support date cells, reject formulas, errors never partially import',async()=>{
  const {db,dir,backup}=await fixture(),c=customer(db),service=new Import(db,backup);
  const Excel=require('exceljs'),book=new Excel.Workbook(),sheet=book.addWorksheet('Transactions');
  sheet.addRow(['account_code','transaction_date','transaction_type','amount','description']);
  sheet.addRow([c.account_code,new Date('2026-01-01T00:00:00Z'),'Debit',12.34,'Invoice']);
  sheet.addRow([c.account_code,'2026-01-02','Debit',{formula:'1+2',result:3},'Bad formula']);
  const file=path.join(dir,'import.xlsx');await book.xlsx.writeFile(file);
  let preview=await service.read(file,'transactions');assert.equal(preview.errors,1);assert.throws(()=>service.commit(preview.token,admin),/Fix all/);assert.equal(db.getAllTransactions().length,0);
  sheet.spliceRows(3,1);await book.xlsx.writeFile(file);preview=await service.read(file,'transactions');service.commit(preview.token,admin);assert.equal(db.getAllTransactions()[0].amount,1234);
});
test('import rollback restores in-memory and on-disk records on failure',async()=>{
  const {db,dir,backup}=await fixture(),service=new Import(db,backup);const file=path.join(dir,'in.csv');
  fs.writeFileSync(file,'name,currency\nAlice,AED\nBob,PKR\n');const preview=await service.read(file,'customers');
  const original=db.createCustomer.bind(db);let calls=0;db.createCustomer=(...args)=>{if(++calls===2)throw Error('Simulated failure');return original(...args);};
  assert.throws(()=>service.commit(preview.token,admin),/Simulated/);assert.equal(db.getCustomers().length,0);
  const reopened=new DB(db.dbPath);await reopened.init();assert.equal(reopened.getCustomers().length,0);
});
test('customer statement is date-filtered, escaped and contains only the selected party',async()=>{
  const {db}=await fixture(),a=customer(db),b=db.createCustomer({name:'Secret Other Party',currency:'PKR'},admin);
  db.createTransaction(entry(a.id,{description:'<script>unsafe</script>'}),admin);db.createTransaction(entry(b.id,{description:'Other secret record'}),admin);
  const result=statement(db,a.id,'2026-01-01','2026-01-31');assert.doesNotMatch(result.html,/Secret Other|Other secret/);assert.match(result.html,/&lt;script&gt;/);assert.match(result.html,/100.00/);
  assert.throws(()=>statement(db,a.id,'2026-02-01','2026-01-01'),/From date/);
});
test('update download reports progress and installer cannot run without a successful backup',async()=>{
  const {db,backup}=await fixture(),handlers={},events=[];const {EventEmitter}=require('events');
  const updater=new EventEmitter();let installed=false;
  updater.checkForUpdates=async()=>({isUpdateAvailable:true});
  updater.downloadUpdate=async()=>{updater.emit('download-progress',{percent:50});updater.emit('update-downloaded');};
  updater.quitAndInstall=()=>{installed=true;};
  require('./desktop-improvements')({handle:(name,fn)=>handlers[name]=fn,db,backupManager:backup,
    driveBackup:{status:()=>({connected:false,pending:0})},getWindow:()=>({isDestroyed:()=>false,webContents:{send:(_,data)=>events.push(data)}}),
    app:{isPackaged:true},createUpdater:()=>updater});
  assert.throws(()=>handlers.installAppUpdate(null,admin),/Download/);
  await handlers.downloadAppUpdate();assert.equal(events.some(e=>e.percent===50),true);assert.equal(events.at(-1).phase,'ready');
  const original=backup.createBackup;backup.createBackup=()=>{throw Error('disk full');};
  assert.throws(()=>handlers.installAppUpdate(null,admin),/disk full/);assert.equal(installed,false);
  backup.createBackup=original;handlers.installAppUpdate(null,admin);assert.equal(backup.getBackupList().length,1);
  await new Promise(r=>setTimeout(r,550));assert.equal(installed,true);
});
test('legacy database upgrade preserves data and creates a migration safety copy',async()=>{
  const {db,dir}=await fixture(),c=customer(db);db.createTransaction(entry(c.id),admin);
  db.db.run('DROP INDEX idx_transaction_request');
  db.db.run('ALTER TABLE transactions DROP COLUMN request_id');db.db.run('ALTER TABLE transactions DROP COLUMN due_date');
  db.saveToDisk();db.db.close();
  const updated=new DB(path.join(dir,'khata.db'));await updated.init();
  assert.equal(updated.getAllTransactions().length,1);assert.equal(updated.getAllTransactions()[0].due_date,'');
  assert.equal(fs.existsSync(updated.dbPath+'.pre-1.1.0.db'),true);
});
test('staff cannot import, unlock periods or install updates using forged Admin arguments',async()=>{
  const {db}=await fixture();db.createUser('Staff','staff','strong-password','Staff',admin);
  const Guard=require('./session-guard'),guard=new Guard(db);await guard.invoke('authenticate',9,['staff','strong-password'],()=>{});
  for(const action of ['previewImport','commitImport','setPeriodLock','downloadAppUpdate','installAppUpdate']) {
    await assert.rejects(()=>guard.invoke(action,9,['',admin,admin],()=>{throw Error('Should not execute');}),/Administrator/);
  }
});
