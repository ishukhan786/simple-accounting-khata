const {app,BrowserWindow}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'khata-directory-ui-')));app.disableHardwareAcceleration();
const timer=setTimeout(()=>{console.error('Customer directory layout timed out');app.exit(1);},60000);
require(process.env.KHATA_TEST_PACKAGED?'../dist/win-unpacked/resources/app.asar/main.js':'../main');
app.whenReady().then(async()=>{try{
  let win;for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript("Boolean(document.getElementById('customer-sort')&&state.currentUser)"))break;await new Promise(r=>setTimeout(r,100));}
  const js=s=>win.webContents.executeJavaScript(s),settle=()=>new Promise(r=>setTimeout(r,500));
  await js("(async()=>{for(let i=1;i<=26;i++)await api.createCustomer({name:'Customer '+String(i).padStart(2,'0'),currency:'AED',address:'Mussafa Branch',mobile:'0501234567',opening_balance:i*10000});navigateTo('customers');await loadCustomers();})()");
  const metrics=()=>js(`(()=>{const panel=document.getElementById('customers-table-panel'),r=panel.getBoundingClientRect(),rows=[...document.querySelectorAll('#customers-table-body tr')],last=rows.at(-1).getBoundingClientRect(),footer=document.querySelector('#view-customers .list-footer').getBoundingClientRect();return{viewport:innerHeight,panelHeight:r.height,fullyVisible:rows.filter(el=>{const x=el.getBoundingClientRect();return x.top>=r.top&&x.bottom<=r.bottom}).length,scrolls:panel.scrollHeight>panel.clientHeight+1,horizontal:panel.scrollWidth>panel.clientWidth+1,footerBottom:footer.bottom,lastBottom:last.bottom,panelBottom:r.bottom,outerScroll:document.querySelector('.view-container').scrollHeight>document.querySelector('.view-container').clientHeight+1}})()`);
  const results=[];
  for(const [width,height] of [[1366,672],[1280,770],[1024,650]]){
    win.setContentSize(width,height);await settle();
    await js("document.getElementById('customers-table-panel').scrollTop=0");await settle();
    const value=await metrics();results.push({width,height,...value});
    assert(value.fullyVisible>=6,JSON.stringify(value));assert(value.scrolls);assert(!value.outerScroll);assert(!value.horizontal);assert(value.footerBottom<=height);
    await js("document.getElementById('customers-table-panel').scrollTop=100000");await settle();
    const scrolled=await metrics();assert(scrolled.lastBottom<=scrolled.panelBottom+1,'last customer should be reachable');
  }
  win.setContentSize(1366,672);await settle();
  await js("document.getElementById('customers-table-panel').scrollTop=0");win.webContents.invalidate();await settle();
  fs.writeFileSync(path.join(__dirname,'customer-directory-preview.png'),(await win.webContents.capturePage()).toPNG());
  await js("document.getElementById('customers-search-input').value='Customer 0';loadCustomers()");await settle();
  await js("document.getElementById('customers-search-input').value='Customer 01';loadCustomers()");await settle();
  assert.equal(await js("document.querySelectorAll('#customers-table-body tr').length"),1);assert(!(await metrics()).scrolls);
  await js("document.getElementById('clear-customer-filters').click()");await settle();
  assert.equal(await js("document.querySelectorAll('#customers-table-body tr').length"),26);
  await js("(async()=>{document.getElementById('customers-search-input').value='Customer 0';await loadCustomers();renderCustomersTable(state.customers.slice(0,6));document.getElementById('customers-table-panel').scrollTop=0;})()");await settle();
  assert(!(await metrics()).scrolls,'six customers should fit without scrolling');
  console.log('PASS: responsive directory, more rows visible, only overflow scrolls, sticky controls/footer, last record reachable, search/reset work',JSON.stringify(results));clearTimeout(timer);app.exit(0);
}catch(error){console.error(error);clearTimeout(timer);app.exit(1);}});
