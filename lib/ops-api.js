const { operatorAuthorized } = require('./operations');
function createOpsApi(options) {
  const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  return async function handle(request, read) {
    if (!operatorAuthorized(request, options.env)) return response(401, { error: 'Operator authentication required' });
    const path = new URL(request.url).pathname, method = request.method;
    try {
      if (method === 'GET' && path === '/internal/ops/status') return response(200, { monitoring: options.monitor.state, backups: { ...options.backups.status, health: options.backups.health() } });
      if (method === 'GET' && path === '/internal/ops/reports') return response(200, options.reports().slice(-100).reverse());
      if (method === 'GET' && path === '/internal/ops/backups') return response(200, await options.backups.list());
      const body = ['POST', 'PATCH'].includes(method) ? await read() : {};
      if (method === 'POST' && path === '/internal/ops/backup') return response(200, await options.backups.run());
      if (method === 'POST' && path === '/internal/ops/restore') return response(200, body.dryRun !== false ? await options.backups.inspect(body.id) : await options.backups.restore(body.id, body.confirmation));
      const report = /^\/internal\/ops\/reports\/([a-z0-9:-]{1,80})$/.exec(path);
      if (method === 'PATCH' && report && ['reviewed', 'dismissed'].includes(body.status)) {
        if (!options.updateReport(report[1], body.status)) return response(404, { error: 'Report not found' });
        return response(200, { ok: true });
      }
      return response(404, { error: 'Not found' });
    } catch (error) { return response(error.status || 503, { error: error.status ? error.message : 'The operation could not be completed.' }); }
  };
}
module.exports = { createOpsApi };
