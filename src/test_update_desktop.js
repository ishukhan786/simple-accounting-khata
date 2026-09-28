const { app, BrowserWindow, net } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('node:assert/strict');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'khata-update-test-')));
app.disableHardwareAcceleration();
app.getVersion = () => require('../package.json').version;
const originalFetch = net.fetch.bind(net);
let mode = 'offline';
net.fetch = (...args) => {
  if (mode === 'live') return originalFetch(...args);
  if (mode === 'offline') return Promise.reject(Error('socket hang up'));
  return Promise.resolve({ok:true,status:200,json:async()=>({tag_name:'v1.0.5'})});
};
const timeout = setTimeout(()=>app.exit(1),60000);
require(process.env.KHATA_TEST_PACKAGED ? '../dist/win-unpacked/resources/app.asar/main.js' : '../main');
app.whenReady().then(async()=>{
  try {
    let win;
    for(let i=0;i<100;i++) {
      win=BrowserWindow.getAllWindows()[0];
      if(win && !win.webContents.isLoading() && await win.webContents.executeJavaScript('Boolean(window.navigateTo)')) break;
      await new Promise(r=>setTimeout(r,100));
    }
    await win.webContents.executeJavaScript("navigateTo('settings')");
    await win.webContents.executeJavaScript("document.getElementById('tab-settings-security').click(); document.getElementById('btn-check-updates').scrollIntoView({block:'center'})");
    async function clickCheck() {
      await win.webContents.executeJavaScript("document.getElementById('btn-check-updates').click()");
      for(let i=0;i<250;i++) {
        await new Promise(r=>setTimeout(r,100));
        if(await win.webContents.executeJavaScript("!document.getElementById('btn-check-updates').disabled")) break;
      }
      return win.webContents.executeJavaScript("({text:document.getElementById('settings-update-status').textContent,disabled:document.getElementById('btn-check-updates').disabled,releaseButton:document.getElementById('btn-download-update').textContent})");
    }
    const offline=await clickCheck();
    assert.match(offline.text,/connection nahin/); assert.doesNotMatch(offline.text,/remote method|socket hang up|up-to-date/);
    assert.equal(offline.disabled,false); assert.equal(offline.releaseButton,'Open Releases Page');
    mode='success'; const success=await clickCheck(); assert.match(success.text,/up-to-date/);
    mode='live'; const live=await clickCheck();
    assert.equal(live.disabled,false); assert.doesNotMatch(live.text,/remote method|socket hang up/);
    console.log(JSON.stringify({passed:true,offline,success,live}));
    fs.writeFileSync(path.join(__dirname,'update-check-preview.png'),(await win.webContents.capturePage()).toPNG());
    clearTimeout(timeout); app.exit(0);
  } catch(error) {console.error(error); clearTimeout(timeout); app.exit(1);}
});
