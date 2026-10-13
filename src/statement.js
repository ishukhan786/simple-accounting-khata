const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function statement(db,id,from='',to='') {
  if(from)db.validateDate(from); if(to)db.validateDate(to);
  if(from&&to&&from>to)throw Error('From date must not be after To date.');
  const data=db.getCustomerLedger(id,'ASC',from,to);
  if(!data.customer)throw Error('Customer not found.');
  const c=data.customer,s=data.summary,settings=db.getSettings();
  const amount=n=>(Math.abs(n)/100).toLocaleString('en-US',{minimumFractionDigits:Math.abs(n)%100?2:0,maximumFractionDigits:2});
  const money=n=>`${c.currency} ${amount(n)}`;
  const balance=n=>money(n)+(n>0?' Dr':n<0?' Cr':'');
  const balanceCell=n=>`<td style="font-weight:700;color:${n>0?'#dc2626':n<0?'#16a34a':'inherit'}">${balance(n)}</td>`;
  const date=value=>value ? value.split('-').reverse().join('-') : '';
  const openBalVal=s.opening_balance_type==='Payable'?-s.opening_balance:(s.opening_balance_type==='Receivable'?s.opening_balance:0);
  const openRow=`<tr style="background:#f8fafc;font-weight:bold"><td>${escape(date(from||c.created_at?.slice(0,10))||'—')}</td><td>Opening Balance</td><td>${s.opening_balance_type==='Receivable'&&s.opening_balance?amount(s.opening_balance):''}</td><td>${s.opening_balance_type==='Payable'&&s.opening_balance?amount(s.opening_balance):''}</td>${balanceCell(openBalVal)}</tr>`;
  const css=require('fs').readFileSync(require('path').join(__dirname,'renderer','css','styles.css'),'utf8');
  const detail=(label,value)=>`<div><strong>${label}</strong><span>:</span><span>${escape(value)}</span></div>`;
  const card=(label,value,extra='')=>{
    const color = label === 'Total Debit (Banam)' ? 'stmt-debit' : label === 'Total Credit (Jama)' ? 'stmt-credit' : label === 'Closing Balance' ? (s.closing_balance > 0 ? 'stmt-debit' : s.closing_balance < 0 ? 'stmt-credit' : '') : '';
    return `<div class="stmt-card ${extra} ${color}"><div class="stmt-card-title">${label}</div><div class="stmt-card-value">${value}</div></div>`;
  };
  const logo=/^data:image\/(png|jpeg|jpg|webp);base64,[a-zA-Z0-9+/=]+$/.test(settings.logo_base64||'') ? `<img src="${settings.logo_base64}" alt="Business logo" style="max-width:100px;max-height:60px;margin-bottom:8px">` : '';
  const rows=data.transactions.map(t=>`<tr><td>${date(t.transaction_date)}</td><td>${escape(t.description||'—')}</td><td>${t.debit?amount(t.debit):''}</td><td>${t.credit?amount(t.credit):''}</td>${balanceCell(t.running_balance)}</tr>`).join('');
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>${css}\nbody{height:auto;overflow:visible;background:white}#statement-paper td:nth-child(n+3){text-align:right}thead{display:table-header-group}tr{break-inside:avoid}.stmt-card-value{font-size:1rem}</style></head><body class="print-ancestor"><div id="statement-paper" class="print-paper print-target"><div class="statement-header"><div class="statement-business-info">${logo}<h2>${escape(settings.business_name||'Simple Khata')}</h2><p>${escape(settings.owner_name||'')}</p><p>${escape(settings.mobile)}</p><p>${escape(settings.address)}</p></div><div class="statement-title-box"><h3>ACCOUNT STATEMENT</h3><p style="font-size:0.8rem;color:#64748b">Generated: ${date(db.localToday())}</p></div></div><div class="statement-meta-box"><div class="statement-customer-details">${detail('Account Code',c.account_code)}${detail('Customer Name',c.name)}${c.mobile?detail('Mobile',c.mobile):''}${c.address?detail('Address',c.address):''}</div><div style="text-align:right"><div><strong>Currency:</strong> ${escape(c.currency)}</div><div><strong>Period:</strong> ${from||to?`${date(from)||'Start'} to ${date(to)||'Latest'}`:'All Records'}</div></div></div><div class="statement-summary-cards">${card('Opening Balance',balance(openBalVal))}${card('Total Debit (Banam)',money(s.total_debit))}${card('Total Credit (Jama)',money(s.total_credit))}${card('Closing Balance',balance(s.closing_balance),'highlight-card')}</div><table class="statement-table"><thead><tr><th>Date</th><th>Details</th><th>Debit (Banam)</th><th>Credit (Jama)</th><th class="text-right">Balance</th></tr></thead><tbody>${openRow}${rows}</tbody></table></div></body></html>`;
  return {html,customer:c};
}
module.exports=statement;
