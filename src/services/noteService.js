const db = require('../db/client');
const crypto = require('crypto');

const NOTE_VERSION_MIN_INTERVAL_SECONDS = 10 * 60;
const NOTE_VERSION_MAX_PER_NOTE = 100;

function sanitizeTitle(title) {
  if (!title) return title;
  return title.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeNoteTimestamp(value, fallback) {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed / 1000);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value > 2000000000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  return fallback;
}

function createNoteVersionId() {
  if (crypto.randomUUID) return `ver_${crypto.randomUUID().replace(/-/g, '')}`;
  return `ver_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function buildNoteVersionHash(note) {
  return crypto
    .createHash('sha256')
    .update(note.title || '')
    .update('\0')
    .update(note.content || '')
    .digest('hex');
}

function normalizeExecutor(executor) {
  return executor || db;
}

async function pruneNoteVersions(executor, username, noteId) {
  const runner = normalizeExecutor(executor);
  await runner.execute(
    `DELETE FROM note_versions
     WHERE username = ? AND noteId = ?
       AND id NOT IN (
         SELECT id FROM note_versions
         WHERE username = ? AND noteId = ?
         ORDER BY createdAt DESC
         LIMIT ?
       )`,
    [username, noteId, username, noteId, NOTE_VERSION_MAX_PER_NOTE]
  );
}

async function recordNoteVersion(executor, note, options = {}) {
  if (!note || !note.id || !note.username) return false;

  const runner = normalizeExecutor(executor);
  const now = options.now || Math.floor(Date.now() / 1000);
  const source = options.source || 'auto';
  const force = options.force === true;
  const contentHash = buildNoteVersionHash(note);

  const latest = await runner.queryOne(
    `SELECT id, contentHash, createdAt
     FROM note_versions
     WHERE username = ? AND noteId = ?
     ORDER BY createdAt DESC
     LIMIT 1`,
    [note.username, note.id]
  );

  if (latest && latest.contentHash === contentHash) {
    return false;
  }

  if (!force && latest && now - Number(latest.createdAt || 0) < NOTE_VERSION_MIN_INTERVAL_SECONDS) {
    return false;
  }

  await runner.execute(
    `INSERT INTO note_versions
      (id, noteId, username, title, content, contentHash, source, noteUpdatedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      createNoteVersionId(),
      note.id,
      note.username,
      note.title || '',
      note.content || '',
      contentHash,
      source,
      normalizeNoteTimestamp(note.updatedAt, 0) || 0,
      now
    ]
  );

  await pruneNoteVersions(runner, note.username, note.id);
  return true;
}

function hasMeaningfulNoteChange(before, after = {}) {
  if (!before) return false;
  if (after.title !== undefined && (after.title || '') !== (before.title || '')) return true;
  if (after.content !== undefined && (after.content || '') !== (before.content || '')) return true;
  if (after.deleted !== undefined && Number(after.deleted || 0) !== Number(before.deleted || 0)) return true;
  return false;
}

async function listNoteVersions(noteId, username) {
  return db.queryAll(
    `SELECT id, noteId, title, source, noteUpdatedAt, createdAt, LENGTH(content) AS contentLength
     FROM note_versions
     WHERE noteId = ? AND username = ?
     ORDER BY createdAt DESC
     LIMIT 100`,
    [noteId, username]
  );
}

async function getNoteVersion(noteId, versionId, username) {
  return db.queryOne(
    `SELECT id, noteId, username, title, content, source, noteUpdatedAt, createdAt
     FROM note_versions
     WHERE noteId = ? AND id = ? AND username = ?`,
    [noteId, versionId, username]
  );
}

