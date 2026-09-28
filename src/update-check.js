const RELEASE_URL = 'https://github.com/ishukhan786/simple-accounting-khata/releases/latest';
const API_URL = 'https://api.github.com/repos/ishukhan786/simple-accounting-khata/releases/latest';

function compareVersions(a, b) {
  const left = a.replace(/^v/, '').split('.').map(Number);
  const right = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function createUpdateChecker({ fetch, getVersion, timeoutMs = 10000, retryDelayMs = 500 }) {
  let pending;
  async function check() {
    const currentVersion = getVersion();
    const unavailable = (reason, message) => ({ status: 'unavailable', reason, message, currentVersion, isNewer: false, releaseUrl: RELEASE_URL });
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(API_URL, {
          headers: { 'User-Agent': 'Simple-Khata-Accounting-Desktop', Accept: 'application/vnd.github+json' },
          signal: controller.signal, cache: 'no-store', credentials: 'omit'
        });
        if (response.status === 404) return unavailable('not-found', 'Published update nahin mil saka. Releases page browser mein check karein.');
        if (response.status === 403 || response.status === 429) return unavailable('rate-limit', 'Update server ne filhal requests rok di hain. Thori der baad try karein ya releases page kholein.');
        if (response.status >= 500 && attempt === 0) continue;
        if (!response.ok) return unavailable('server', 'Update server abhi available nahin. Dobara try karein ya releases page kholein.');
        let release;
        try { release = await response.json(); }
        catch (error) { if (controller.signal.aborted) throw error; return unavailable('invalid-response', 'Update server ka jawab valid nahin tha. Dobara try karein.'); }
        const latestVersion = String(release?.tag_name || '').replace(/^v/, '');
        if (!/^\d+\.\d+\.\d+$/.test(latestVersion) || release.draft || release.prerelease) return unavailable('invalid-response', 'Stable release ki maloomat nahin mil saki. Releases page check karein.');
        return { status: 'checked', currentVersion, latestVersion, version: latestVersion,
          isNewer: compareVersions(latestVersion, currentVersion) > 0,
          releaseName: release.name || release.tag_name, releaseUrl: RELEASE_URL,
          releaseNotes: release.body || '', publishedAt: release.published_at };
      } catch (error) {
        if (attempt === 1) return unavailable(controller.signal.aborted ? 'timeout' : 'network', 'Update server se connection nahin ho saka. Internet check karke dobara try karein, ya releases page browser mein kholein. Aapka khata normal kaam karta rahega.');
      } finally { clearTimeout(timer); }
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  return () => {
    if (!pending) pending = check().finally(() => { pending = null; });
    return pending;
  };
}
module.exports = { createUpdateChecker, compareVersions };
