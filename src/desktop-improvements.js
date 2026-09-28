const fs=require('fs'),path=require('path');
const ImportData=require('./db/import-data');
const statement=require('./statement');

module.exports=function register({handle,db,backupManager,driveBackup,getWindow,app,BrowserWindow,dialog,shell,createUpdater=()=>require('electron-updater').autoUpdater}) {
  const importer=new ImportData(db,backupManager);
  handle('getAgingReport',(_,date,currency)=>db.getAgingReport(date,currency));
  handle('getPeriodLock',()=>db.getPeriodLock());
  handle('setPeriodLock',(_,date,reason,user)=>{backupManager.createBackup(null,user);return db.setPeriodLock(date,reason,user);});
  handle('getTransactionHistory',(_,id)=>db.getTransactionHistory(id));
  handle('getBackupHealth',()=>{
    const local=backupManager.getStatus(),cloud=driveBackup.status();
    const warnings=[];
    if(!local.lastSuccessAt)warnings.push('No local backup yet.');
    if(local.overdue)warnings.push('Local backup is overdue.');
    if(local.lastError)warnings.push('Local backup: '+local.lastError);
    if(!cloud.connected)warnings.push('Google Drive is not connected.');
    else {
      if(cloud.needsReconnect)warnings.push('Reconnect your Google account.');
      if(!cloud.lastSuccessAt)warnings.push('No verified Drive upload yet.');
      else if(local.lastSuccessAt && cloud.lastSuccessAt < local.lastSuccessAt)warnings.push('Latest local backup has not been verified in Drive yet.');
      if(cloud.pending)warnings.push(`${cloud.pending} uploads pending.`);
      if(cloud.lastError)warnings.push('Drive: '+cloud.lastError);
    }
    return {local,cloud,warnings};
  });
  handle('previewImport',async(_,kind)=>{
    const result=await dialog.showOpenDialog(getWindow(),{title:'Preview customer or transaction import',properties:['openFile'],filters:[{name:'Excel / CSV',extensions:['xlsx','csv']}]});
    if(result.canceled)return null; return importer.read(result.filePaths[0],kind);
  });
  handle('commitImport',(_,token,user)=>importer.commit(token,user));
  handle('exportStatementPdf',async(_,id,from,to)=>{
    const result=statement(db,id,from,to);
    const chosen=await dialog.showSaveDialog(getWindow(),{title:'Save customer statement PDF',defaultPath:`Statement-${String(result.customer.account_code).replace(/[^a-z0-9_-]/gi,'')}.pdf`,filters:[{name:'PDF',extensions:['pdf']}]});
    if(chosen.canceled)return null;
    const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try {
      await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(result.html));
      const bytes=await win.webContents.printToPDF({pageSize:'A4',printBackground:true});
      fs.writeFileSync(chosen.filePath,bytes); return {path:chosen.filePath};
    } finally {win.destroy();}
  });
  handle('openStatementWhatsApp',async(_,id)=>{
    const c=db.getCustomerById(id); if(!c)throw Error('Customer not found.');
    const number=String(c.mobile||'').replace(/[\s()+-]/g,'');
    if(!/^[1-9]\d{7,14}$/.test(number))throw Error('Set the customer mobile with country code first (for example 971…).');
    await shell.openExternal('https://wa.me/'+number+'?text='+encodeURIComponent('Hello, please find your account statement attached.'));
    return true;
  });
  let updater,downloadPromise,ready=false;
  let updateState={phase:'idle',percent:0,message:'Check for updates, then download when ready.'};
  const emit=patch=>{updateState={...updateState,...patch};const win=getWindow();if(win&&!win.isDestroyed())win.webContents.send('update-progress',updateState);};
  const getUpdater=()=>{
    if(!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE)throw Error('In-app installation is available in the installed Windows app. Use the releases page for portable or development builds.');
    if(!updater) {
      updater=createUpdater();
      updater.autoDownload=false; updater.autoInstallOnAppQuit=false;
      updater.on('download-progress',p=>emit({phase:'downloading',percent:Math.round(p.percent),message:'Downloading update…'}));
      updater.on('update-downloaded',()=>{ready=true;emit({phase:'ready',percent:100,message:'Update downloaded. Install creates a backup before closing the app.'});});
      updater.on('error',()=>emit({phase:'error',message:'Update download failed. Retry or use the releases page.'}));
    }
    return updater;
  };
  handle('getUpdateProgress',()=>updateState);
  handle('downloadAppUpdate',async()=>{
    if(downloadPromise)return downloadPromise;
    downloadPromise=(async()=>{
      try {
        const u=getUpdater(); emit({phase:'checking',message:'Checking installer availability…'});
        const result=await u.checkForUpdates();
        if(!result || !result.isUpdateAvailable) {emit({phase:'idle',message:'No newer installer available.'});return updateState;}
        await u.downloadUpdate(); return updateState;
      } catch(error) {emit({phase:'error',message: app.isPackaged?'Could not download the update. Check internet or open the releases page.':error.message});return updateState;}
      finally {downloadPromise=null;}
    })();return downloadPromise;
  });
  handle('installAppUpdate',(_,user)=>{
    if(!ready)throw Error('Download an update first.');
    const backup=backupManager.createBackup(null,user); // A failure must prevent shutdown.
    db.saveToDisk();
    emit({phase:'installing',message:'Backup saved. Closing Simple Khata to install…'});
    setTimeout(()=>updater.quitAndInstall(false,true),500);
    return {backup:backup.filename};
  });
};
