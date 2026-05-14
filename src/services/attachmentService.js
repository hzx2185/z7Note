const path = require('path');
const fs = require('fs').promises;
const db = require('../db/client');
const config = require('../config');
const { getUserFileSize, formatSize } = require('../utils/helpers');
const { getSystemConfig, getAllowedFileTypes, getMaxFileSize } = require('./systemConfig');
const { compressImage } = require('./imageCompression');
const chunkUploadService = require('./chunkUpload');
const { validatePath } = require('../utils/path');
const {
  inferMimeTypeFromFilename,
  validateRequestedFileType,
  validateStoredFile
} = require('../utils/uploadValidation');

function getUserUploadDir(username) {
  return path.join(config.paths.uploads, username);
}

function normalizeAttachmentFilename(filename) {
  const normalized = path.normalize(filename || '').replace(/^(\.\.(\/|\\|$))+/, '');
  return {
    normalized,
    valid: !!filename && normalized === filename
  };
}

async function listAttachments(username) {
  const userDirPath = getUserUploadDir(username);
  try {
    await fs.access(userDirPath);
  } catch {
    return [];
  }

  const files = await fs.readdir(userDirPath);
  const fileList = await Promise.all(files.map(async (file) => {
    const stats = await fs.stat(path.join(userDirPath, file));
    return {
      id: file,
      name: file,
      size: formatSize(stats.size),
      sizeBytes: stats.size,
      time: stats.mtime,
      url: `/api/attachments/raw/${file}`
    };
  }));

  return fileList.sort((a, b) => b.time - a.time);
}

async function processUploadedFile(username, file, validatedMimeType) {
  const filename = file?.filename;
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('INVALID_FILENAME');
  }

  const user = await db.queryOne('SELECT fileLimit FROM users WHERE username = ?', [username]);
  const limitMB = parseFloat(user?.fileLimit || 0);
  if (limitMB <= 0) {
    throw new Error('ZERO_QUOTA');
  }

  const currentSizeBytes = await getUserFileSize(username);
  if (currentSizeBytes / 1024 / 1024 >= limitMB) {
    const usedMB = (currentSizeBytes / 1024 / 1024).toFixed(2);
    throw new Error(`QUOTA_EXCEEDED:${usedMB}:${limitMB}`);
  }

  const maxFileSize = await getMaxFileSize();
  if (file.size > maxFileSize) {
    throw new Error(`FILE_TOO_LARGE:${maxFileSize}`);
  }

  const allowedTypes = await getAllowedFileTypes();
  const fileTypeValidation = await validateStoredFile(file.path, {
    filename: file.originalname,
    mimeType: validatedMimeType || file.mimetype,
    allowedTypes
  });

  if (!fileTypeValidation.ok) {
    throw new Error(`INVALID_STORED_FILE:${fileTypeValidation.error}`);
  }

  let compressionResult = null;
  const mimeType = fileTypeValidation.mimeType;
  if (mimeType.startsWith('image/') && !file.originalname.endsWith('.svg')) {
    const imageBuffer = await fs.readFile(file.path);
    compressionResult = await compressImage(imageBuffer, mimeType);
    if (compressionResult.compressed) {
      await fs.writeFile(file.path, compressionResult.buffer);
    }
  }

  return {
    url: `/api/attachments/raw/${filename}`,
    compressionResult,
    filename,
    size: file.size
  };
}

async function deleteAttachment(username, filename, fallbackId) {
  let effectiveFilename = filename;
  if (!effectiveFilename) {
    if (!fallbackId) {
      throw new Error('MISSING_FILENAME');
    }
    effectiveFilename = typeof fallbackId === 'string' && fallbackId.includes('/') ? fallbackId.split('/').pop() : fallbackId;
  }

  const { normalized, valid } = normalizeAttachmentFilename(effectiveFilename);
  if (!valid) {
    throw new Error('INVALID_FILENAME');
  }

  await fs.unlink(path.join(getUserUploadDir(username), normalized));
  return normalized;
}

async function renameAttachment(username, oldName, newName) {
  if (!newName || typeof newName !== 'string') {
    throw new Error('MISSING_NEW_NAME');
  }

  const safeOld = normalizeAttachmentFilename(oldName);
  const safeNew = normalizeAttachmentFilename(newName);
  if (!safeOld.valid || !safeNew.valid) {
    throw new Error('INVALID_FILENAME');
  }

  const oldFilePath = path.join(getUserUploadDir(username), safeOld.normalized);
  const newFilePath = path.join(getUserUploadDir(username), safeNew.normalized);

  try {
    await fs.access(oldFilePath);
  } catch {
    throw new Error('SOURCE_NOT_FOUND');
  }

  try {
    await fs.access(newFilePath);
    throw new Error('TARGET_EXISTS');
  } catch (error) {
    if (error.message === 'TARGET_EXISTS') {
      throw error;
    }
  }

  await fs.rename(oldFilePath, newFilePath);
  return {
    oldName: safeOld.normalized,
    newName: safeNew.normalized,
    url: `/api/attachments/raw/${safeNew.normalized}`
  };
}

