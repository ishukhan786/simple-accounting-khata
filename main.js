const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Notification, net } = require('electron');
const path = require('path');
const DatabaseManager = require('./src/db/database');
const BackupManager = require('./src/db/backup');
const GoogleDriveBackup = require('./src/db/google-drive');
const fs = require('fs');
const { pathToFileURL } = require('url');
const SessionGuard = require('./src/session-guard');
const { createUpdateChecker } = require('./src/update-check');
const checkGitHubRelease = createUpdateChecker({ fetch: (...args) => net.fetch(...args), getVersion: () => app.getVersion() });

if (process.platform === 'win32') {
  app.setAppUserModelId('com.simplekhata.desktop');
}
let driveBackup;

let mainWindow = null;
let db = null;
let backupManager = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: 'Simple Khata - Offline Desktop Accounting',
    icon: fs.existsSync(path.join(__dirname, 'src', 'renderer', 'assets', 'icon.ico'))
      ? path.join(__dirname, 'src', 'renderer', 'assets', 'icon.ico')
      : path.join(__dirname, 'src', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false
    },
    backgroundColor: '#f8fafc',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  mainWindow.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question', buttons: ['Keep editing', 'Discard changes'], defaultId: 0, cancelId: 0,
      title: 'Unsaved changes', message: 'You have unsaved changes.', detail: 'Discard them and leave this screen?'
    });
    if (choice === 1) event.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showNativeNotification(title, body, onClickUrl) {
  try {
    if (Notification.isSupported()) {
      const iconPath = path.join(__dirname, 'src', 'renderer', 'assets', 'icon.png');
      const notif = new Notification({
        title: title || 'Simple Khata',
        body: body || '',
        icon: fs.existsSync(iconPath) ? iconPath : undefined
      });
      if (onClickUrl) {
        notif.on('click', () => {
          shell.openExternal(onClickUrl);
        });
      }
      notif.show();
    }
  } catch (err) {
    console.error('Desktop notification error:', err.message);
  }
}

function startAutoUpdateCheck() {
  // Check after 3 seconds so the window is ready
  setTimeout(async () => {
    try {
      const info = await checkGitHubRelease();
      if (info && info.isNewer) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-available', info);
        }
        showNativeNotification(
          'Simple Khata - Naya Update Dastyab Hai! 🚀',
          `Naya version v${info.latestVersion} release ho chuka hai. Download karne ke liye click karein.`,
          info.releaseUrl
        );
      }
    } catch (err) {
      console.log('Background update check:', err.message);
    }
  }, 3000);
}

