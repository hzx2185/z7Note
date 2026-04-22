const db = require('../db/client');

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
    await db.execute(
      'DELETE FROM shares WHERE targetType = ? AND target = ? AND owner = ?',
      ['note', noteId, username]
    );
  }
  return result;
}

async function softDeleteNote(noteId, username) {
  await db.execute(
    'UPDATE notes SET deleted = 1, updatedAt = ? WHERE id = ? AND username = ?',
    [Math.floor(Date.now() / 1000), noteId, username]
  );
  await db.execute(
    'DELETE FROM shares WHERE targetType = ? AND target = ? AND owner = ?',
    ['note', noteId, username]
  );
}

async function emptyTrash(username) {
  return db.execute(
    'DELETE FROM notes WHERE username = ? AND deleted = 1',
    [username]
  );
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

      await tx.execute(
        'UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ? AND username = ?',
        [newTitle, newContent, now, note.id, username]
      );

      replacedCount += 1;
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

      await tx.execute(
        'UPDATE notes SET title = ?, content = ?, updatedAt = ? WHERE id = ? AND username = ?',
        [newTitle, newContent, now, note.id, username]
      );

      movedCount += 1;
    }

    return movedCount;
  });
}

module.exports = {
  sanitizeTitle,
  normalizeNoteTimestamp,
  restoreNote,
  permanentlyDeleteNote,
  softDeleteNote,
  emptyTrash,
  deduplicateNotes,
  batchReplaceNotes,
  batchMoveNotes
};
