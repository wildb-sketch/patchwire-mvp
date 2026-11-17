const fs = require('node:fs'), path = require('node:path');
async function prepare(options = {}) {
 const env = options.env || process.env, request = options.fetch || fetch;
 if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN) throw Error('Cloudflare deployment credentials are missing');
 const base = 'https://api.cloudflare.com/client/v4/accounts/' + env.CLOUDFLARE_ACCOUNT_ID;
 const bucket = 'patchwire-private-backups';
 async function api(route, method = 'GET', body) {
  const response = await request(base + route, { method, redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { Authorization: 'Bearer ' + env.CLOUDFLARE_API_TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let value; try { value = await response.json(); } catch { value = {}; }
  return { ok: response.ok && value.success !== false, status: response.status, result: value.result };
 }
 const previous = await api('/workers/scripts/patchwire/settings');
 if (!previous.ok) throw Error('Cannot check the current Worker bindings (HTTP ' + previous.status + ')');
 const alreadyBound = previous.result?.bindings?.some(binding => binding.name === 'BACKUPS');
 let available = false;
 let lookup = await api('/r2/buckets/' + bucket);
 if (lookup.status === 404) lookup = await api('/r2/buckets', 'POST', { name: bucket });
 if (lookup.ok) {
  const managed = await api('/r2/buckets/' + bucket + '/domains/managed', 'PUT', { enabled: false });
  const custom = await api('/r2/buckets/' + bucket + '/domains/custom');
  if (!managed.ok || managed.result?.enabled !== false || !custom.ok || !Array.isArray(custom.result?.domains)) throw Error('Cannot verify that the backup bucket is private');
  if (custom.result.domains.some(domain => domain.enabled !== false)) throw Error('Remove public custom domains from the private backup bucket before deployment');
  available = true;
 } else {
  if (alreadyBound) throw Error('R2 access failed for an existing backup binding. Deployment stopped to preserve it (HTTP ' + lookup.status + ')');
  (options.warn || console.warn)('::warning::Automatic R2 backups need R2 enabled and the deployment token to have Account R2 Storage Edit (HTTP ' + lookup.status + '). The app can deploy while backup activation remains pending.');
 }
 const source = options.config || fs.readFileSync(path.join(__dirname, '../wrangler.toml'), 'utf8');
 const config = source + (available ? '\n[[r2_buckets]]\nbinding = "BACKUPS"\nbucket_name = "' + bucket + '"\n\n[triggers]\ncrons = ["0 3 * * *"]\n' : '');
 if (options.write !== false) fs.writeFileSync(path.join(__dirname, '../wrangler.deploy.toml'), config);
 if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, 'backups=' + available + '\n');
 console.log(available ? 'Private backup bucket verified; daily backup trigger configured.' : 'Deployment prepared; independent backups await Cloudflare R2 activation.');
 return { available, config };
}
if (require.main === module) prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare };
