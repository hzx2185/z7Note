const config = require('../config');
const { getConnection } = require('../db/connection');
const { genToken } = require('../utils/helpers');

function resolveCookieDomain(req) {
  if (!config.cookieDomain) {
    return undefined;
  }

  const requestHost = (req.hostname || '').toLowerCase();
  const cookieDomain = config.cookieDomain.replace(/^\./, '').toLowerCase();

  if (!requestHost) {
    return undefined;
  }

  if (requestHost === cookieDomain) {
    return config.cookieDomain;
  }

  if (requestHost.endsWith(`.${cookieDomain}`)) {
    return undefined;
  }

  return undefined;
}

function getSessionCookieOptions(req) {
  return {
    maxAge: config.cookieMaxAge,
    httpOnly: true,
    secure: config.cookieSecure || !!req.secure,
    sameSite: 'strict',
    path: '/',
    domain: resolveCookieDomain(req)
  };
}

function clearSessionCookie(req, res) {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.cookieSecure || !!req.secure,
    sameSite: 'strict',
    path: '/',
    domain: resolveCookieDomain(req)
  });
}

async function createSession(username) {
  const db = getConnection();
  const sessionId = genToken(48);
  const now = Date.now();
  const expiresAt = now + config.cookieMaxAge;

  await db.run(
    `INSERT INTO user_sessions (id, username, createdAt, expiresAt, lastSeenAt)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionId, username, now, expiresAt, now]
  );

  return { id: sessionId, username, expiresAt };
}

async function getSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return null;
  }

  const db = getConnection();
  const session = await db.get(
    'SELECT id, username, expiresAt FROM user_sessions WHERE id = ?',
    [sessionId]
  );

  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    await destroySession(sessionId);
    return null;
  }

  return session;
}

async function destroySession(sessionId) {
  if (!sessionId) {
    return;
  }

  await getConnection().run('DELETE FROM user_sessions WHERE id = ?', [sessionId]);
}

async function destroyUserSessions(username) {
  if (!username) {
    return;
  }

  await getConnection().run('DELETE FROM user_sessions WHERE username = ?', [username]);
}

module.exports = {
  getSessionCookieOptions,
  clearSessionCookie,
  createSession,
  getSession,
  destroySession,
  destroyUserSessions
};