function registerIpcHandlers() {
  const guard = new SessionGuard(db);
  const trustedUrl = pathToFileURL(path.join(__dirname, 'src', 'renderer', 'index.html')).href;
  const handle = (name, callback) => ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== trustedUrl) throw new Error('Untrusted application request.');
    return guard.invoke(name, event.sender.id, args, trusted => callback(event, ...trusted));
  });
  handle('getSession', () => {});
  handle('logout', () => {});
  require('./src/desktop-improvements')({handle,db,backupManager,driveBackup,getWindow:()=>mainWindow,app,BrowserWindow,dialog,shell});
  const requireAdmin = user => { if (user?.role !== 'Admin') throw new Error('Only an Administrator can manage Google Drive backups.'); };
  handle('getDriveStatus', () => driveBackup.status());
  handle('importDriveCredentials', async (e, user) => {
    requireAdmin(user);
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import Google Desktop OAuth credentials', filters: [{ name: 'Google credentials', extensions: ['json'] }], properties: ['openFile'] });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if (fs.statSync(file).size > 65536) throw new Error('The selected credentials file is too large.');
    return driveBackup.configure(JSON.parse(fs.readFileSync(file, 'utf8')));
  });
  handle('openDriveSetup', async () => shell.openExternal('https://console.cloud.google.com/apis/library/drive.googleapis.com'));
  handle('openReleasePage', async () => shell.openExternal('https://github.com/ishukhan786/simple-accounting-khata/releases/latest'));
  handle('connectDrive', async (e, user) => { requireAdmin(user); return driveBackup.connect(); });
  handle('switchDriveAccount', async (e, user) => { requireAdmin(user); return driveBackup.switchAccount(); });
  handle('disconnectDrive', async (e, user) => { requireAdmin(user); return driveBackup.disconnect(); });
  handle('backupToDrive', async (e, user) => { requireAdmin(user); return driveBackup.backupNow(user); });
  handle('listDriveBackups', async (e, user) => { requireAdmin(user); return driveBackup.list(); });
  handle('restoreDriveBackup', async (e, id, user) => { requireAdmin(user); return driveBackup.restore(id, user); });
  handle('getTransactionById', (e, id) => db.getTransactionById(id));
  handle('getBackupStatus', () => backupManager.getStatus());
  handle('changePassword', (e, currentPassword, newPassword, user) => db.changePassword(currentPassword, newPassword, user));
  handle('getDashboardData', async () => db.getDashboardData());
  handle('getCustomers', async (e, search, includeArchived) => db.getCustomers(search, includeArchived));
  handle('getCustomerById', async (e, id) => db.getCustomerById(id));
  handle('peekNextAccountCode', async () => db.peekNextAccountCode());
  handle('createCustomer', async (e, data, user) => db.createCustomer(data, user));
  handle('updateCustomer', async (e, id, data, user) => db.updateCustomer(id, data, user));
  handle('archiveCustomer', async (e, id, user) => db.archiveCustomer(id, user));
  handle('deleteCustomer', async (e, id, user) => db.deleteCustomer(id, user));
  handle('getCustomerLedger', async (e, id, sort, from, to) => db.getCustomerLedger(id, sort, from, to));
  handle('createTransaction', async (e, data, user) => db.createTransaction(data, user));
  handle('updateTransaction', async (e, id, data, user) => db.updateTransaction(id, data, user));
  handle('deleteTransaction', async (e, id, user) => db.deleteTransaction(id, user));
  handle('getAllTransactions', async (e, filters) => db.getAllTransactions(filters));
  handle('getReceipt', async (e, trxId) => db.getReceiptByTransactionId(trxId));
  handle('getCustomerNotes', async (e, custId) => db.getCustomerNotes(custId));
  handle('addCustomerNote', async (e, custId, note, user) => db.addCustomerNote(custId, note, user));
  handle('getSettings', async () => db.getSettings());
  handle('updateSettings', async (e, data, user) => db.updateSettings(data, user));
  handle('getBackups', async () => backupManager.getBackupList());
  handle('createBackup', async (e, user) => backupManager.createBackup(null, user));
  handle('restoreBackup', async (e, filepath, user) => backupManager.restoreBackup(filepath, user));
  handle('pickRestoreFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Backup Database File',
      filters: [
        { name: 'Database Files', extensions: ['db', 'sqlite'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (canceled) return null;
    return filePaths[0];
  });
  handle('pickBackupDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Auto Cloud Backup Directory',
      properties: ['openDirectory']
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });
  handle('getUsers', async () => db.getUsers());
  handle('createUser', async (e, name, username, password, role, user) => db.createUser(name, username, password, role, user));
  handle('deleteUser', async (e, id, user) => db.deleteUser(id, user));
  handle('getAuditLogs', async (e, limit) => db.getAuditLogs(limit));
  handle('getCustomerBalanceReport', async (e, currency) => db.getCustomerBalanceReport(currency));
  handle('getReceivableReport', async (e, currency) => db.getReceivableReport(currency));
  handle('getPayableReport', async (e, currency) => db.getPayableReport(currency));
  handle('authenticate', async (e, username, password) => db.authenticate(username, password));
  handle('checkAppUpdate', async () => checkGitHubRelease());
  handle('getAppVersion', async () => app.getVersion());
  handle('showNativeNotification', async (e, title, body, url) => {
    showNativeNotification(title, body, url);
    return true;
  });
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  const localDataDb = path.join(userDataPath, 'data', 'khata.db');
  
  db = new DatabaseManager(localDataDb);
  await db.init();

  const backupsDir = path.join(userDataPath, 'backups');
  backupManager = new BackupManager(db, backupsDir);

  driveBackup = new GoogleDriveBackup({ directory: path.join(userDataPath, 'google-drive'), backupManager, safeStorage, defaultClient: require('./src/google-oauth.json'), openExternal: url => shell.openExternal(url) });
  backupManager.onBackupCreated = backup => {
    try { driveBackup.enqueue(backup); }
    catch (error) { driveBackup.lastError = 'Local backup saved, but could not queue Drive upload: ' + error.message; }
  };
  driveBackup.start();

  // Run scheduled auto-backup check on startup
  try { backupManager.checkAutoBackup(); }
  catch (err) { dialog.showErrorBox('Automatic backup failed', err.message); }
  backupManager.startScheduler();

  registerIpcHandlers();
  await createWindow();
  startAutoUpdateCheck();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch(err => {
  db = null;
  dialog.showErrorBox('Could not open Simple Khata', err.message);
  app.quit();
});

app.on('window-all-closed', () => {
  if (db) db.saveToDisk();
  if (process.platform !== 'darwin') app.quit();
});