async function restoreNoteVersion(noteId, versionId, username) {
  return db.withTransaction(async (tx) => {
    const version = await tx.queryOne(
      `SELECT id, noteId, username, title, content, source, noteUpdatedAt, createdAt
       FROM note_versions
       WHERE noteId = ? AND id = ? AND username = ?`,
      [noteId, versionId, username]
    );
    if (!version) return null;

    const current = await tx.queryOne(
      'SELECT * FROM notes WHERE id = ? AND username = ?',
      [noteId, username]
    );
    if (!current) return null;

    const now = Math.floor(Date.now() / 1000);
    await recordNoteVersion(tx, current, { now, source: 'restore-before', force: true });

    await tx.execute(
      'UPDATE notes SET title = ?, content = ?, deleted = 0, updatedAt = ? WHERE id = ? AND username = ?',
      [version.title || '未命名', version.content || '', now, noteId, username]
    );

    return tx.queryOne(
      'SELECT * FROM notes WHERE id = ? AND username = ?',
      [noteId, username]
    );
  });
}

async function restoreNote(noteId, username) {
  return db.execute(
    'UPDATE notes SET deleted = 0, updatedAt = ? WHERE id = ? AND username = ?',
    [Math.floor(Date.now() / 1000), noteId, username]
  );
}

async function permanentlyDeleteNote(noteId, username) {
  const result = await db.execute(
    'DELETE FROM notes WHERE id = ? AND username = ?',
    [noteId, username]
  );
  if (result.changes > 0) {
    await Promise.all([
      db.execute(
        'DELETE FROM shares WHERE targetType = ? AND target = ? AND owner = ?',
        ['note', noteId, username]
      ),
      db.execute(
        'DELETE FROM note_versions WHERE noteId = ? AND username = ?',
        [noteId, username]
      )
    ]);
  }
  return result;
}

async function softDeleteNote(noteId, username) {
  await db.withTransaction(async (tx) => {
    const note = await tx.queryOne(
      'SELECT * FROM notes WHERE id = ? AND username = ?',
      [noteId, username]
    );
    const now = Math.floor(Date.now() / 1000);
    if (note && Number(note.deleted || 0) === 0) {
      await recordNoteVersion(tx, note, { now, source: 'delete' });
    }
    await tx.execute(
      'UPDATE notes SET deleted = 1, updatedAt = ? WHERE id = ? AND username = ?',
      [now, noteId, username]
    );
    await tx.execute(
      'DELETE FROM shares WHERE targetType = ? AND target = ? AND owner = ?',
      ['note', noteId, username]
    );
  });
}

async function emptyTrash(username) {
  return db.withTransaction(async (tx) => {
    const deletedNotes = await tx.queryAll(
      'SELECT id FROM notes WHERE username = ? AND deleted = 1',
      [username]
    );
    if (deletedNotes.length > 0) {
      const ids = deletedNotes.map(note => note.id);
      const placeholders = ids.map(() => '?').join(',');
      await tx.execute(
        `DELETE FROM note_versions WHERE username = ? AND noteId IN (${placeholders})`,
        [username, ...ids]
      );
    }
    return tx.execute(
      'DELETE FROM notes WHERE username = ? AND deleted = 1',
      [username]
    );
  });
}

async function deduplicateNotes(username, mode = 'both') {
  let duplicates;

  if (mode === 'title') {
    duplicates = await db.queryAll(`
      SELECT title, COUNT(*) as count, GROUP_CONCAT(id) as ids
      FROM notes
      WHERE username = ? AND deleted = 0
      GROUP BY title
      HAVING count > 1
    `, [username]);
  } else if (mode === 'content') {
    duplicates = await db.queryAll(`
      SELECT content, COUNT(*) as count, GROUP_CONCAT(id) as ids
      FROM notes
      WHERE username = ? AND deleted = 0
      GROUP BY content
      HAVING count > 1
    `, [username]);
  } else {
    duplicates = await db.queryAll(`
      SELECT title, content, COUNT(*) as count, GROUP_CONCAT(id) as ids
      FROM notes
      WHERE username = ? AND deleted = 0
      GROUP BY title, content
      HAVING count > 1
    `, [username]);
  }

  const now = Math.floor(Date.now() / 1000);
  const deletedCount = await db.withTransaction(async (tx) => {
    let count = 0;
    for (const dup of duplicates) {
      const ids = dup.ids.split(',');
      const notes = await tx.queryAll(
        `SELECT id, updatedAt FROM notes WHERE id IN (${ids.map(() => '?').join(',')}) AND username = ?`,
        [...ids, username]
      );

      notes.sort((a, b) => b.updatedAt - a.updatedAt);
      const idsToDelete = notes.slice(1).map(note => note.id);

      if (idsToDelete.length > 0) {
        const placeholders = idsToDelete.map(() => '?').join(',');
        await tx.execute(
          `UPDATE notes SET deleted = 1, updatedAt = ? WHERE id IN (${placeholders}) AND username = ?`,
          [now, ...idsToDelete, username]
        );
        count += idsToDelete.length;
      }
    }
    return count;
  });

  return {
    deletedCount,
    groupsProcessed: duplicates.length
  };
}

