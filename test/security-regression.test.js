const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const tempRoot = path.join(os.tmpdir(), `z7note-test-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = path.join(tempRoot, 'data');
process.env.LOGS_DIR = path.join(tempRoot, 'logs');
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.HOST = '127.0.0.1';
process.env.PORT = '0';
process.env.CALDAV_ENABLED = 'false';
process.env.CARDDAV_ENABLED = 'false';

const config = require('../src/config');
const mailerPath = require.resolve('../src/services/mailer');
require.cache[mailerPath] = {
  id: mailerPath,
  filename: mailerPath,
  loaded: true,
  exports: {
    sendMail: async () => ({ messageId: 'test-message-id' })
  }
};
const { startServer } = require('../src/server');

let runtime;
let baseUrl;

function getCookieValue(setCookieHeaders, cookieName) {
  for (const header of setCookieHeaders) {
    const match = header.match(new RegExp(`^${cookieName}=([^;]+)`));
    if (match) {
      return `${cookieName}=${match[1]}`;
    }
  }
  return '';
}

async function request(pathname, { method = 'GET', cookie = '', body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (cookie) {
    requestHeaders.Cookie = cookie;
  }
  if (body !== undefined && !requestHeaders['Content-Type']) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : requestHeaders['Content-Type'] === 'application/json' ? JSON.stringify(body) : body,
    redirect: 'manual'
  });

  let json = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    json = await response.json();
  }

  return { response, json };
}

async function registerUser(username, password) {
  const { response, json } = await request('/api/register', {
    method: 'POST',
    body: { user: username, pass: password }
  });

  assert.equal(response.status, 200, JSON.stringify(json));
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  return getCookieValue(setCookie, config.cookieName);
}

async function upgradeUserPlan(username, planKey) {
  const db = require('../src/db/client');
  const { getPlanQuotaPresetAsync } = require('../src/services/memberService');
  const preset = await getPlanQuotaPresetAsync(planKey, db);
  await db.execute(
    'UPDATE users SET planKey = ?, noteLimit = ?, fileLimit = ?, planExpiresAt = 0 WHERE username = ?',
    [planKey, preset.noteLimit, preset.fileLimit, username]
  );
}

async function createNote(cookie, title, content) {
  const { response, json } = await request('/api/notes', {
    method: 'POST',
    cookie,
    body: { title, content }
  });

  assert.equal(response.status, 200, JSON.stringify(json));
  return json;
}

async function createShare(cookie, type, target) {
  const { response, json } = await request('/api/share/create', {
    method: 'POST',
    cookie,
    body: { type, target, public: true }
  });

  assert.equal(response.status, 200, JSON.stringify(json));
  return json.token;
}

test.before(async () => {
  await fs.mkdir(tempRoot, { recursive: true });
  runtime = await startServer({
    host: '127.0.0.1',
    port: 0,
    enableBackgroundJobs: false,
    enableWebSocket: false
  });
  const address = runtime.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (runtime) {
    await runtime.shutdown('test');
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
});

test('blocks cross-user note queries', async () => {
  const aliceCookie = await registerUser('alice', 'password123');
  const bobCookie = await registerUser('bob', 'password123');

  await createNote(aliceCookie, 'shared/test-note', 'private note');

  const { response, json } = await request('/api/notes?user=alice', {
    cookie: bobCookie
  });

  assert.equal(response.status, 403);
  assert.deepEqual(json, { error: '无权访问其他用户的笔记' });
});

test('serves public note shares and only allows referenced attachments', async () => {
  const aliceCookie = await registerUser('alice2', 'password123');
  await upgradeUserPlan('alice2', 'pro');
  const uploadsDir = path.join(config.paths.uploads, 'alice2');
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(path.join(uploadsDir, 'shared.txt'), 'shared attachment');
  await fs.writeFile(path.join(uploadsDir, 'private.txt'), 'private attachment');

  const note = await createNote(
    aliceCookie,
    'docs/public-share',
    'Attachment: [shared](shared.txt)'
  );
  const shareToken = await createShare(aliceCookie, 'note', note.id);

  const sharedNote = await request(`/api/share/public/${shareToken}`);
  assert.equal(sharedNote.response.status, 200);
  assert.equal(sharedNote.json.type, 'note');
  assert.equal(sharedNote.json.note.id, note.id);

  const allowedAttachment = await request(`/api/share/attachment/${shareToken}/shared.txt`);
  assert.equal(allowedAttachment.response.status, 200);
  assert.equal(await allowedAttachment.response.text(), 'shared attachment');

  const blockedAttachment = await request(`/api/share/attachment/${shareToken}/private.txt`);
  assert.equal(blockedAttachment.response.status, 403);
});

test('keeps raw attachment access scoped to the authenticated user', async () => {
  const aliceCookie = await registerUser('alice3', 'password123');
  const bobCookie = await registerUser('bob3', 'password123');
  const uploadsDir = path.join(config.paths.uploads, 'alice3');
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(path.join(uploadsDir, 'secret.txt'), 'owner only');

  const ownerRead = await request('/api/attachments/raw/secret.txt', { cookie: aliceCookie });
  assert.equal(ownerRead.response.status, 200);
  assert.equal(await ownerRead.response.text(), 'owner only');

  const otherUserRead = await request('/api/attachments/raw/secret.txt', { cookie: bobCookie });
  assert.equal(otherUserRead.response.status, 404);

  const traversalRead = await request('/api/attachments/raw/%2e%2e%2falice3%2fsecret.txt', { cookie: aliceCookie });
  assert.equal(traversalRead.response.status, 400);
});

test('forgot-password returns the same success response for existing and unknown emails', async () => {
  await registerUser('mailuser', 'password123');
  const existingEmail = 'mailuser@example.com';

  const db = require('../src/db/client');
  await db.execute('UPDATE users SET email = ? WHERE username = ?', [existingEmail, 'mailuser']);

  const existing = await request('/api/forgot-password', {
    method: 'POST',
    body: { email: existingEmail }
  });
  const missing = await request('/api/forgot-password', {
    method: 'POST',
    body: { email: 'missing@example.com' }
  });

  assert.equal(existing.response.status, 200);
  assert.equal(missing.response.status, 200);
  assert.deepEqual(existing.json, { status: 'ok' });
  assert.deepEqual(missing.json, { status: 'ok' });
});

test('login endpoint enforces rate limiting on repeated failed attempts', async () => {
  await registerUser('ratelimituser', 'password123');

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const { response, json } = await request('/api/login', {
      method: 'POST',
      body: { user: 'ratelimituser', pass: 'wrong-password' }
    });

    assert.equal(response.status, 403, `attempt ${attempt} expected 403, got ${response.status} ${JSON.stringify(json)}`);
  }

  const limited = await request('/api/login', {
    method: 'POST',
    body: { user: 'ratelimituser', pass: 'wrong-password' }
  });

  assert.equal(limited.response.status, 429);
  assert.deepEqual(limited.json, { error: '登录尝试过于频繁，请稍后再试' });
});
