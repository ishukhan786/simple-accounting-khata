// Everyday workflow improvements for lists and forms.
function initUxEnhancements() {
 const get=id=>document.getElementById(id);
 const clear=document.createElement('button');clear.id='clear-customer-filters';clear.type='button';clear.className='btn btn-outline btn-sm';clear.textContent='Reset filters';
 document.querySelector('.customer-workflow-filters').append(clear);
 clear.onclick=()=>{for(const id of ['customers-search-input','customer-tag-filter','customer-currency-filter'])get(id).value='';get('customer-sort').value='code';loadCustomers();get('customers-search-input').focus();};
 get('btn-clear-trx-filters').textContent='Reset filters';
 const counts=[['customers','customers-search-input','customer-tag-filter','customer-currency-filter'],['transactions','global-search-input','filter-trx-customer','filter-trx-payment','filter-trx-min','filter-trx-max','filter-trx-currency','filter-trx-type','filter-trx-date-from','filter-trx-date-to']];
 for(const [view,...ids] of counts){const status=document.createElement('span');status.className='filter-status';status.setAttribute('aria-live','polite');get(view+'-page-info').after(status);const refresh=()=>{const n=ids.filter(id=>get(id)?.value.trim()).length;status.textContent=n?`${n} active filter${n===1?'':'s'}`:'All records';};for(const id of ids)get(id)?.addEventListener('input',refresh);document.addEventListener('click',e=>{if(e.target.closest('#clear-customer-filters,#btn-clear-trx-filters'))setTimeout(refresh,0);});refresh();}
 const help=document.createElement('p');help.className='entry-shortcut-hint';help.textContent='Ctrl+Enter: Save & Next · Ctrl+S: Save & Close · Esc: Close';get('form-new-transaction').querySelector('.modal-body').prepend(help);
 get('btn-save-next').title='Save entry and keep this form open (Ctrl+Enter)';
 document.addEventListener('keydown',e=>{
  if(e.ctrlKey&&e.key==='Enter'&&state.activeModal==='modal-new-transaction'&&!state.editingTransactionId){e.preventDefault();e.stopImmediatePropagation();get('btn-save-next').click();return;}
  if(e.key!=='Tab'||!state.activeModal)return;
  const modal=get(state.activeModal);const focusable=[...modal.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(n=>!n.disabled&&n.tabIndex>=0&&n.getClientRects().length);
  const first=focusable[0],last=focusable.at(-1);if(!first)return;
  if(e.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){e.preventDefault();first.focus();}
 },true);
 function decorateEmpty(view,bodyId){const body=get(bodyId);const update=()=>{if(body.children.length!==1)return;const cell=body.querySelector('td[colspan]');if(!cell||cell.querySelector('.empty-state'))return;const wrapper=document.createElement('div');wrapper.className='empty-state';const title=document.createElement('strong');title.textContent=view==='customers'?'No customers to show':'No entries to show';const detail=document.createElement('p');detail.textContent='Try resetting filters, or add a new record to get started.';const reset=document.createElement('button');reset.type='button';reset.className='btn btn-outline btn-sm';reset.textContent='Reset filters';reset.onclick=()=>get(view==='customers'?'clear-customer-filters':'btn-clear-trx-filters').click();wrapper.append(title,detail,reset);cell.replaceChildren(wrapper);};new MutationObserver(update).observe(body,{childList:true});update();}
 decorateEmpty('customers','customers-table-body');decorateEmpty('transactions','all-transactions-body');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initUxEnhancements);else initUxEnhancements();
