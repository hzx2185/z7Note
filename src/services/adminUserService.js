const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const db = require('../db/client');
const { getUserFileSize } = require('../utils/helpers');
const { destroyUserSessions } = require('./session');
const { sanitizeInput, validateUsername, validateEmail, validatePassword } = require('../utils/validators');
const { getPlanQuotaPresetAsync } = require('./memberService');

async function getUserStats() {
  const users = await db.queryAll('SELECT username, email, planKey, planExpiresAt, noteLimit, fileLimit FROM users');

  return Promise.all(users.map(async (user) => {
    const username = (user.username || '').trim();
    const [n, c, e, t] = await Promise.all([
      db.queryOne('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(title) + LENGTH(content)), 0) as sz FROM notes WHERE LOWER(username) = LOWER(?) AND deleted = 0', [username]),
      db.queryOne('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(fn) + LENGTH(vcard)), 0) as sz FROM contacts WHERE LOWER(username) = LOWER(?)', [username]),
      db.queryOne('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(title) + LENGTH(description)), 0) as sz FROM events WHERE LOWER(username) = LOWER(?)', [username]),
      db.queryOne('SELECT COUNT(*) as cnt, IFNULL(SUM(LENGTH(title) + LENGTH(description)), 0) as sz FROM todos WHERE LOWER(username) = LOWER(?)', [username])
    ]);

    const attachmentSize = await getUserFileSize(username);

    return {
      ...user,
      noteCount: n?.cnt || 0,
      contactCount: c?.cnt || 0,
      eventCount: e?.cnt || 0,
      todoCount: t?.cnt || 0,
      dbSize: (n?.sz || 0) + (c?.sz || 0) + (e?.sz || 0) + (t?.sz || 0),
      attachmentSize: attachmentSize || 0
    };
  }));
}

function filterAndSortUserStats(stats, options = {}) {
  const search = options.search || '';
  const sort = options.sort;
  const order = options.order;
  let result = stats;

  if (search) {
    const keyword = search.toLowerCase();
    result = result.filter(user =>
      user.username.toLowerCase().includes(keyword) ||
      (user.email && user.email.toLowerCase().includes(keyword))
    );
  }

  if (sort) {
    result = [...result].sort((a, b) => {
      const valueA = a[sort];
      const valueB = b[sort];
      if (typeof valueA === 'string') {
        return order === 'asc'
          ? valueA.localeCompare(valueB)
          : valueB.localeCompare(valueA);
      }
      return order === 'asc'
        ? (valueA || 0) - (valueB || 0)
        : (valueB || 0) - (valueA || 0);
    });
  }

  return result;
}

async function deleteUser(username) {
  const user = await db.queryOne('SELECT username, email FROM users WHERE username = ?', [username]);
  if (!user) {
    return null;
  }

  const userUploadDir = path.join(config.paths.uploads, username);
  await db.withTransaction(async (tx) => {
    await tx.execute('DELETE FROM contact_history WHERE username = ?', [username]);
    await tx.execute('DELETE FROM contacts WHERE username = ?', [username]);
    await tx.execute('DELETE FROM calendar_subscriptions WHERE username = ?', [username]);
    await tx.execute('DELETE FROM reminder_history WHERE username = ?', [username]);
    await tx.execute('DELETE FROM reminder_settings WHERE username = ?', [username]);
    await tx.execute('DELETE FROM deleted_items WHERE username = ?', [username]);
    await tx.execute('DELETE FROM events WHERE username = ?', [username]);
    await tx.execute('DELETE FROM todos WHERE username = ?', [username]);
    await tx.execute('DELETE FROM notes WHERE username = ?', [username]);
    await tx.execute('DELETE FROM shares WHERE owner = ?', [username]);
    await tx.execute('DELETE FROM upload_chunks WHERE username = ?', [username]);
    await tx.execute('DELETE FROM user_backup_config WHERE username = ?', [username]);
    await tx.execute('DELETE FROM user_sessions WHERE username = ?', [username]);
    if (user.email) {
      await tx.execute('DELETE FROM reset_tokens WHERE email = ?', [user.email]);
    }
    await tx.execute('DELETE FROM users WHERE username = ?', [username]);
  });

  try {
    await fs.rm(userUploadDir, { recursive: true, force: true });
  } catch {}

  return user;
}

async function resetUserPassword(username, newPassword) {
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const result = await db.execute(
    'UPDATE users SET password = ? WHERE username = ?',
    [hashedPassword, username]
  );
  if (!result.changes) {
    return false;
  }
  await destroyUserSessions(username);
  return true;
}

async function updateUserQuota(username, noteLimit, fileLimit) {
  return db.execute(
    'UPDATE users SET noteLimit = ?, fileLimit = ? WHERE username = ?',
    [noteLimit, fileLimit, username]
  );
}

async function updateUserPlan(username, planKey) {
  const preset = await getPlanQuotaPresetAsync(planKey);
  const result = await db.execute(
    'UPDATE users SET planKey = ?, noteLimit = ?, fileLimit = ?, planExpiresAt = 0 WHERE username = ?',
    [planKey, preset.noteLimit, preset.fileLimit, username]
  );
  if (!result.changes) {
    return null;
  }
  return {
    username,
    planKey,
    noteLimit: preset.noteLimit,
    fileLimit: preset.fileLimit,
    planExpiresAt: 0
  };
}

async function createUser(username, password, email) {
  const sanitizedUsername = sanitizeInput(username, 20);
  const normalizedEmail = sanitizeInput(email, 255).toLowerCase();
  const sanitizedPassword = sanitizeInput(password, 100);

  if (!validateUsername(sanitizedUsername)) {
    throw new Error('INVALID_USERNAME');
  }
  if (!validateEmail(normalizedEmail)) {
    throw new Error('INVALID_EMAIL');
  }
  if (!validatePassword(sanitizedPassword)) {
    throw new Error('INVALID_PASSWORD');
  }

  const existingEmailUser = await db.queryOne(
    'SELECT username FROM users WHERE LOWER(email) = LOWER(?)',
    [normalizedEmail]
  );
  if (existingEmailUser) {
    throw new Error('EMAIL_IN_USE');
  }

  await db.execute(
    'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
    [sanitizedUsername, await bcrypt.hash(sanitizedPassword, 10), normalizedEmail]
  );

  return {
    username: sanitizedUsername,
    email: normalizedEmail
  };
}

module.exports = {
  getUserStats,
  filterAndSortUserStats,
  deleteUser,
  resetUserPassword,
  updateUserQuota,
  updateUserPlan,
  createUser
};
