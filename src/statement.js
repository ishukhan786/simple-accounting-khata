const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function statement(db,id,from='',to='') {
  if(from)db.validateDate(from); if(to)db.validateDate(to);
  if(from&&to&&from>to)throw Error('From date must not be after To date.');
  const data=db.getCustomerLedger(id,'ASC',from,to);
  if(!data.customer)throw Error('Customer not found.');
  const c=data.customer,s=data.summary,settings=db.getSettings();
  const money=n=>`${c.currency} ${(Math.abs(n)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const balance=n=>money(n)+(n>0?' Dr':n<0?' Cr':'');
  const openBalVal=s.opening_balance_type==='Payable'?-s.opening_balance:(s.opening_balance_type==='Receivable'?s.opening_balance:0);
  const openRow=`<tr style="background:#f8fafc;font-weight:bold"><td>${escape(from||c.created_at?.slice(0,10)||'—')}</td><td>Opening Balance</td><td>${s.opening_balance_type==='Receivable'&&s.opening_balance?money(s.opening_balance):'—'}</td><td>${s.opening_balance_type==='Payable'&&s.opening_balance?money(s.opening_balance):'—'}</td><td>${balance(openBalVal)}</td></tr>`;
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:12px Arial;color:#173138;margin:28px}h1{font-size:24px}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{padding:9px;border-bottom:1px solid #ccd9de;text-align:left}td:nth-child(n+3),th:nth-child(n+3){text-align:right}thead{display:table-header-group}tr{break-inside:avoid}.totals{line-height:1.8;text-align:right}</style></head><body><h1>${escape(settings.business_name||'Simple Khata')}</h1><p>${escape(settings.address)} · ${escape(settings.mobile)}</p><h2>Customer statement</h2><p>${escape(c.name)} · Account ${escape(c.account_code)} · ${escape(c.currency)}</p><p>${escape(from||'Start')} to ${escape(to||'Latest')} · Generated ${escape(db.localToday())}</p><table><thead><tr><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${openRow}${data.transactions.map(t=>`<tr><td>${escape(t.transaction_date)}</td><td>${escape(t.description)}</td><td>${t.debit?money(t.debit):'—'}</td><td>${t.credit?money(t.credit):'—'}</td><td>${balance(t.running_balance)}</td></tr>`).join('')}</tbody></table><div class="totals">Opening: ${money(s.opening_balance)} ${escape(s.opening_balance_type)}<br>Debit: ${money(s.total_debit)}<br>Credit: ${money(s.total_credit)}<br><strong>Closing: ${balance(s.closing_balance)}</strong></div></body></html>`;
  return {html,customer:c};
}
module.exports=statement;
