const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const tempRoot=process.platform==='win32' ? path.join(process.env.USERPROFILE,'AppData','Local','Temp') : os.tmpdir();
const directory=fs.mkdtempSync(path.join(tempRoot,'khata-delete-ui-'));
app.setPath('userData',directory);app.disableHardwareAcceleration();
const timeout=setTimeout(()=>{console.error('Backup deletion UI timed out');app.exit(1);},40000);
require(process.env.KHATA_TEST_PACKAGED ? '../dist/win-unpacked/resources/app.asar/main.js' : '../main');
app.whenReady().then(async()=>{
  try {
    let win;
    for(let i=0;i<100;i++){
      win=BrowserWindow.getAllWindows()[0];
      if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript('Boolean(window.api && window.handleDeleteBackup)'))break;
      await new Promise(r=>setTimeout(r,100));
    }
    const js=s=>win.webContents.executeJavaScript(s);
    const click=async selector=>{
      const point=await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
      await new Promise(r=>setTimeout(r,300));
    };
    await js("(async()=>{await api.createCustomer({name:'Keep live data',currency:'AED'});await api.createBackup();await api.createBackup();navigateTo('backup');await loadBackups();})()");
    const count=await js('(async()=> (await api.getBackups()).length)()');
    assert(count>=2);
    await click('[data-delete-backup]');
    assert.equal(await js('(async()=> (await api.getBackups()).length)()'),count,'opening confirmation must not delete');
    await click('#modal-confirm [data-close-modal="modal-confirm"]');
    assert.equal(await js('(async()=> (await api.getBackups()).length)()'),count,'cancel must preserve backup');
    const filename=await js("document.querySelector('[data-delete-backup]').dataset.deleteBackup");
    await click('[data-delete-backup]');await click('#btn-confirm-action-submit');
    for(let i=0;i<50&&await js('(async()=> (await api.getBackups()).length)()')===count;i++)await new Promise(r=>setTimeout(r,100));
    assert.equal(await js('(async()=> (await api.getBackups()).length)()'),count-1);
    assert.equal(await js(`Boolean([...document.querySelectorAll('[data-delete-backup]')].find(b=>b.dataset.deleteBackup===${JSON.stringify(filename)}))`),false);
    assert.equal(await js('(async()=> (await api.getCustomers()).length)()'),1);
    await js("(async()=>{await api.createUser('Staff','staff','staff-password','Staff');await api.authenticate('staff','staff-password');})()");
    assert.equal(await js(`(async()=>{try{await api.deleteBackup(${JSON.stringify(filename)});return false;}catch(e){return /Administrator/.test(e.message);}})()`),true);
    console.log('PASS: native Delete click, cancel preserves file, confirm deletes and refreshes list, live data preserved, Staff IPC rejected');
    clearTimeout(timeout);app.exit(0);
  }catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}
});
