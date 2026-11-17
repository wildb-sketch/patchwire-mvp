function roomRedirect(path) {
  const match = /^\/room\/([a-f0-9]{8})\/?$/.exec(path);
  return match ? '/neon#room=' + match[1] : null;
}
function assetLinks(value) {
  const fingerprints = String(value || '').split(',').map(v => v.trim().replace(/:/g, '').toUpperCase())
    .filter(v => /^[A-F0-9]{64}$/.test(v)).map(v => v.match(/../g).join(':'));
  return fingerprints.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: {
    namespace: 'android_app', package_name: 'com.patchwire.app', sha256_cert_fingerprints: [...new Set(fingerprints)],
  } }] : [];
}
module.exports = { roomRedirect, assetLinks };
