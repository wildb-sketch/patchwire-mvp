// Child-server preload for tests only. No production endpoint can redirect recovery emails.
const fs = require('node:fs');
globalThis.fetch = async (url, init) => {
 if (url !== 'https://api.resend.com/emails') throw Error('External network is disabled in this test');
 const file = process.env.TEST_MAIL_FILE, messages = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
 messages.push(JSON.parse(init.body)); fs.writeFileSync(file, JSON.stringify(messages));
 return Response.json({ id: 'fixture-message' });
};
