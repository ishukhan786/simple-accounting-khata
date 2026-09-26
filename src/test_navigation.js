const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-navigation-'));
app.setPath('userData', path.join(testDir, 'profile'));
app.disableHardwareAcceleration();
const DB = require('./db/database');
const Backup = require('./db/backup');
const resultFile = path.join(__dirname, 'test_navigation_result.json');
const result = { errors: [], clicks: [] };
setTimeout(() => { result.errors.push('Timed out'); fs.writeFileSync(resultFile, JSON.stringify(result)); app.exit(1); }, 20000);
app.whenReady().then(async () => {
  try {
    const db = new DB(path.join(testDir, 'khata.db'));
    db.saveToDisk = () => {};
    await db.init();
    for (let i = 0; i < 45; i++) {
      const customer = db.createCustomer({ name: 'Test customer ' + i, currency: i % 2 ? 'PKR' : 'AED', mobile: '0501234567' });
      db.createTransaction({ customer_id: customer.id, transaction_type: 'Debit', amount: 12500, transaction_date: '2026-09-26' });
    }
    const backups = new Backup(db, path.join(testDir, 'backups'));
    ipcMain.handle('getSession', () => db.getUsers()[0]);
    ipcMain.handle('getBackupStatus', () => backups.getStatus());
    for (const name of ['getSettings', 'getDashboardData', 'getCustomers', 'getAllTransactions', 'getCustomerBalanceReport']) ipcMain.handle(name, (_, ...args) => db[name](...args));
    const win = new BrowserWindow({ show: false, width: 1280, height: 820, webPreferences: { preload: path.join(__dirname, '../preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: Boolean(process.env.KHATA_CAPTURE_UI) } });
    win.webContents.on('console-message', (_, level, message) => { if(level >= 3) result.errors.push(message); });
    await win.loadFile(path.join(__dirname, 'renderer/index.html'));
    await new Promise(resolve => setTimeout(resolve, 600));
    for (const view of ['customers', 'transactions', 'reports']) {
      const point = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector('[data-view="${view}"]').getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; })()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await new Promise(r => setTimeout(r, 150));
      const observed = await win.webContents.executeJavaScript(`({ active: document.querySelector('.view-section.active-view')?.id, title: document.getElementById('page-title').textContent, navType: typeof window.navigateTo, toast: document.getElementById('toast-container').textContent })`);
      result.clicks.push({ view, ...observed });
      if (process.env.KHATA_CAPTURE_UI && view === 'transactions') {
        await win.webContents.executeJavaScript("document.querySelectorAll('.view-section').forEach(el => el.style.animation = 'none')");
        win.webContents.invalidate();
        await new Promise(resolve => setTimeout(resolve, 200));
        fs.writeFileSync(path.join(__dirname, 'transactions-preview.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
      }
      if (observed.active !== 'view-' + view) result.errors.push('Navigation failed: ' + view);
      if (view !== 'reports') {
        for (const size of [[1280, 820], [1024, 700]]) {
          win.setSize(...size);
          await new Promise(resolve => setTimeout(resolve, 250));
          const layout = await win.webContents.executeJavaScript(`(() => {
            const container = document.querySelector('.view-container');
            const panel = document.querySelector('#view-${view} .fixed-table-panel');
            const footer = document.querySelector('#view-${view} .list-footer').getBoundingClientRect();
            return { outerOverflow: container.scrollHeight - container.clientHeight, innerScroll: panel.scrollHeight > panel.clientHeight, footerBottom: footer.bottom, height: innerHeight };
          })()`);
          if (layout.outerOverflow > 2 || !layout.innerScroll || layout.footerBottom > layout.height) result.errors.push('List layout failed: ' + view + ' ' + size + ' ' + JSON.stringify(layout));
        }
        win.setSize(1280, 820);
      }
    }
    fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
    app.exit(result.errors.length ? 1 : 0);
  } catch (e) { result.errors.push(e.stack); fs.writeFileSync(resultFile, JSON.stringify(result)); app.exit(1); }
});
