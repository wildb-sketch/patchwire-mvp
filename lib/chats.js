const { problem } = require('./security');
const ID = /^[a-f0-9]{12}$/;
function createChats(options) {
  const D = options.data, now = options.now || Date.now;
  D.chats ||= {}; D.messageMarks ||= {};
  const peerOf = (uid, message) => message.from === uid ? message.to : message.to === uid ? message.from : null;
  function visible(uid, message) {
    const peer = peerOf(uid, message); if (!peer) return false;
    const state = D.chats[uid + ':' + peer];
    return !state?.clearedAt || message.ts > state.clearedAt || message.ts === state.clearedAt && !(state.clearedIds || []).includes(message.id);
  }
  function snapshot(uid) {
    const chats = {}, marks = {}, saved = [], messages = new Map(D.msgs.map(m => [m.id, m]));
    for (const state of Object.values(D.chats)) if (state.uid === uid) chats[state.peer] = state;
    for (const mark of Object.values(D.messageMarks)) if (mark.uid === uid) {
      const message = messages.get(mark.messageId);
      if (message && visible(uid, message)) { marks[message.id] = { pinned: mark.pinned, favorite: mark.favorite }; saved.push(message); }
    }
    return { chats, marks, saved, messages: D.msgs.filter(m => visible(uid, m)).slice(-500) };
  }
  function chat(uid, peer, action) {
    if (!ID.test(peer || '') || !D.users[peer] || peer === uid) throw problem(404, 'User not found');
    if (!['pin', 'unpin', 'clear', 'delete'].includes(action)) throw problem(400, 'Unknown chat action');
    const key = uid + ':' + peer, state = { ...(D.chats[key] || { uid, peer }) };
    if (action === 'pin') {
      if (!state.pinned && Object.values(D.chats).filter(s => s.uid === uid && s.pinned).length >= 10) throw problem(400, 'You can pin up to 10 chats.');
      state.pinned = true; state.hidden = false;
    } else if (action === 'unpin') state.pinned = false;
    else {
      const messages = D.msgs.filter(m => peerOf(uid, m) === peer);
      state.clearedAt = messages.reduce((time, message) => Math.max(time, message.ts), now());
      state.clearedIds = messages.filter(m => m.ts === state.clearedAt).map(m => m.id);
      state.hidden = action === 'delete'; if (state.hidden) state.pinned = false;
      const ids = new Set(messages.map(m => m.id));
      for (const [id, mark] of Object.entries(D.messageMarks)) if (mark.uid === uid && ids.has(mark.messageId)) { delete D.messageMarks[id]; options.remove('messageMark', id); }
    }
    state.updated = now(); D.chats[key] = state; options.put('chat', key, state); options.changed(uid);
  }
  function mark(uid, id, body) {
    const message = D.msgs.find(m => m.id === id);
    if (!message || !visible(uid, message)) throw problem(404, 'Message not found');
    const fields = ['pinned', 'favorite'].filter(field => Object.hasOwn(body, field));
    if (!fields.length || fields.some(field => typeof body[field] !== 'boolean')) throw problem(400, 'Choose a message action');
    const key = uid + ':' + id, old = D.messageMarks[key], item = { uid, messageId: id, pinned: false, favorite: false, ...old };
    for (const field of fields) item[field] = body[field];
    if (!old && (item.pinned || item.favorite) && Object.values(D.messageMarks).filter(m => m.uid === uid).length >= 500) throw problem(400, 'You can save up to 500 messages.');
    if (item.pinned && !old?.pinned) {
      const peer = peerOf(uid, message), ids = new Set(D.msgs.filter(m => peerOf(uid, m) === peer).map(m => m.id));
      if (Object.values(D.messageMarks).filter(m => m.uid === uid && m.pinned && ids.has(m.messageId)).length >= 20) throw problem(400, 'You can pin up to 20 messages per chat.');
    }
    if (item.pinned || item.favorite) { D.messageMarks[key] = item; options.put('messageMark', key, item); }
    else { delete D.messageMarks[key]; options.remove('messageMark', key); }
    options.changed(uid);
  }
  return { visible, snapshot, chat, mark };
}
module.exports = { createChats };
