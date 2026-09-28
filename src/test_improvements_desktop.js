const {app,BrowserWindow,dialog,shell}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'khata-features-ui-'));
app.setPath('userData',dir);app.disableHardwareAcceleration();app.getVersion=()=>require('../package.json').version;
const csv=path.join(dir,'customers.csv'),pdf=path.join(dir,'statement.pdf');
fs.writeFileSync(csv,'name,currency,mobile\nImported Customer,PKR,923001234567\n');
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[csv]});dialog.showSaveDialog=async()=>({canceled:false,filePath:pdf});
let external='';shell.openExternal=async url=>{external=url;};
const timeout=setTimeout(()=>{console.error('Features UI test timed out');app.exit(1);},60000);
require(process.env.KHATA_TEST_PACKAGED?'../dist/win-unpacked/resources/app.asar/main.js':'../main');
app.whenReady().then(async()=>{
 try{
  let win;
  for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript('Boolean(window.navigateTo && document.getElementById("generate-aging"))'))break;await new Promise(r=>setTimeout(r,100));}
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const tick=()=>new Promise(r=>setTimeout(r,100));
    const check=(ok,msg)=>{if(!ok)throw Error(msg);};
    const click=async id=>{const el=document.getElementById(id);el.click();for(let i=0;i<250;i++){await tick();if(!el.disabled)break;}};
    const c=await api.createCustomer({name:'UI Test Customer',currency:'AED',mobile:'971501234567'});
    await openQuickTransactionModal(c.id);
    document.getElementById('trx-debit').value='123.45';document.getElementById('trx-details').value='Invoice for testing';document.getElementById('trx-date').value='2026-01-01';document.getElementById('trx-due-date').value='2026-01-08';
    await handleSaveTransaction();
    let rows=await api.getAllTransactions();check(rows.length===1,'Transaction save');check(rows[0].due_date==='2026-01-08','Due date save');
    await openQuickTransactionModal(c.id);
    document.getElementById('trx-debit').value='123.45';document.getElementById('trx-details').value='Invoice for testing';document.getElementById('trx-date').value='2026-01-01';
    await handleSaveTransaction();
    check((await api.getAllTransactions()).length===2,'Second same-amount transaction must save without confirmation');
    check(!document.getElementById('trx-allow-duplicate'),'Duplicate confirmation checkbox should be removed');
    await openEditTransactionModal(rows[0].id);document.getElementById('trx-correction-reason').value='Invoice correction';document.getElementById('trx-debit').value='120.00';await handleSaveTransaction();
    await openEditTransactionModal(rows[0].id);await click('btn-trx-history');check(document.getElementById('trx-history').textContent.includes('Invoice correction'),'History UI');closeModal('modal-new-transaction',true);
    navigateTo('reports');document.getElementById('aging-date').value='2026-02-01';await click('generate-aging');check(document.getElementById('aging-result').textContent.includes('UI Test Customer'),'Aging result');
    await openCustomerStatementModal(c.id,'2026-01-01','2026-01-31');await click('save-statement-pdf');await click('share-statement');closeModal('modal-statement',true);
    navigateTo('backup');await click('refresh-health');check(document.getElementById('health-summary').textContent.includes('Google Drive is not connected'),'Health warning');
    await click('preview-import');check(document.getElementById('import-summary').textContent.includes('1 new rows'),'Import preview');await click('commit-import');check((await api.getCustomers()).length===2,'Import commit');
    navigateTo('settings');await tick();document.getElementById('tab-settings-security').click();document.getElementById('period-date').value='2026-01-31';document.getElementById('period-reason').value='Daily close checked';await click('close-period');check(document.getElementById('period-status').textContent.includes('2026-01-31'),'Period closed');
    document.getElementById('period-reason').value='Reopen test';await click('reopen-period');check((await api.getPeriodLock()).locked_through==='','Reopened');
    await click('download-installer');check(document.getElementById('update-download-message').textContent.length>0,'Update status');
    navigateTo('reports');document.getElementById('aging-report').scrollIntoView();await new Promise(r=>setTimeout(r,500));
    return {passed:true,features:['transaction due date','correction history','aging report','PDF export','WhatsApp draft','backup health','CSV preview/import','period closing/reopening','update state']};
  })()`);
  assert.match(fs.readFileSync(pdf).subarray(0,5).toString(),/%PDF-/);assert.match(external,/^https:\/\/wa.me\/971501234567\?text=/);
  fs.writeFileSync(path.join(__dirname,'features-preview.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({...result,pdfBytes:fs.statSync(pdf).size}));clearTimeout(timeout);app.exit(0);
 }catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}
});