async function countInvalidAttachmentRefs(username) {
  const notes = await db.queryAll('SELECT id, content FROM notes WHERE username = ?', [username]);
  let count = 0;
  for (const note of notes) {
    if (note.content && note.content.includes('/api/uploads/')) {
      count++;
    }
  }
  return count;
}

async function fixAttachmentPaths(username, findText, replaceText) {
  const notes = await db.queryAll('SELECT id, content FROM notes WHERE username = ?', [username]);
  let count = 0;

  for (const note of notes) {
    if (!note.content || !note.content.includes(findText)) {
      continue;
    }

    const newContent = note.content.split(findText).join(replaceText);
    if (newContent === note.content) {
      continue;
    }

    await db.execute(
      'UPDATE notes SET content = ?, updatedAt = ? WHERE id = ? AND username = ?',
      [newContent, Math.floor(Date.now() / 1000), note.id, username]
    );
    count++;
  }

  return count;
}

async function purgeUnusedAttachments(username) {
  const userDirPath = getUserUploadDir(username);
  try {
    await fs.access(userDirPath);
  } catch {
    return 0;
  }

  const files = await fs.readdir(userDirPath);
  const notes = await db.queryAll('SELECT content FROM notes WHERE username = ?', [username]);
  const allContent = notes.map(note => note.content || '').join(' ');

  let deletedCount = 0;
  for (const file of files) {
    const filePath = path.join(userDirPath, file);
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || allContent.includes(file)) {
      continue;
    }
    await fs.unlink(filePath);
    deletedCount++;
  }

  return deletedCount;
}

async function createChunkUploadSession(username, filename, totalSize, mimeType) {
  const normalizedTotalSize = Number(totalSize);
  if (!Number.isSafeInteger(normalizedTotalSize) || normalizedTotalSize <= 0) {
    throw new Error('INVALID_TOTAL_SIZE');
  }

  const maxFileSize = await getMaxFileSize();
  if (normalizedTotalSize > maxFileSize) {
    throw new Error(`FILE_TOO_LARGE:${maxFileSize}`);
  }

  const user = await db.queryOne('SELECT fileLimit FROM users WHERE username = ?', [username]);
  const limitMB = parseFloat(user?.fileLimit || 0);
  if (limitMB <= 0) {
    throw new Error('ZERO_QUOTA');
  }

  const currentSizeBytes = await getUserFileSize(username);
  const limitBytes = limitMB * 1024 * 1024;
  if (currentSizeBytes + normalizedTotalSize > limitBytes) {
    const usedMB = (currentSizeBytes / 1024 / 1024).toFixed(2);
    throw new Error(`QUOTA_EXCEEDED:${usedMB}:${limitMB}`);
  }

  const allowedTypes = await getAllowedFileTypes();
  const fileTypeValidation = validateRequestedFileType({
    filename,
    mimeType: mimeType || inferMimeTypeFromFilename(filename),
    allowedTypes
  });
  if (!fileTypeValidation.ok) {
    throw new Error(`INVALID_FILE_TYPE:${fileTypeValidation.error}`);
  }

  const chunkSizeMB = parseInt(await getSystemConfig('chunkSize'), 10) || config.chunkUpload.chunkSize;
  const chunkSize = chunkSizeMB * 1024 * 1024;
  return chunkUploadService.createUploadSession(username, filename, normalizedTotalSize, chunkSize);
}

function resolveRawAttachment(username, filename) {
  const safeFilename = normalizeAttachmentFilename(filename);
  if (!filename) {
    throw new Error('MISSING_FILENAME');
  }
  if (!safeFilename.valid) {
    throw new Error('INVALID_FILENAME');
  }

  const filePath = path.join(getUserUploadDir(username), safeFilename.normalized);
  if (!validatePath(filePath, config.paths.uploads)) {
    throw new Error('BAD_PATH');
  }

  return {
    filename: safeFilename.normalized,
    filePath
  };
}

module.exports = {
  getUserUploadDir,
  listAttachments,
  processUploadedFile,
  deleteAttachment,
  renameAttachment,
  countInvalidAttachmentRefs,
  fixAttachmentPaths,
  purgeUnusedAttachments,
  createChunkUploadSession,
  resolveRawAttachment
};
