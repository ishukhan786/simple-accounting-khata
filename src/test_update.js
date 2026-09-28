const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateChecker } = require('./update-check');
const release = version => ({ ok: true, status: 200, json: async () => ({ tag_name: version }) });
const make = fetch => createUpdateChecker({ fetch, getVersion: () => '1.0.5', retryDelayMs: 0, timeoutMs: 15 });
test('connection reset retries and recovers, concurrent checks share request', async () => {
  let calls = 0;
  const check = make(async () => { if (++calls === 1) throw Error('socket hang up'); return release('v1.0.6'); });
  const a = check(), b = check(); assert.equal(a,b);
  assert.equal((await a).isNewer,true); assert.equal(calls,2);
});
test('offline returns actionable status without IPC exception or false up-to-date', async () => {
  const info = await make(async () => { throw Error('socket hang up'); })();
  assert.equal(info.status,'unavailable'); assert.equal(info.reason,'network');
  assert.doesNotMatch(info.message,/socket|remote method/);
});
test('timeout aborts requests and finishes', async () => {
  const info = await make((url, {signal}) => new Promise((resolve,reject) => signal.addEventListener('abort', () => reject(Error('aborted')))))();
  assert.equal(info.reason,'timeout');
});
test('missing releases, rate limits and invalid data are not latest-version confirmations', async () => {
  for (const response of [{status:404}, {status:403}, {status:429}, release('bad'), {ok:true,status:200,json:async()=>{throw Error('bad JSON');}}]) {
    assert.equal((await make(async()=>response)()).status,'unavailable');
  }
});
test('version comparison handles current, older and newer stable releases', async () => {
  for (const [version, expected] of [['1.0.5',false],['1.0.4',false],['1.0.10',true]]) {
    const info = await make(async()=>release(version))();
    assert.equal(info.status,'checked'); assert.equal(info.isNewer,expected);
  }
});
