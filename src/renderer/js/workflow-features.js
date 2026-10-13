// Everyday khata tools.
function workflowApi(name, payload = {}) {
  if (window.api) return window.api[name](...({getMonthlySummary:[payload.month],getDeletedTransactions:[],restoreDeletedTransaction:[payload.id,payload.reason,state.currentUser]}[name]));
  const endpoint = name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
  return khataApi.call(endpoint, payload);
}
async function loadMonthlySummary() {
  const selectedMonth = document.getElementById('monthly-month').value;
  document.getElementById('monthly-results').replaceChildren();
  try {
    const result = await workflowApi('getMonthlySummary', {month:selectedMonth});
    if (document.getElementById('monthly-month').value !== selectedMonth) return;
    document.getElementById('monthly-results').dataset.month = selectedMonth;
    const money = n => (n/100).toLocaleString('en-US', {maximumFractionDigits:2});
    document.getElementById('monthly-results').innerHTML = `<table class="data-table"><thead><tr><th>Currency</th><th>Opening</th><th>Debit (Banam)</th><th>Credit (Jama)</th><th>Closing</th><th>Entries</th></tr></thead><tbody>${result.totals.map(r => `<tr><td>${r.currency}</td><td>${money(r.opening)}</td><td>${money(r.debit)}</td><td>${money(r.credit)}</td><td>${money(r.closing)}</td><td>${r.count}</td></tr>`).join('')}</tbody></table>`;
  } catch(e) { showToast(e.message, 'error'); }
}
async function loadDeletedEntries() {
  if (state.currentUser?.role !== 'Admin') return;
  try {
    const rows = await workflowApi('getDeletedTransactions');
    document.getElementById('deleted-results').innerHTML = rows.length ? `<table class="data-table"><thead><tr><th>Entry / Date</th><th>Customer</th><th>Details</th><th>Amount</th><th>Action</th></tr></thead><tbody>${rows.map(r => `<tr><td>${escapeHtml(r.transaction.transaction_code)}<br>${escapeHtml(r.transaction.transaction_date)}</td><td>${escapeHtml(r.customer_name)}</td><td>${escapeHtml(r.transaction.description)}<br><small>Deleted by ${escapeHtml(r.deleted_by)}</small></td><td>${formatMoney(r.transaction.amount,r.currency)}</td><td><button type="button" class="btn btn-primary btn-sm" onclick="restoreEntry(${r.id})">Restore</button></td></tr>`).join('')}</tbody></table>` : '<p>No deleted entries to restore.</p>';
  } catch(e) { showToast(e.message,'error'); }
}
function restoreEntry(id) {
  const reason = document.getElementById('restore-reason').value.trim();
  if (!reason) { showToast('Restore ki wajah likhein.','error'); document.getElementById('restore-reason').focus(); return; }
  openConfirmDialog('Restore entry', 'This entry will return to its original customer khata and affect its balance.', async () => {
    try { await workflowApi('restoreDeletedTransaction',{id,reason}); showToast('Entry restored.'); await loadDeletedEntries(); await loadTransactions(); }
    catch(e) { showToast(e.message,'error'); }
  });
}
function initWorkflowFeatures() {
  const options = ['Customer','Party','Bank','Cash'].map(t=>`<option>${t}</option>`).join('');
  for (const [form,id] of [['form-new-customer','customer-new-tag'],['form-edit-customer','customer-edit-tag']]) {
    const body = document.querySelector(`#${form} .modal-body`);
    body.insertAdjacentHTML('beforeend',`<div class="form-group"><label for="${id}">Account Tag</label><select class="form-control" id="${id}">${options}</select></div>`);
    if (form === 'form-new-customer') {
      const nameGroup = document.getElementById('cust-new-name').closest('.form-group');
      const row = document.createElement('div');
      row.className = 'form-row customer-name-tag-row';
      nameGroup.before(row);
      row.append(nameGroup, document.getElementById(id).closest('.form-group'));
    }

  }
  const search = document.getElementById('customers-search-input');
  search.placeholder = 'Name, mobile or account code';
  const filter = document.createElement('div'); filter.className = 'feature-toolbar customer-workflow-filters';
  filter.innerHTML = `<label>Tag<select id="customer-tag-filter" class="form-control"><option value="">All tags</option>${options}</select></label><label>Sort<select id="customer-sort" class="form-control"><option value="code">Account code</option><option value="name">Name A–Z</option><option value="receivable">Highest receivable first</option><option value="payable">Highest payable first</option></select></label><small>Balance sorting uses each account's currency. Use the currency filter to compare amounts.</small><label>Currency<select id="customer-currency-filter" class="form-control"><option value="">All</option><option>AED</option><option>PKR</option></select></label>`;
  document.querySelector('#view-customers .card-header').after(filter);
  document.getElementById('customer-sort').title = "Balance sorting uses each account's currency. Use the currency filter to compare amounts.";
  for (const id of ['customer-tag-filter','customer-sort','customer-currency-filter']) document.getElementById(id).addEventListener('change',()=>loadCustomers());
  const next = document.createElement('button'); next.id='btn-save-next';next.type='button';next.className='btn btn-outline';next.textContent='Save & Next';next.addEventListener('click',()=>{if(document.getElementById('form-new-transaction').reportValidity())handleSaveTransaction(true);});
  document.querySelector('#form-new-transaction .modal-footer').prepend(next);
  const report = document.createElement('div'); report.className='card feature-card';
  report.innerHTML=`<h3>Monthly Summary</h3><p class="feature-hint">Net balances across all khate. AED and PKR are calculated separately; this is a ledger summary.</p><div class="feature-toolbar"><label>Month<input id="monthly-month" type="month" class="form-control" value="${localToday().slice(0,7)}"></label><button id="monthly-load" type="button" class="btn btn-primary">Show Summary</button><button id="monthly-csv" type="button" class="btn btn-outline">Export CSV</button></div><div id="monthly-results" class="table-responsive"></div>`;
  document.getElementById('view-reports').append(report);
  document.getElementById('monthly-load').onclick=loadMonthlySummary;
  document.getElementById('monthly-month').addEventListener('change',()=>document.getElementById('monthly-results').replaceChildren());
  document.getElementById('monthly-csv').onclick=async()=>{const button=document.getElementById('monthly-csv');if(button.disabled)return;button.disabled=true;try{await loadMonthlySummary();if(document.querySelector('#monthly-results table'))exportTableCsv('#monthly-results table',`monthly-${document.getElementById('monthly-results').dataset.month}.csv`);}finally{button.disabled=false;}};
  const deleted = document.createElement('div'); deleted.id='deleted-entry-tools';deleted.className='card feature-card';deleted.hidden=true;
  deleted.innerHTML='<h3>Deleted Entry Recovery (Admin)</h3><p class="feature-hint">Restore deleted transactions to their original khata. The original customer must still exist and the date must be open.</p><div class="feature-toolbar"><label>Reason for restoring<input id="restore-reason" class="form-control" maxlength="500"></label><button id="deleted-load" type="button" class="btn btn-outline">View Deleted Entries</button></div><div id="deleted-results" class="feature-result"></div>';
  document.getElementById('view-backup').append(deleted);document.getElementById('deleted-load').onclick=loadDeletedEntries;
  const navigate=navigateTo;
  navigateTo=function(view){navigate(view);deleted.hidden=state.currentUser?.role!=='Admin';};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initWorkflowFeatures);else initWorkflowFeatures();
