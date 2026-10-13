const {app,BrowserWindow}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'khata-reports-ui-')));app.disableHardwareAcceleration();
const timer=setTimeout(()=>{console.error('Outstanding report UI timed out');app.exit(1);},60000);
require(process.env.KHATA_TEST_PACKAGED?'../dist/win-unpacked/resources/app.asar/main.js':'../main');
app.whenReady().then(async()=>{try{
  let win;
  for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript("Boolean(document.getElementById('report-outstanding-summary')&&state.currentUser)"))break;await new Promise(r=>setTimeout(r,100));}
  const js=s=>win.webContents.executeJavaScript(s);
  await js(`(async()=>{for(const [name,currency,amount,type] of [['Small receivable','AED',12550,'Receivable'],['Large receivable','AED',25000,'Receivable'],['PKR receivable','PKR',500000,'Receivable'],['AED payable','AED',45050,'Payable'],['PKR payable','PKR',750000,'Payable'],['Settled','AED',0,'Receivable']])await api.createCustomer({name,currency,opening_balance:amount,opening_balance_type:type,mobile:'0501234567',address:'Mussafa Branch, Abu Dhabi'});navigateTo('reports');})()`);
  for(const type of ['receivable','payable']){
    await js(`(async()=>{currentReportType=${JSON.stringify(type)};document.getElementById('report-currency-filter').value='ALL';await loadReports();})()`);
    assert.equal(await js("[...document.querySelectorAll('#report-sheet-header-row th')].some(el=>el.textContent==='Status')"),false);
    assert.equal(await js("document.querySelectorAll('#report-sheet-header-row th').length"),4);
    assert.equal(await js("document.querySelectorAll('#report-sheet-body tr:first-child td').length"),4);
    assert.equal(await js("document.querySelectorAll('#report-sheet-body .badge-receivable,#report-sheet-body .badge-payable').length"),0);
    assert.deepEqual(await js("[...document.querySelectorAll('#report-sheet-header-row th')].map(el=>el.textContent.trim())"),['Account No.','Name','Contact','Balance']);
    assert.match(await js("document.querySelector('#report-sheet-body tr .report-outstanding-amount').textContent"),type==='receivable'?/AED 250/:/AED 450.50/);
    assert.equal(await js("(()=>{const cell=document.querySelector('#report-sheet-body tr .report-contact');return cell.querySelector('.report-contact-mobile').getBoundingClientRect().bottom<=cell.querySelector('.report-contact-address').getBoundingClientRect().top})()"),true);
    assert.match(await js("document.querySelector('#report-sheet-body tr').textContent"),/0501234567/);
    assert.match(await js("document.querySelector('#report-sheet-body tr').textContent"),/Mussafa Branch, Abu Dhabi/);
    const summary=await js("document.getElementById('report-outstanding-summary').innerText");
    assert.match(summary,type==='receivable'?/AED 375.50/:/AED 450.50/);
    assert.match(summary,type==='receivable'?/PKR 5,000/:/PKR 7,500/);
    if(type==='receivable')assert.match(await js("document.querySelector('#report-sheet-body tr:first-child').textContent"),/Large receivable/);
    const body=await js("document.getElementById('report-sheet-body').textContent");
    assert.doesNotMatch(body,type==='receivable'?/AED payable|PKR payable|Settled/:/receivable|Settled/);
    await js("document.getElementById('report-paper-container').scrollIntoView({block:'start'})");win.webContents.invalidate();await new Promise(r=>setTimeout(r,1000));
    fs.writeFileSync(path.join(__dirname,`report-${type}-preview.png`),(await win.webContents.capturePage()).toPNG());
    await js("(async()=>{document.getElementById('report-currency-filter').value='AED';await loadReports();})()");
    assert.doesNotMatch(await js("document.getElementById('report-outstanding-summary').textContent"),/PKR/);
    assert.equal(await js("document.querySelectorAll('#report-sheet-body tr').length"),type==='receivable'?2:1);
  }
  await js("(async()=>{await api.createCustomer({name:'Empty report placeholder',currency:'PKR'});const c=(await api.getCustomers()).find(c=>c.name==='PKR payable');await api.deleteCustomer(c.id);document.getElementById('report-currency-filter').value='PKR';await loadReports();})()");
  assert.equal(await js("document.querySelector('#report-sheet-body td').colSpan"),4);
  assert.match(await js("document.getElementById('report-sheet-body').textContent"),/No payable balances/);
  await js("(async()=>{currentReportType='balance';await loadReports();})()");
  assert.equal(await js("document.getElementById('report-outstanding-summary').hidden"),true);
  assert.equal(await js("document.querySelectorAll('#report-sheet-header-row th').length"),7);
  const pdfDirectory=path.join(__dirname,'..','tmp','pdfs');fs.mkdirSync(pdfDirectory,{recursive:true});
  await js(`(async()=>{for(let i=1;i<=30;i++)await api.createCustomer({name:'Long Contact Customer '+String(i).padStart(2,'0'),currency:'AED',mobile:'+971501234567',address:'Building 123, Industrial Area, Mussafa Branch, Abu Dhabi, United Arab Emirates. Delivery location and contact details preserved in full.',opening_balance:i===1?12345678901234:10000+i,opening_balance_type:i%2?'Receivable':'Payable'});window.print=()=>{};document.getElementById('report-currency-filter').value='ALL';})()`);
  for(const type of ['receivable','payable']){
    await js(`(async()=>{currentReportType=${JSON.stringify(type)};await loadReports();document.getElementById('btn-print-report').click();})()`);
    const pdf=await win.webContents.printToPDF({pageSize:'A4',printBackground:true,margins:{top:.4,bottom:.4,left:.4,right:.4}});
    fs.writeFileSync(path.join(pdfDirectory,`report-${type}.pdf`),pdf);
    await js("document.querySelectorAll('.print-target,.print-ancestor').forEach(el=>el.classList.remove('print-target','print-ancestor'))");
  }
  console.log('PASS: four columns, currency beside balance, mobile above address, accurate totals, filters and A4 PDFs');clearTimeout(timer);app.exit(0);
}catch(error){console.error(error);clearTimeout(timer);app.exit(1);}});
