const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-desktop-'));
app.setPath('userData', directory);
app.disableHardwareAcceleration();
const timeout = setTimeout(() => { console.error('Desktop test timed out'); app.exit(1); }, 45000);
require(process.env.KHATA_TEST_PACKAGED ? '../dist/win-unpacked/resources/app.asar/main.js' : '../main');
app.whenReady().then(async () => {
  try {
    let win;
    for (let i = 0; i < 100; i++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript('Boolean(window.api && window.navigateTo)')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const result = await win.webContents.executeJavaScript(`(async () => {
      const check = (ok, message) => { if (!ok) throw Error(message); };
      const rejects = async (fn, message) => { let rejected = false; try { await fn(); } catch { rejected = true; } check(rejected, message); };
      const admin = await api.getSession(); check(admin.role === 'Admin', 'Single user session missing');
      check((await api.getDriveStatus()).configured, 'Bundled Desktop Google client missing');
      const customer = await api.createCustomer({ name: 'Desktop test', currency: 'AED' });
      await api.createTransaction({ customer_id: customer.id, transaction_type: 'Credit', amount: 12345, transaction_date: '2026-09-26' });
      await api.createUser('Staff', 'staff', 'staff-password', 'Staff');
      await api.updateSettings({ require_login: '1' });
      await api.logout();
      await rejects(() => api.getCustomers(), 'Logged out read accepted');
      await rejects(() => api.updateSettings({ require_login: '0' }, admin), 'Forged admin accepted');
      await api.authenticate('staff', 'staff-password');
      check((await api.getCustomers()).length === 1, 'Staff read failed');
      await rejects(() => api.deleteCustomer(customer.id, admin), 'Staff deleted customer');
      await rejects(() => api.createUser('Intruder', 'intruder', 'password', 'Admin', admin), 'Staff created admin');
      await rejects(() => api.getUsers(), 'Staff read users');
      await rejects(() => api.switchDriveAccount(admin), 'Staff switched Google account');
      const transaction = await api.createTransaction({ customer_id: customer.id, transaction_type: 'Debit', amount: 100, transaction_date: '2026-09-26' }, admin);
      check(transaction.transaction.created_by === 'Staff', 'Audit identity was forged');
      await api.authenticate('admin', 'admin123');
      const backup = await api.createBackup();
      const backups = await api.getBackups();
      await api.restoreBackup(backups.find(item => item.filename === backup.filename).filepath);
      check(await api.getSession() === null, 'Restore kept session');
      await rejects(() => api.getCustomers(), 'Restored data exposed before login');
      await api.authenticate('admin', 'admin123');
      return { passed: true, checks: 'Real IPC authentication, staff permissions, audit identity, restore session reset' };
    })()`);
    console.log(JSON.stringify(result)); clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});