async function batchReplaceNotes(username, ids, findTexts, replaceText) {
  return db.withTransaction(async (tx) => {
    const placeholders = ids.map(() => '?').join(',');
    const notes = await tx.queryAll(
      `SELECT id, title, content FROM notes WHERE id IN (${placeholders}) AND username = ?`,
      [...ids, username]
    );

    let replacedCount = 0;
    const now = Math.floor(Date.now() / 1000);

    for (const note of notes) {
      let newTitle = note.title;
      for (const findText of findTexts) {
        newTitle = newTitle.split(findText).join(replaceText);
      }
      newTitle = sanitizeTitle(newTitle);

      let newContent = note.content || '';
      for (const findText of findTexts) {
        newContent = newContent.split(findText).join(replaceText);
      }

      if (newTitle !== note.title || newContent !== (note.content || '')) {
        await recordNoteVersion(tx, { ...note, username }, { now, source: 'batch-replace' });
        await tx.execute(
          'UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ? AND username = ?',
          [newTitle, newContent, now, note.id, username]
        );
        replacedCount += 1;
      }
    }

    return replacedCount;
  });
}

async function batchMoveNotes(username, ids, targetFolderName) {
  return db.withTransaction(async (tx) => {
    const placeholders = ids.map(() => '?').join(',');
    const notes = await tx.queryAll(
      `SELECT id, title, content FROM notes WHERE id IN (${placeholders}) AND username = ?`,
      [...ids, username]
    );

    let movedCount = 0;
    const now = Math.floor(Date.now() / 1000);

    for (const note of notes) {
      let pureTitle = note.title;
      if (note.title.includes('/')) {
        const parts = note.title.split('/');
        pureTitle = parts.slice(1).join('/').trim() || '未命名';
      }

      const newTitle = sanitizeTitle(pureTitle ? `${targetFolderName}/${pureTitle}` : targetFolderName);

      let newContent = note.content;
      if (newContent && newContent.trim()) {
        const lines = newContent.split('\n');
        if (lines.length > 0) {
          const firstLine = lines[0].trim();
          const cleanLine = firstLine.replace(/^#+\s*/, '').trim();

          if (cleanLine.includes('/')) {
            const parts = cleanLine.split('/');
            const titlePart = parts.slice(1).join('/').trim() || '未命名';
            const markdownPrefix = firstLine.match(/^#+\s*/)?.[0] || '';
            lines[0] = markdownPrefix + `${targetFolderName}/${titlePart}`;
            newContent = lines.join('\n');
          }
        }
      } else {
        newContent = targetFolderName;
      }

      if (newTitle !== note.title || newContent !== (note.content || '')) {
        await recordNoteVersion(tx, { ...note, username }, { now, source: 'batch-move' });
        await tx.execute(
          'UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ? AND username = ?',
          [newTitle, newContent, now, note.id, username]
        );
        movedCount += 1;
      }
    }

    return movedCount;
  });
}

module.exports = {
  sanitizeTitle,
  normalizeNoteTimestamp,
  recordNoteVersion,
  hasMeaningfulNoteChange,
  listNoteVersions,
  getNoteVersion,
  restoreNoteVersion,
  restoreNote,
  permanentlyDeleteNote,
  softDeleteNote,
  emptyTrash,
  deduplicateNotes,
  batchReplaceNotes,
  batchMoveNotes
};
