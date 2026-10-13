const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'khata-edit-layout-')));
app.disableHardwareAcceleration();
setTimeout(()=>app.exit(1),30000);
require('../main');
app.whenReady().then(async()=>{
 try {
  let win;
  for(let i=0;i<100;i++){
   win=BrowserWindow.getAllWindows()[0];
   if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript("Boolean(document.getElementById('trx-correction-reason') && state.currentUser)"))break;
   await new Promise(r=>setTimeout(r,100));
  }
  const js=s=>win.webContents.executeJavaScript(s);
  await js(`(async()=>{const c=await api.createCustomer({name:'Layout Test',currency:'PKR'});const r=await api.createTransaction({customer_id:c.id,amount:10000,transaction_type:'Debit',transaction_date:'2026-09-01',due_date:'2026-09-10',payment_method:'Bank Transfer',reference_number:'BANK-42',notes:'Keep these notes',description:'Layout test'});await openEditTransactionModal(r.transaction.id);})()`);
  for(const size of [[1280,820],[1024,700]]){
   win.setSize(...size);await new Promise(r=>setTimeout(r,250));
   const layout=await js(`(()=>{const body=document.querySelector('#form-new-transaction .modal-body');const btn=document.getElementById('btn-save-transaction');const r=btn.getBoundingClientRect();body.scrollTop=body.scrollHeight;return {top:r.top,bottom:r.bottom,height:innerHeight,scroll:body.scrollTop,overflow:body.scrollHeight>body.clientHeight,text:btn.textContent};})()`);
   assert(layout.top>0&&layout.bottom<=layout.height,JSON.stringify(layout));
   assert(!layout.overflow || layout.scroll>0,'Overflowing edit body must scroll at '+size);
   assert.match(layout.text,/Update Transaction/);
  }
  await js("document.getElementById('trx-debit').value='125.50';document.getElementById('trx-date').value='2026-09-30';document.getElementById('trx-correction-reason').value='Layout update check'");
  const point=await js("(()=>{const r=document.getElementById('btn-save-transaction').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
  fs.writeFileSync(path.join(__dirname,'transaction-edit-preview.png'),(await win.webContents.capturePage()).toPNG());
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  await new Promise(r=>setTimeout(r,400));
  assert.equal(await js('(async()=> (await api.getAllTransactions())[0].amount)()'),12550);
  assert.equal(await js("document.getElementById('modal-new-transaction').classList.contains('active-modal')"),false);
  const saved=await js('(async()=> (await api.getAllTransactions())[0])()');
  assert.equal(saved.payment_method,'Bank Transfer');
  assert.equal(saved.reference_number,'BANK-42');
  assert.equal(saved.notes,'Keep these notes');
  assert.equal(saved.due_date,'2026-09-10');
  await js('(async()=>{const row=(await api.getAllTransactions())[0];await openCustomerStatementModal(row.customer_id);})()');
  const statement=await js("({amount:document.querySelector('#stmt-table-body tr:last-child td:nth-child(3)').textContent,empty:document.querySelector('#stmt-table-body tr:last-child td:nth-child(4)').textContent,total:document.getElementById('stmt-calc-debit').textContent})");
  assert.equal(statement.amount,'126'); assert.equal(statement.empty,''); assert.equal(statement.total,'PKR 126');
  console.log('PASS: Decimal statement, hidden due date edit, metadata preservation.');
  console.log('PASS: edit scroll and visible Update at 1280x820 and 1024x700; native Update click saved.');app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});
