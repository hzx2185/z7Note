const bcrypt = require('bcrypt');
const db = require('../db/client');
const { sanitizeInput } = require('../utils/validators');

function normalizeEmail(email) {
  return sanitizeInput(email, 255).toLowerCase();
}

async function getUsersByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return [];
  }

  return db.queryAll(
    'SELECT * FROM users WHERE LOWER(email) = LOWER(?)',
    [normalizedEmail]
  );
}

async function findLoginUser(identifier) {
  const sanitizedIdentifier = sanitizeInput(identifier, 50);
  let user = await db.queryOne('SELECT * FROM users WHERE username = ?', [sanitizedIdentifier]);

  if (user) {
    return { user, matchedUsers: null };
  }

  const matchedUsers = await getUsersByEmail(sanitizedIdentifier);
  user = matchedUsers[0] || null;
  return { user, matchedUsers };
}

async function createResetToken(email) {
  const normalizedEmail = normalizeEmail(email);
  const token = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 600000;

  await db.execute('DELETE FROM reset_tokens WHERE email = ?', [normalizedEmail]);
  await db.execute(
    'INSERT INTO reset_tokens (email, token, expires) VALUES (?, ?, ?)',
    [normalizedEmail, token, expires]
  );

  return { email: normalizedEmail, token, expires };
}

async function getResetTokenRecord(email, token) {
  return db.queryOne(
    'SELECT * FROM reset_tokens WHERE email = ? AND token = ?',
    [normalizeEmail(email), token]
  );
}

async function updateUserPassword(username, password) {
  const hashedPassword = await bcrypt.hash(password, 10);
  await db.execute('UPDATE users SET password = ? WHERE username = ?', [hashedPassword, username]);
}

async function retryBusyOperation(operation, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const delay = options.delay || 100;
  const onRetry = typeof options.onRetry === 'function' ? options.onRetry : null;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const isBusy = error.code === 'SQLITE_BUSY' || error.message?.includes('database is locked');
      if (!isBusy || attempt >= maxRetries - 1) {
        throw error;
      }

      if (onRetry) {
        onRetry(error, attempt + 1);
      }

      await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)));
    }
  }
}

module.exports = {
  normalizeEmail,
  getUsersByEmail,
  findLoginUser,
  createResetToken,
  getResetTokenRecord,
  updateUserPassword,
  retryBusyOperation
};
