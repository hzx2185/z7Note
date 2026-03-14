const db = require('../db/client');
const { genToken } = require('../utils/helpers');
const path = require('path');
const fs = require('fs').promises;
const config = require('../config');
const log = require('../utils/logger');
const { getAllowedFileTypes } = require('./systemConfig');
const { inferMimeTypeFromFilename, validateStoredFile } = require('../utils/uploadValidation');

const CHUNKS_DIR = path.join(config.paths.data, 'upload_chunks');

/**
 * 初始化分片上传目录
 */
async function initChunksDir() {
  await fs.mkdir(CHUNKS_DIR, { recursive: true });
}

/**
 * 创建分片上传会话
 */
async function createUploadSession(username, filename, totalSize, chunkSize) {
  const uploadId = genToken(32);

  await db.execute(
    `INSERT INTO upload_chunks (id, username, filename, totalSize, chunkSize, uploadedChunks, createdAt, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uploadId,
      username,
      filename,
      totalSize,
      chunkSize,
      JSON.stringify([]),
      Date.now(),
      Date.now() + 24 * 60 * 60 * 1000 // 24小时过期
    ]
  );

  await initChunksDir();
  await fs.mkdir(path.join(CHUNKS_DIR, uploadId), { recursive: true });

  log('INFO', '创建分片上传会话', { uploadId, username, filename, totalSize });

  return {
    uploadId,
    chunkSize,
    totalChunks: Math.ceil(totalSize / chunkSize)
  };
}

/**
 * 上传分片
 */
async function uploadChunk(uploadId, username, chunkIndex, chunkData) {
  const session = await db.queryOne('SELECT * FROM upload_chunks WHERE id = ? AND username = ?', [uploadId, username]);

  if (!session) {
    throw new Error('上传会话不存在、已过期或无权访问');
  }

  // 检查会话是否过期
  if (session.expiresAt < Date.now()) {
    await cleanupUploadSession(uploadId, username);
    throw new Error('上传会话已过期');
  }

  // 保存分片文件
  const chunkPath = path.join(CHUNKS_DIR, uploadId, `${chunkIndex}.chunk`);
  await fs.writeFile(chunkPath, chunkData);

  // 更新已上传分片列表
  const uploadedChunks = JSON.parse(session.uploadedChunks || '[]');
  if (!uploadedChunks.includes(chunkIndex)) {
    uploadedChunks.push(chunkIndex);
    uploadedChunks.sort((a, b) => a - b);

    await db.execute(
      'UPDATE upload_chunks SET uploadedChunks = ? WHERE id = ? AND username = ?',
      [JSON.stringify(uploadedChunks), uploadId, username]
    );
  }

  return {
    chunkIndex,
    uploaded: uploadedChunks.length,
    total: Math.ceil(session.totalSize / session.chunkSize)
  };
}

/**
 * 检查分片上传状态
 */
async function getUploadStatus(uploadId, username) {
  const session = await db.queryOne('SELECT * FROM upload_chunks WHERE id = ? AND username = ?', [uploadId, username]);

  if (!session) {
    throw new Error('上传会话不存在、已过期或无权访问');
  }

  const uploadedChunks = JSON.parse(session.uploadedChunks || '[]');
  const totalChunks = Math.ceil(session.totalSize / session.chunkSize);

  return {
    uploadId,
    filename: session.filename,
    totalSize: session.totalSize,
    chunkSize: session.chunkSize,
    uploadedChunks,
    totalChunks,
    progress: Math.round((uploadedChunks.length / totalChunks) * 100),
    isComplete: uploadedChunks.length === totalChunks
  };
}

async function getUploadSession(uploadId, username) {
  return db.queryOne('SELECT * FROM upload_chunks WHERE id = ? AND username = ?', [uploadId, username]);
}

/**
 * 合并所有分片
 */
async function mergeChunks(uploadId, username) {
  const session = await db.queryOne('SELECT * FROM upload_chunks WHERE id = ? AND username = ?', [uploadId, username]);

  if (!session) {
    throw new Error('上传会话不存在');
  }

  const uploadedChunks = JSON.parse(session.uploadedChunks || '[]');
  const totalChunks = Math.ceil(session.totalSize / session.chunkSize);

  if (uploadedChunks.length !== totalChunks) {
    throw new Error('分片不完整');
  }

  // 创建目标文件
  const userUploadDir = path.join(config.paths.uploads, username);
  await fs.mkdir(userUploadDir, { recursive: true });

  const finalFilename = `${Date.now()}-${Math.random().toString(36).slice(-4)}${path.extname(session.filename)}`;
  const finalPath = path.join(userUploadDir, finalFilename);

  // 合并分片
  const writeStream = await fs.open(finalPath, 'w');

  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = path.join(CHUNKS_DIR, uploadId, `${i}.chunk`);
    const chunkData = await fs.readFile(chunkPath);
    await writeStream.write(chunkData, 0, chunkData.length, i * session.chunkSize);
  }

  await writeStream.close();

  const allowedTypes = await getAllowedFileTypes();
  const fileTypeValidation = await validateStoredFile(finalPath, {
    filename: session.filename,
    mimeType: inferMimeTypeFromFilename(session.filename),
    allowedTypes
  });

  if (!fileTypeValidation.ok) {
    await fs.unlink(finalPath).catch(() => {});
    await cleanupUploadSession(uploadId, username);
    throw new Error(fileTypeValidation.error);
  }

  // 清理临时文件
  await cleanupUploadSession(uploadId, username);

  log('INFO', '分片合并成功', { uploadId, username, filename: finalFilename });

  return {
    filename: finalFilename,
    url: `/api/attachments/raw/${finalFilename}`
  };
}

/**
 * 取消上传并清理临时文件
 */
async function cancelUpload(uploadId, username) {
  const session = await db.queryOne('SELECT * FROM upload_chunks WHERE id = ? AND username = ?', [uploadId, username]);

  if (!session) {
    throw new Error('上传会话不存在');
  }

  await cleanupUploadSession(uploadId, username);

  log('INFO', '取消分片上传', { uploadId, username });
  return { status: 'ok' };
}

/**
 * 清理上传会话
 */
async function cleanupUploadSession(uploadId, username = null) {
  // 删除数据库记录
  if (username) {
    await db.execute('DELETE FROM upload_chunks WHERE id = ? AND username = ?', [uploadId, username]);
  } else {
    await db.execute('DELETE FROM upload_chunks WHERE id = ?', [uploadId]);
  }

  // 删除临时文件
  const sessionDir = path.join(CHUNKS_DIR, uploadId);
  try {
    await fs.rm(sessionDir, { recursive: true, force: true });
  } catch (e) {
    // 目录不存在，忽略
  }
}

/**
 * 清理过期的上传会话
 */
async function cleanupExpiredSessions() {
  const now = Date.now();

  const expiredSessions = await db.queryAll(
    'SELECT id FROM upload_chunks WHERE expiresAt < ?',
    [now]
  );

  for (const session of expiredSessions) {
    await cleanupUploadSession(session.id);
  }

  log('INFO', '清理过期上传会话', { count: expiredSessions.length });
  return expiredSessions.length;
}

/**
 * 获取用户的上传会话列表
 */
async function getUserUploadSessions(username) {
  const sessions = await db.queryAll(
    'SELECT * FROM upload_chunks WHERE username = ? ORDER BY createdAt DESC',
    [username]
  );

  return sessions.map(session => {
    const uploadedChunks = JSON.parse(session.uploadedChunks || '[]');
    const totalChunks = Math.ceil(session.totalSize / session.chunkSize);

    return {
      uploadId: session.id,
      filename: session.filename,
      totalSize: session.totalSize,
      chunkSize: session.chunkSize,
      uploadedChunks,
      totalChunks,
      progress: Math.round((uploadedChunks.length / totalChunks) * 100),
      isComplete: uploadedChunks.length === totalChunks,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    };
  });
}

module.exports = {
  initChunksDir,
  createUploadSession,
  uploadChunk,
  getUploadSession,
  getUploadStatus,
  mergeChunks,
  cancelUpload,
  cleanupUploadSession,
  cleanupExpiredSessions,
  getUserUploadSessions
};
