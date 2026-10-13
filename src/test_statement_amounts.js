const {test}=require('node:test'),assert=require('node:assert/strict');
const statement=require('./statement');
test('statement preserves cents, balance signs and blank inactive cells',()=>{
  for(const closing of [1049,-1049,1,-1,1000,0]) {
    const debit=closing>0?closing:0,credit=closing<0?-closing:0;
    const db={validateDate(){},localToday:()=> '2026-10-11',getSettings:()=>({}),
      getCustomerLedger:()=>({customer:{name:'Test',currency:'AED',account_code:'01'},
        summary:{opening_balance:0,opening_balance_type:'Zero Balance',total_debit:debit,total_credit:credit,closing_balance:closing},
        transactions:[{transaction_date:'2026-10-11',description:'Decimal test',debit,credit,running_balance:closing}]})};
    const html=statement(db,1).html;
    const amount=(Math.abs(closing)/100).toLocaleString('en-US',{minimumFractionDigits:closing%100?2:0,maximumFractionDigits:2});
    assert(html.includes(`AED ${amount}${closing>0?' Dr':closing<0?' Cr':''}`));
    assert(html.includes(`<td>${debit?amount:''}</td><td>${credit?amount:''}</td>`));
  }
});
