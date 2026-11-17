const { problem } = require('./security');
function createSafety(options) {
  const { data: D } = options;
  const blocked = (a, b) => D.blocks.some(item => item.by === a && item.who === b || item.by === b && item.who === a);
  const visibleRoom = (uid, room) => {
    if (room.removed?.has(uid)) return false;
    if ([...room.members.keys()].some(other => blocked(uid, other))) return false;
    return room.members.has(uid) || room.audience !== 'followers' || room.host === uid ||
      options.areFriends(uid, room.host) || D.follows.some(f => f.a === uid && f.b === room.host);
  };
  return {
    blocked, visibleRoom,
    block(uid, who) {
      if (!D.users[who] || who === uid) throw problem(404, 'User not found');
      if (D.blocks.filter(b => b.by === uid).length >= 500) throw problem(429, 'Your blocked list is full.');
      if (!D.blocks.some(b => b.by === uid && b.who === who)) {
        const record = { by: uid, who, ts: Date.now() }; D.blocks.push(record); options.put('block', uid + ':' + who, record);
      }
      D.friends = D.friends.filter(f => {
        if (!(f.a === uid && f.b === who || f.a === who && f.b === uid)) return true;
        options.remove('friend', f.a + ':' + f.b); return false;
      });
      D.follows = D.follows.filter(f => {
        if (!(f.a === uid && f.b === who || f.a === who && f.b === uid)) return true;
        options.remove('follow', f.a + ':' + f.b); return false;
      });
      options.separate(uid, who);
    },
    unblock(uid, who) { D.blocks = D.blocks.filter(b => !(b.by === uid && b.who === who)); options.remove('block', uid + ':' + who); },
    report(uid, body) {
      const who = String(body.id || '');
      if (!D.users[who] || who === uid) throw problem(404, 'User not found');
      const reason = String(body.reason || 'other');
      if (!['spam', 'harassment', 'hate', 'impersonation', 'other'].includes(reason)) throw problem(400, 'Choose a report reason');
      const existing = D.reports.find(r => r.by === uid && r.who === who && r.reason === reason && r.ts > Date.now() - 86400000);
      if (existing) return existing.id;
      const id = [...crypto.getRandomValues(new Uint8Array(6))].map(x => x.toString(16).padStart(2, '0')).join('');
      const record = { id, by: uid, who, reason, details: String(body.details || '').trim().slice(0, 1000), ts: Date.now(), status: 'open' };
      D.reports.push(record); options.put('report', id, record); return id;
    },
  };
}
module.exports = { createSafety };
