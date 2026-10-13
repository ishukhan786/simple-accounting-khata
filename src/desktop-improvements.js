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
      const bytes=await win.webContents.printToPDF({pageSize:'A4',printBackground:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:9px;width:100%;text-align:center;color:#64748b">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',margins:{top:0.4,bottom:0.6,left:0.4,right:0.4}});
      fs.writeFileSync(chosen.filePath,bytes); return {path:chosen.filePath};
    } finally {win.destroy();}
  });
  handle('exportStatementPng',async(_,id,from,to)=>{
    const result=statement(db,id,from,to);
    const chosen=await dialog.showSaveDialog(getWindow(),{title:'Save statement PNG pages — choose name and location',defaultPath:`Statement-${String(result.customer.account_code).replace(/[^a-z0-9_-]/gi,'')}.png`,filters:[{name:'PNG image',extensions:['png']}]});
    if(chosen.canceled)return null;
    const win=new BrowserWindow({show:false,width:1000,height:1000,useContentSize:true,backgroundColor:'#ffffff',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try {
      await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(result.html));
      await win.webContents.insertCSS('html,body{margin:0!important;padding:0!important;width:1000px!important;height:auto!important;overflow:hidden!important;background:white!important}#statement-paper{box-sizing:border-box!important;margin:0!important;padding:32px!important;width:1000px!important;max-width:none!important;border:0!important;box-shadow:none!important}');
      const count=await win.webContents.executeJavaScript(`(async()=>{
        await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));
        const paper=document.getElementById('statement-paper'),body=paper.querySelector('tbody');
        const rows=[...body.children];window.pngPages=[];body.replaceChildren();let page=[];
        for(const row of rows){
          body.append(row);
          if(page.length&&(page.length>=25||paper.getBoundingClientRect().height>1340)){
            row.remove();window.pngPages.push(page);body.replaceChildren(row);page=[];
          }
          page.push(row);
        }
        window.pngPages.push(page);
        const footer=document.createElement('div');footer.id='png-page-number';footer.style.cssText='text-align:center;color:#64748b;font-size:12px;margin-top:20px';paper.append(footer);
        return window.pngPages.length;
      })()`);
      const stem=path.basename(chosen.filePath,path.extname(chosen.filePath));
      const directory=fs.mkdtempSync(path.join(path.dirname(chosen.filePath),stem+'-pages-'));
      const paths=[];
      try {
      for(let index=0;index<count;index++){
        const height=await win.webContents.executeJavaScript(`(()=>{
          const paper=document.getElementById('statement-paper');paper.querySelector('tbody').replaceChildren(...window.pngPages[${index}]);
          document.getElementById('png-page-number').textContent='Page ${index+1} of ${count}';
          return Math.max(1414,Math.ceil(paper.getBoundingClientRect().height));
        })()`);
        if(height>30000)throw Error('One statement entry is too long for PNG. Save as PDF instead.');
        win.setContentSize(1000,height);
        await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const image=await win.webContents.capturePage({x:0,y:0,width:1000,height},{stayHidden:true});
        if(image.isEmpty())throw Error('Could not render the statement image. Please retry.');
        const filename=path.join(directory,`${stem}-${String(index+1).padStart(2,'0')}.png`);
        fs.writeFileSync(filename,image.toPNG());paths.push(filename);
      }
      } catch(error) {fs.rmSync(directory,{recursive:true,force:true});throw error;}
      return {path:directory,paths,pageCount:count};
    } finally {win.destroy();}
  });
  handle('openStatementWhatsApp',async(_,id,from='',to='')=>{
    const c=db.getCustomerById(id); if(!c)throw Error('Customer not found.');
    const number=String(c.mobile||'').replace(/[\s()+-]/g,'');
    if(!/^[1-9]\d{7,14}$/.test(number))throw Error('Set the customer mobile with country code first (for example 971…).');
    if(from)db.validateDate(from);if(to)db.validateDate(to);
    if(from&&to&&from>to)throw Error('Invalid statement date range.');
    await shell.openExternal('https://wa.me/'+number+'?text='+encodeURIComponent(`Hello ${c.name}, your ${c.currency} account statement (${from||'Start'} to ${to||'Latest'}) is ready. I will attach the PDF here.`));
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
