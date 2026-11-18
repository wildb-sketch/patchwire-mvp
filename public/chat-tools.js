(function (root) {
  root.createChatTools = function (options) {
    const S = options.state, esc = options.esc, $ = selector => document.querySelector(selector);
    let generation = 0;
    const sizeLabel = size => size >= 1048576 ? (size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.ceil(size / 1024)) + ' KB';
    const peerOf = message => message.from === S.me.id ? message.to : message.from;
    function visible(message) {
      const state = S.chatPrefs[peerOf(message)];
      return !state?.clearedAt || message.ts > state.clearedAt || message.ts === state.clearedAt && !(state.clearedIds || []).includes(message.id);
    }
    async function load() {
      const request = ++generation, token = S.tok, before = new Set(S.msgs.map(m => m.id));
      const snapshot = await options.api('/chats');
      if (request !== generation || token !== S.tok) return;
      const arrivals = S.msgs.filter(m => !before.has(m.id));
      S.chatPrefs = snapshot.chats; S.marks = snapshot.marks; S.saved = snapshot.saved;
      const messages = new Map([...snapshot.messages, ...arrivals].map(m => [m.id, m]));
      S.msgs = [...messages.values()].filter(visible).sort((a, b) => a.ts - b.ts);
      options.pruned?.(); options.repaint();
    }
    function showSaved(filter = 'favorite', peer = '') { S.savedFilter = filter; options.closeModal(); options.openOv('saved', peer); }
    function confirmClear(peer, action) {
      options.modal(`<h2>${action === 'delete' ? 'Delete' : 'Clear'} chat for you?</h2><p class="mute">This removes the messages, favorites and message pins from your account.${action === 'delete' ? ' It also removes this chat from your inbox.' : ''} The other person keeps their copy. New messages will appear normally.</p><button class="btn rd w" id="confirm-chat-action">${action === 'delete' ? 'Delete chat' : 'Clear chat'}</button><button class="btn g w" data-x>Cancel</button>`, box => {
        box.querySelector('[data-x]').onclick = options.closeModal;
        box.querySelector('#confirm-chat-action').onclick = async event => {
          const button = event.currentTarget; button.disabled = true;
          try {
            await options.api('/chats/' + peer, 'POST', { action }); await load();
            if (button.isConnected) options.closeModal();
            if (action === 'delete' && S.ov?.t === 'chat' && S.ov.id === peer) options.goTab('inbox', 'chats');
            options.toast(action === 'delete' ? 'Chat deleted for you' : 'Chat cleared for you');
          } catch (error) { button.disabled = false; options.toast(error.message); }
        };
      });
    }
    function menu(peer) {
      const pinned = !!S.chatPrefs[peer]?.pinned;
      options.modal(`<h2>Chat options</h2><p class="mute s">Pins and saved messages are private to your account.</p><button class="btn g w" id="pin-chat">${pinned ? 'Unpin chat' : 'Pin chat'}</button><button class="btn g w" id="pinned-messages">Pinned messages</button><button class="btn g w" id="clear-chat">Clear chat for me</button><button class="btn rd w" id="delete-chat">Delete chat for me</button><button class="btn g w" data-x>Close</button>`, box => {
        box.querySelector('[data-x]').onclick = options.closeModal;
        box.querySelector('#clear-chat').onclick = () => confirmClear(peer, 'clear');
        box.querySelector('#delete-chat').onclick = () => confirmClear(peer, 'delete');
        box.querySelector('#pinned-messages').onclick = () => showSaved('pinned', peer);
        box.querySelector('#pin-chat').onclick = async event => {
          const button = event.currentTarget; button.disabled = true;
          try { await options.api('/chats/' + peer, 'POST', { action: pinned ? 'unpin' : 'pin' }); await load(); if (button.isConnected) options.closeModal(); }
          catch (error) { button.disabled = false; options.toast(error.message); }
        };
      });
    }
    function messageMenu(id) {
      const message = S.msgs.find(m => m.id === id) || S.saved.find(m => m.id === id); if (!message) return;
      const mark = S.marks[id] || {};
      options.modal(`<h2>Message options</h2><p class="mute s">Only you can see these pins and favorites.</p><button class="btn g w" data-mark="pinned">${mark.pinned ? 'Unpin message' : 'Pin message for me'}</button><button class="btn g w" data-mark="favorite">${mark.favorite ? 'Remove from favorites' : 'Add to favorites'}</button><button class="btn g w" data-x>Close</button>`, box => {
        box.querySelector('[data-x]').onclick = options.closeModal;
        box.querySelectorAll('[data-mark]').forEach(button => button.onclick = async () => {
          button.disabled = true;
          try { await options.api('/messages/' + id + '/mark', 'POST', { [button.dataset.mark]: !mark[button.dataset.mark] }); await load(); if (button.isConnected) options.closeModal(); }
          catch (error) { button.disabled = false; options.toast(error.message); }
        });
      });
    }
    async function upload(file, peer) {
      if (!file || S.upload) return;
      if (!file.size || file.size > 10 * 1024 * 1024) return options.toast('Choose a file between 1 byte and 10 MB.');
      const token = S.tok; S.upload = { peer, name: file.name }; options.repaint();
      try {
        const response = await fetch('/api/files?to=' + encodeURIComponent(peer) + '&name=' + encodeURIComponent(file.name), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' }, body: file });
        const result = await response.json(); if (!response.ok) throw Error(result.error || 'Could not send the file.');
        if (S.tok !== token) return;
        await load(); options.toast('File sent');
      } catch (error) { if (S.tok === token) options.toast(error.message || 'Could not send the file. Try again.'); }
      finally { S.upload = null; if (S.tok === token) options.repaint(); }
    }
    async function download(id) {
      const message = S.msgs.find(m => m.id === id) || S.saved.find(m => m.id === id); if (!message) return;
      try {
        if (options.android()) {
          const result = await options.nativeSave({ origin: location.origin, id, name: message.name, token: S.tok });
          if (!result?.cancelled) options.toast('File saved'); return;
        }
        const response = await fetch('/api/files/' + id, { headers: { Authorization: 'Bearer ' + S.tok } });
        if (!response.ok) throw Error('File is no longer available.');
        const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = message.name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (error) { options.toast(/unimplemented|not implemented/i.test(error.code + ' ' + error.message) ? 'Install the latest Android update to save files.' : error.message || 'Could not save the file.'); }
    }
    function bind(container) {
      container.querySelectorAll('[data-message-options]').forEach(button => button.onclick = () => messageMenu(button.dataset.messageOptions));
      container.querySelectorAll('[data-file]').forEach(button => button.onclick = () => download(button.dataset.file));
    }
    function savedView() {
      const peer = S.ov.id || '', filter = S.savedFilter || 'favorite';
      const messages = S.saved.filter(m => (!peer || peerOf(m) === peer) && S.marks[m.id]?.[filter]).sort((a, b) => b.ts - a.ts);
      $('#ob').innerHTML = `<div class="ph"><button class="ib2" id="bk" aria-label="Back">${options.ic('cl', 22)}</button><span class="tt sp">${peer ? 'Pinned messages' : 'Saved messages'}</span></div><div class="ob">${!peer ? `<div class="seg"><button data-saved-filter="favorite" aria-pressed="${filter === 'favorite'}">Favorites</button><button data-saved-filter="pinned" aria-pressed="${filter === 'pinned'}">Pinned</button></div>` : ''}<p class="mute s">Only you can see these.</p><div class="msgs">${messages.length ? messages.map(message => `<div class="saved-card"><button class="lk" data-open-chat="${esc(peerOf(message))}">${esc(options.who(peerOf(message)).nick)} · Open chat</button>${options.bubble(message)}</div>`).join('') : '<p class="mute c">No saved messages yet. Use ⋯ beside a message to save it.</p>'}</div></div>`;
      $('#bk').onclick = options.closeOv;
      $('#ob').querySelectorAll('[data-saved-filter]').forEach(button => button.onclick = () => { S.savedFilter = button.dataset.savedFilter; savedView(); });
      $('#ob').querySelectorAll('[data-open-chat]').forEach(button => button.onclick = () => options.openOv('chat', button.dataset.openChat));
      $('#ob').querySelectorAll('[data-v]').forEach(button => button.onclick = () => options.playVoice(button.dataset.v, button));
      $('#ob').querySelectorAll('[data-jr]').forEach(button => button.onclick = () => options.joinInvite(button.dataset.jr));
      bind($('#ob'));
    }
    return { load, visible, menu, bind, upload, savedView, showSaved, sizeLabel };
  };
})(window);
