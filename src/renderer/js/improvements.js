// Desktop tools use the same authenticated main-process bridge as accounting.
(() => {
  const api=window.api;
  const e=escapeHtml;
  const today=localToday();
  const style=document.createElement('style');
  style.textContent='.feature-card{padding:20px;margin:18px 0}.feature-card h3{margin:0 0 10px}.feature-toolbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:12px 0}.feature-toolbar label{display:grid;gap:5px;font-size:13px}.feature-toolbar input,.feature-toolbar select{min-height:36px}.feature-hint{font-size:13px;color:#64748b;line-height:1.5}.feature-result{max-height:340px;overflow:auto;margin-top:12px}.feature-result th{white-space:nowrap}.feature-warning{background:#fff7ed;border-left:4px solid #d97706;padding:12px;white-space:pre-line}.feature-good{background:#ecfdf5;padding:12px}.feature-card progress{width:100%;height:18px}.feature-card [hidden]{display:none!important}.feature-card textarea{width:100%;min-height:70px}';
  document.head.appendChild(style);
  const card=(parent,id,html,prepend=false)=>{const el=document.createElement('div');el.className='card feature-card';el.id=id;el.innerHTML=html;const p=document.querySelector(parent);if(prepend)p.prepend(el);else p.append(el);return el;};
  const bind=(id,fn)=>document.getElementById(id).addEventListener('click',async event=>{
    const btn=event.currentTarget;if(btn.disabled)return;btn.disabled=true;
    try {if(!api)throw Error('This feature is available in the Windows desktop app.');await fn();}
    catch(error){showToast(error.message.replace(/^Error invoking remote method '[^']+': Error: /,''),'error');}
    finally{btn.disabled=false;}
  });
  const form=document.querySelector('#form-new-transaction .modal-body');
  form.insertAdjacentHTML('beforeend',`<div class="form-group"><label for="trx-due-date">Due date (optional)</label><input id="trx-due-date" type="date" class="form-control"><small>Receivables without a due date appear under Undated in aging.</small></div><div class="form-group" id="trx-correction-wrap" hidden><label for="trx-correction-reason">Reason for correction</label><input id="trx-correction-reason" class="form-control" maxlength="500"><button id="btn-trx-history" type="button" class="btn btn-outline btn-sm">View correction history</button><div id="trx-history" class="feature-result"></div></div>`);
  bind('btn-trx-history',async()=>{
    const rows=await api.getTransactionHistory(state.editingTransactionId);
    document.getElementById('trx-history').innerHTML=rows.length?rows.map(r=>{
      const a=JSON.parse(r.before_json),b=JSON.parse(r.after_json);
      const fields=['transaction_date','transaction_type','amount','description','due_date','payment_method','reference_number','notes'];
      const changes=fields.filter(k=>a[k]!==b[k]).map(k=>`${k}: ${k==='amount'?formatMoney(a[k]):a[k]||'—'} → ${k==='amount'?formatMoney(b[k]):b[k]||'—'}`).join('\n');
      return `<details><summary>${e(r.created_at)} · ${e(r.user_name)} · ${e(r.action)}</summary><p>${e(r.reason)}</p><pre style="white-space:pre-wrap">${e(changes)}</pre></details>`;
    }).join(''):'No corrections recorded.';
  });
  card('#view-backup','backup-health',`<h3>Backup health</h3><p class="feature-hint">Local and Google Drive backup status in one place.</p><button id="refresh-health" class="btn btn-outline btn-sm">Refresh health</button><div id="health-summary" aria-live="polite"></div>`,true);
  async function health(){
    if(!api?.getBackupHealth || state.currentUser?.role!=='Admin')return;
    const h=await api.getBackupHealth();const time=v=>v?new Date(v).toLocaleString():'Never';
    document.getElementById('health-summary').innerHTML=`<div class="backup-status-grid"><div><small>Local backup</small><strong>${e(time(h.local.lastSuccessAt))}</strong></div><div><small>Verified Drive upload</small><strong>${e(time(h.cloud.lastSuccessAt))}</strong></div><div><small>Google account</small><strong>${e(h.cloud.accountEmail||'Not connected')}</strong></div><div><small>Pending uploads</small><strong>${h.cloud.pending}</strong></div></div><div class="${h.warnings.length?'feature-warning':'feature-good'}">${e(h.warnings.join('\n')||'Local backup and Drive upload are current.')}</div>`;
  }
  bind('refresh-health',health);
  setInterval(()=>{if(state.activeView==='backup')health().catch(()=>{});},15000);
  document.querySelector('[data-view="backup"]')?.addEventListener('click',()=>health().catch(()=>{}));
  card('#view-reports','aging-report',`<h3>Payment aging</h3><p class="feature-hint">Receivables as of the selected date. Credits settle oldest debits first (FIFO). Due today is Not due; missing due dates and opening balances are Undated. AED and PKR remain separate.</p><div class="feature-toolbar"><label>As of<input id="aging-date" type="date" value="${today}" class="form-control"></label><label>Currency<select id="aging-currency" class="form-control"><option value="">Both currencies</option><option>AED</option><option>PKR</option></select></label><button id="generate-aging" class="btn btn-primary">Generate aging report</button><button id="export-aging" class="btn btn-outline">Export CSV</button></div><div id="aging-result" class="feature-result"></div>`,true);
  bind('generate-aging',async()=>{
    const rows=await api.getAgingReport(document.getElementById('aging-date').value,document.getElementById('aging-currency').value);
    const keys=['not_due','days_1_7','days_8_30','days_31_60','days_61_90','days_90_plus','undated','total'];
    document.getElementById('aging-result').innerHTML=`<table class="data-table" id="aging-table"><thead><tr>${['Account','Customer','Currency','Not due','1–7 days','8–30 days','31–60 days','61–90 days','90+ days','Undated','Total'].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td>${e(r.account_code)}</td><td>${e(r.name)}</td><td>${r.currency}</td>${keys.map(k=>`<td>${formatMoney(r[k])}</td>`).join('')}</tr>`).join('')}${['AED','PKR'].filter(c=>rows.some(r=>r.currency===c)).map(c=>`<tr><th colspan="3">${c} total</th>${keys.map(k=>`<th>${formatMoney(rows.filter(r=>r.currency===c).reduce((n,r)=>n+r[k],0))}</th>`).join('')}</tr>`).join('')}</tbody></table>${rows.length?'':'<p>No outstanding receivables.</p>'}`;
  });
  bind('export-aging',()=>{if(!document.getElementById('aging-table'))throw Error('Generate the report first.');exportTableCsv('#aging-table','payment-aging.csv');});
  card('#view-backup','import-data',`<h3>Import Excel / CSV</h3><p class="feature-hint">First sheet, maximum 1,000 rows. Use plain values, dates YYYY-MM-DD and amounts in currency units (12.50, not cents). Import customers first, then use their app account codes for transactions. Duplicate rows are skipped; all errors must be fixed before import.</p><div class="feature-toolbar"><label>Import type<select id="import-kind" class="form-control"><option value="customers">Customers</option><option value="transactions">Transactions</option></select></label><button id="import-template" class="btn btn-outline">Download CSV template</button><button id="preview-import" class="btn btn-primary">Choose file & preview</button><button id="commit-import" class="btn btn-primary" hidden>Back up & import new rows</button></div><div id="import-summary" aria-live="polite"></div><div id="import-preview" class="feature-result"></div>`);
  let previewToken;
  bind('import-template',()=>{
    const kind=document.getElementById('import-kind').value;
    const content=kind==='customers'?'name,currency,mobile,address,opening_balance,opening_balance_type\r\n':'account_code,transaction_date,transaction_type,amount,description,due_date,reference_number\r\n';
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/csv'}));a.download=kind+'-template.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  });
  bind('preview-import',async()=>{
    previewToken=null;document.getElementById('commit-import').hidden=true;
    const p=await api.previewImport(document.getElementById('import-kind').value);if(!p)return;
    previewToken=p.token;
    document.getElementById('import-summary').textContent=`${p.ready} new rows · ${p.duplicates} duplicates skipped · ${p.errors} errors. Net balance change: ${p.totals.AED<0?'-':''}${formatMoney(p.totals.AED,'AED')} / ${p.totals.PKR<0?'-':''}${formatMoney(p.totals.PKR,'PKR')}`;
    document.getElementById('import-preview').innerHTML=`<table class="data-table"><thead><tr><th>Row</th><th>Data</th><th>Result</th></tr></thead><tbody>${p.rows.map(r=>`<tr><td>${r.row}</td><td>${e(Object.entries(r.values).map(([k,v])=>k+': '+v).join(' · '))}</td><td>${e(r.error|| (r.duplicate?'Duplicate — skipped':'Ready'))}</td></tr>`).join('')}</tbody></table>`;
    document.getElementById('commit-import').hidden=!!p.errors||!p.ready;
  });
  bind('commit-import',async()=>{const r=await api.commitImport(previewToken);previewToken=null;document.getElementById('commit-import').hidden=true;document.getElementById('import-summary').textContent=`Imported ${r.count} rows; skipped ${r.skipped} duplicates. Safety backup saved.`;await health();});
  card('#settings-tab-security-content','period-lock',`<h3>Day closing / period lock</h3><p class="feature-hint">Blocks adding, editing or deleting entries on or before the closing date. Reopening requires an Administrator and a reason. A safety backup is saved first.</p><p id="period-status">Click Refresh to check the current closing date.</p><div class="feature-toolbar"><label>Close through<input id="period-date" type="date" max="${today}" value="${today}" class="form-control"></label><label>Reason<input id="period-reason" class="form-control" maxlength="500" placeholder="Reason for closing or reopening"></label><button id="refresh-period" class="btn btn-outline">Refresh</button><button id="close-period" class="btn btn-primary">Close period</button><button id="reopen-period" class="btn btn-outline">Reopen all dates</button></div>`);
  const period=async()=>{const p=await api.getPeriodLock();document.getElementById('period-status').textContent=p.locked_through?'Closed through '+p.locked_through:'All dates are open.';};
  bind('refresh-period',period);
  card('#settings-tab-audit-content','correction-log',`<h3>Transaction correction history</h3><p class="feature-hint">Latest 200 changes, including deleted transactions. Full history for a transaction is also available in its Edit form.</p><button id="load-corrections" class="btn btn-outline">Load correction history</button><div id="all-corrections" class="feature-result"></div>`);
  bind('load-corrections',async()=>{
    const rows=await api.getTransactionHistory();
    document.getElementById('all-corrections').innerHTML=rows.length?rows.map(r=>{
      const before=JSON.parse(r.before_json),after=JSON.parse(r.after_json);
      return `<details><summary>${e(before.transaction_code||r.transaction_id)} · ${e(r.action)} · ${e(r.user_name)} · ${e(r.created_at)}</summary><p>${e(r.reason)}</p><pre style="white-space:pre-wrap">Before: ${e(JSON.stringify(before,null,2))}\nAfter: ${e(JSON.stringify(after,null,2))}</pre></details>`;
    }).join(''):'No transaction corrections recorded.';
  });
  for(const [id,close] of [['close-period',true],['reopen-period',false]])bind(id,async()=>{await api.setPeriodLock(close?document.getElementById('period-date').value:'',document.getElementById('period-reason').value);await period();showToast('Period status updated and recorded in audit history.');});
  const statementTools=document.createElement('div');statementTools.id='statement-extra-tools';statementTools.style.display='none';statementTools.innerHTML='<input id="statement-from" type="date"><input id="statement-to" type="date"><button id="filter-statement"></button><button id="save-statement-pdf"></button><button id="share-statement"></button>';
  document.body.appendChild(statementTools);
  bind('filter-statement',()=>openCustomerStatementModal(state.statementCustomerId,document.getElementById('statement-from')?.value,document.getElementById('statement-to')?.value));
  bind('save-statement-pdf',async()=>{const r=await api.exportStatementPdf(state.statementCustomerId,state.statementFrom,state.statementTo);if(r)showToast('Statement PDF saved: '+r.path);});
  bind('share-statement',()=>api.openStatementWhatsApp(state.statementCustomerId));
  card('#settings-tab-security-content','update-installer',`<h3>Download & install updates</h3><p class="feature-hint">Review release notes using Check for Updates above. Downloads require internet. Installation saves a local backup and closes the app. Portable copies use the releases page.</p><div class="feature-toolbar"><button id="download-installer" class="btn btn-primary">Download available update</button><button id="install-update" class="btn btn-outline" hidden>Back up & install update</button></div><progress id="update-download-progress" max="100" value="0"></progress><p id="update-download-message" aria-live="polite">No download running.</p>`);
  const updateProgress=p=>{document.getElementById('update-download-message').textContent=p.message;document.getElementById('update-download-progress').value=p.percent||0;document.getElementById('install-update').hidden=p.phase!=='ready';document.getElementById('download-installer').disabled=['checking','downloading','installing'].includes(p.phase);};
  api?.onUpdateProgress?.(updateProgress);
  bind('download-installer',async()=>updateProgress(await api.downloadAppUpdate()));
  bind('install-update',async()=>{if(!allowLeaveForms())return;await api.installAppUpdate();});
})();
