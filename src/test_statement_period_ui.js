const {app,BrowserWindow,dialog,shell}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'khata-period-ui-'));
app.setPath('userData',directory);app.disableHardwareAcceleration();
let saves=0, rendered='', whatsapp='';
const pdf=path.join(directory,'period.pdf');
dialog.showSaveDialog=async()=>{saves++;return{canceled:false,filePath:pdf};};
shell.openExternal=async url=>{whatsapp=url;};
app.on('browser-window-created',(_,win)=>{
  const print=win.webContents.printToPDF.bind(win.webContents);
  win.webContents.printToPDF=async options=>{
    rendered=await win.webContents.executeJavaScript('document.body.innerText');
    return print(options);
  };
});
const timeout=setTimeout(()=>{console.error('Statement period UI test timed out');app.exit(1);},60000);
require(process.env.KHATA_TEST_PACKAGED?'../dist/win-unpacked/resources/app.asar/main.js':'../main');
app.whenReady().then(async()=>{try{
  let win;
  for(let i=0;i<100;i++){
    win=BrowserWindow.getAllWindows()[0];
    if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript("Boolean(document.getElementById('save-statement-pdf')&&state.currentUser)"))break;
    await new Promise(r=>setTimeout(r,100));
  }
  const js=s=>win.webContents.executeJavaScript(s),tick=()=>new Promise(r=>setTimeout(r,150));
  const click=async selector=>{
    const point=await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await tick();
  };
  const waitButton=async id=>{for(let i=0;i<100&&await js(`document.getElementById(${JSON.stringify(id)}).disabled`);i++)await tick();assert.equal(await js(`document.getElementById(${JSON.stringify(id)}).disabled`),false);};
  await js(`(async()=>{const c=await api.createCustomer({name:'Period Review',currency:'AED',mobile:'971501234567'});for(const [date,description] of [['2026-01-10','January entry'],['2026-02-10','February entry']])await api.createTransaction({customer_id:c.id,transaction_date:date,transaction_type:'Debit',amount:1049,description});await openCustomerStatementModal(c.id,'2026-01-01','2026-01-31');})()`);
  const january=await js("document.getElementById('statement-paper').innerText");
  assert.match(january,/January entry/);assert.doesNotMatch(january,/February entry/);
  await js("document.getElementById('statement-from').value='2026-02-01';document.getElementById('statement-to').value='2026-02-28'");
  await click('#save-statement-pdf');await waitButton('save-statement-pdf');
  await click('#share-statement');await waitButton('share-statement');
  assert.equal(saves,0);assert.equal(whatsapp,'');assert.equal(fs.existsSync(pdf),false);
  assert.match(await js("document.getElementById('toast-container').textContent"),/Apply Dates first/);
  assert.equal(await js("document.getElementById('statement-paper').innerText"),january);
  await js("document.getElementById('toast-container').replaceChildren()");
  await click('#filter-statement');await waitButton('filter-statement');
  const february=await js("document.getElementById('statement-paper').innerText");
  assert.match(february,/February entry/);assert.doesNotMatch(february,/January entry/);
  assert.match(february,/AED 10\.49/);assert.match(february,/AED 20\.98/);
  await click('#save-statement-pdf');await waitButton('save-statement-pdf');
  assert.equal(saves,1);assert(fs.statSync(pdf).size>500);
  assert.match(rendered,/01-02-2026 to 28-02-2026/);assert.match(rendered,/February entry/);assert.doesNotMatch(rendered,/January entry/);
  assert.match(rendered,/AED 10\.49/);assert.match(rendered,/AED 20\.98/);
  fs.mkdirSync(path.join(__dirname,'../tmp/pdfs'),{recursive:true});
  fs.copyFileSync(pdf,path.join(__dirname,'../tmp/pdfs/statement-decimals.pdf'));
  await click('#share-statement');await waitButton('share-statement');
  assert.equal(saves,2);assert.match(decodeURIComponent(whatsapp),/2026-02-01 to 2026-02-28/);
  await js("document.getElementById('statement-from').value='2026-03-01';document.getElementById('statement-to').value='2026-02-01'");
  await click('#filter-statement');await waitButton('filter-statement');
  assert.equal(await js('state.statementFrom'),'2026-02-01');
  assert.equal(await js("document.getElementById('statement-paper').innerText"),february);
  await click('#save-statement-pdf');await waitButton('save-statement-pdf');assert.equal(saves,2);
  await js("(async()=>{await api.logout();await openCustomerStatementModal(state.statementCustomerId,'2026-03-01','2026-03-31');await api.authenticate('admin','admin123');})()");
  assert.equal(await js('state.statementFrom'),'2026-02-01');assert.equal(await js('state.statementLoading'),false);
  assert.equal(await js("document.getElementById('statement-paper').innerText"),february);
  await js("document.getElementById('statement-from').value='2026-02-01';document.getElementById('statement-to').value='2026-02-28';state.statementLoading=true");
  await click('#save-statement-pdf');await waitButton('save-statement-pdf');assert.equal(saves,2);
  await js('state.statementLoading=false');
  console.log('PASS: unapplied dates block PDF/share, Apply Dates syncs preview and actual PDF, WhatsApp matches, failed loads preserve period, loading blocks export');
  clearTimeout(timeout);app.exit(0);
}catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}});
