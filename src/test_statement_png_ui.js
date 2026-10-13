const {app,BrowserWindow,dialog,nativeImage}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'khata-png-ui-')));app.disableHardwareAcceleration();
const output=path.join(__dirname,'../tmp/pdfs/statement-export.png');
fs.mkdirSync(path.dirname(output),{recursive:true});
let saves=0,cancel=false,captures=[];
dialog.showSaveDialog=async(_,options)=>{assert.equal(options.filters[0].extensions[0],'png');saves++;return {canceled:cancel,filePath:output};};
app.on('browser-window-created',(_,win)=>{
  const capture=win.webContents.capturePage.bind(win.webContents);
  win.webContents.capturePage=async(rect,options)=>{
    captures.push({text:await win.webContents.executeJavaScript('document.body.innerText'),rect});
    return capture(rect,options);
  };
});
const timeout=setTimeout(()=>{console.error('PNG test timed out');app.exit(1);},90000);
require(process.env.KHATA_TEST_PACKAGED?'../dist/win-unpacked/resources/app.asar/main.js':'../main');
app.whenReady().then(async()=>{try{
  let win;
  for(let i=0;i<100;i++){
    win=BrowserWindow.getAllWindows()[0];
    if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript("Boolean(document.getElementById('save-statement-png')&&state.currentUser)"))break;
    await new Promise(r=>setTimeout(r,100));
  }
  const js=s=>win.webContents.executeJavaScript(s),tick=()=>new Promise(r=>setTimeout(r,150));
  const click=async()=>{
    const point=await js("(()=>{const el=document.getElementById('save-statement-png');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await tick();
    for(let i=0;i<200&&await js("document.getElementById('save-statement-png').disabled");i++)await tick();
    assert.equal(await js("document.getElementById('save-statement-png').disabled"),false);
  };
  await js(`(async()=>{const c=await api.createCustomer({name:'PNG Customer',currency:'AED',opening_balance:1049,opening_balance_type:'Receivable',mobile:'971501234567',address:'Mussafa Branch, Abu Dhabi'});await api.createTransaction({customer_id:c.id,transaction_date:'2026-01-01',transaction_type:'Debit',amount:1049,description:'Excluded January'});for(let i=1;i<=100;i++)await api.createTransaction({customer_id:c.id,transaction_date:'2026-02-10',transaction_type:'Debit',amount:1049,description:'February entry '+i});await openCustomerStatementModal(c.id,'2026-02-01','2026-02-28');})()`);
  await js("document.getElementById('statement-from').value='2026-03-01'");await click();assert.equal(saves,0);
  await js("document.getElementById('statement-from').value='2026-02-01';state.statementLoading=true");await click();assert.equal(saves,0);
  await js('state.statementLoading=false');await click();assert.equal(saves,1);
  const text=captures.map(c=>c.text).join('\n');assert.match(text,/February entry 100/);assert.doesNotMatch(text,/Excluded January/);
  const entries=captures.flatMap(c=>[...c.text.matchAll(/February entry (\d+)/g)].map(m=>Number(m[1])));
  assert.deepEqual(entries,Array.from({length:100},(_,i)=>i+1));assert(captures.length>=4);
  const directories=()=>fs.readdirSync(path.dirname(output)).filter(n=>n.startsWith('statement-export-pages-'));
  const folder=directories().sort((a,b)=>fs.statSync(path.join(path.dirname(output),b)).mtimeMs-fs.statSync(path.join(path.dirname(output),a)).mtimeMs)[0];
  const files=fs.readdirSync(path.join(path.dirname(output),folder)).sort();assert.equal(files.length,captures.length);
  for(let i=0;i<captures.length;i++){
    assert.match(captures[i].text,/AED 1,069\.98/);assert.match(captures[i].text,/01-02-2026 to 28-02-2026/);
    assert.match(captures[i].text,/PNG Customer/);assert.match(captures[i].text,/ACCOUNT STATEMENT/);
    assert(captures[i].text.includes(`Page ${i+1} of ${captures.length}`));
    const bytes=fs.readFileSync(path.join(path.dirname(output),folder,files[i]));assert.equal(bytes.subarray(1,4).toString(),'PNG');
    const size=nativeImage.createFromBuffer(bytes).getSize();assert.equal(size.height/size.width,captures[i].rect.height/captures[i].rect.width);
    assert(captures[i].rect.height<=1414);
  }
  const previous=directories();cancel=true;await click();assert.equal(saves,2);assert.deepEqual(directories(),previous);
  await js("closeModal('modal-statement',true);navigateTo('transactions')");await tick();
  assert.equal(await js("document.querySelectorAll('#all-transactions-body tr').length"),50);
  const next=await js("(()=>{const r=document.getElementById('transactions-next').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
  for(let i=0;i<2;i++){
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...next});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...next});await tick();
  }
  assert.equal(await js('state.transactionsPage'),3);assert.equal(await js("document.querySelectorAll('#all-transactions-body tr').length"),1);
  assert.equal(await js("document.getElementById('transactions-next').disabled"),true);
  await js("document.getElementById('global-search-input').value='February entry 100';loadTransactions()");await tick();
  assert.equal(await js('state.transactionsPage'),1);assert.match(await js("document.getElementById('transactions-page-info').textContent"),/of 1 transactions/);
  await js("document.getElementById('global-search-input').value='';loadTransactions()");await tick();
  const largePageCount=captures.length;captures=[];cancel=false;
  const empty=await js("(async()=>{const c=await api.createCustomer({name:'Empty PNG',currency:'PKR'});return api.exportStatementPng(c.id);})()");
  assert.equal(empty.pageCount,1);assert.equal(captures.length,1);assert.match(captures[0].text,/Opening Balance/);
  captures=[];
  const wrapped=await js(`(async()=>{const c=await api.createCustomer({name:'Wrapped PNG',currency:'AED'});for(let i=1;i<=12;i++)await api.createTransaction({customer_id:c.id,transaction_date:'2026-02-10',transaction_type:'Debit',amount:1049,description:'Wrapped entry '+i+' '+('Long delivery description with complete details. '.repeat(15))});return api.exportStatementPng(c.id);})()`);
  assert(wrapped.pageCount>1);assert.deepEqual(captures.flatMap(c=>[...c.text.matchAll(/Wrapped entry (\d+)/g)].map(m=>Number(m[1]))),Array.from({length:12},(_,i)=>i+1));
  assert(captures.every(c=>c.rect.height<=1414));
  await js('api.logout()');await assert.rejects(js('api.exportStatementPng(state.statementCustomerId)'));
  console.log('PASS: 100 entries exported once across',largePageCount,'PNG pages; empty and wrapped statements, repeated headers, decimals, dates, cancellation and authentication. Folder:',folder);
  clearTimeout(timeout);app.exit(0);
}catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}});
