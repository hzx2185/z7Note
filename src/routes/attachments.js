const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const config = require('../config');
const { createFileBasedUploadLimitMiddleware, createChunkUploadLimitMiddleware } = require('../utils/dynamicRateLimiter');
const chunkUploadService = require('../services/chunkUpload');
const attachmentService = require('../services/attachmentService');
const log = require('../utils/logger');
const { ATTACHMENT_EVENTS } = require('../constants/securityEvents');
const { isUsernameSafe } = require('../middleware/validateUser');
const { getAllowedFileTypes } = require('../services/systemConfig');
const { validateRequestedFileType } = require('../utils/uploadValidation');
const { requirePlanCapability } = require('../middleware/memberAccess');

const router = express.Router();

router.use('/api/attachments', requirePlanCapability('attachmentsEnabled', { message: '当前套餐未开启附件功能' }));
router.use('/api/upload', requirePlanCapability('attachmentsEnabled', { message: '当前套餐未开启附件功能' }));
router.use('/api/purge-attachments', requirePlanCapability('attachmentsEnabled', { message: '当前套餐未开启附件功能' }));

async function fileFilter(req, file, cb) {
  try {
    const allowedTypes = await getAllowedFileTypes();
    const validation = validateRequestedFileType({
      filename: file.originalname,
      mimeType: file.mimetype,
      allowedTypes
    });

    if (!validation.ok) {
      log('WARN', '上传文件类型不被支持', {
        mimeType: file.mimetype,
        originalName: file.originalname,
        error: validation.error
      });
      return cb(new Error(`${validation.error}，请检查文件格式或联系管理员添加支持`), false);
    }

    req.validatedUploadMimeType = validation.mimeType;
    cb(null, true);
  } catch (error) {
    log('ERROR', '文件类型验证失败', { error: error.message, stack: error.stack });
    cb(new Error('文件类型验证失败，请稍后重试'), false);
  }
}

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const username = req.user || 'temp';
    if (!isUsernameSafe(username)) {
      return cb(new Error('Invalid username: path traversal detected'), false);
    }

    const userDir = path.join(config.paths.uploads, username);
    await fs.mkdir(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(-4)}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxFileSize * 1024 * 1024
  }
});

const multerErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '文件大小超过限制' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: '文件上传错误' });
    }
    return res.status(400).json({ error: `文件上传错误: ${err.message}` });
  }

  if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }

  return res.status(500).json({ error: '服务器内部错误' });
};

router.get('/api/attachments', async (req, res) => {
  try {
    const attachments = await attachmentService.listAttachments(req.user);
    res.json(attachments);
  } catch (error) {
    log('ERROR', '获取附件列表失败', { username: req.user, error: error.message, stack: error.stack });
    res.status(500).json({ error: '获取列表失败' });
  }
});

router.post('/api/upload', createFileBasedUploadLimitMiddleware(), upload.single('file'), multerErrorHandler, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '未接收到文件' });
  }

  try {
    const result = await attachmentService.processUploadedFile(
      req.user,
      req.file,
      req.validatedUploadMimeType
    );

    log('INFO', '附件上传成功', {
      username: req.user,
      filename: result.filename,
      size: result.size,
      compressed: result.compressionResult?.compressed
    });

    res.json({
      url: result.url,
      compressionResult: result.compressionResult
    });
  } catch (error) {
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    if (error.message === 'INVALID_FILENAME') {
      return res.status(400).json({ error: '无效的文件名' });
    }
    if (error.message === 'ZERO_QUOTA') {
      return res.status(403).json({ error: '上传失败：您的附件配额为 0MB' });
    }
    if (error.message.startsWith('QUOTA_EXCEEDED:')) {
      const [, usedMB, limitMB] = error.message.split(':');
      return res.status(403).json({ error: `超出附件配额 (已用:${usedMB}MB / 上限:${limitMB}MB)` });
    }
    if (error.message.startsWith('FILE_TOO_LARGE:')) {
      const [, maxFileSize] = error.message.split(':');
      return res.status(400).json({ error: `单个文件大小不能超过${Number(maxFileSize) / 1024 / 1024}MB` });
    }
    if (error.message.startsWith('INVALID_STORED_FILE:')) {
      return res.status(400).json({ error: error.message.slice('INVALID_STORED_FILE:'.length) });
    }

    log('ERROR', '上传拦截器异常', { username: req.user, error: error.message, stack: error.stack });
    res.status(500).json({ error: '上传失败: ' + error.message });
  }
});

router.delete('/api/attachments/:filename(*)', async (req, res) => {
  try {
    const filename = await attachmentService.deleteAttachment(req.user, req.params.filename, req.body?.id);
    log('INFO', '附件删除成功', { username: req.user, filename });
    res.json({ status: 'ok', filename });
  } catch (error) {
    if (error.message === 'MISSING_FILENAME') {
      return res.status(400).json({ error: '缺少文件名或ID' });
    }
    if (error.message === 'INVALID_FILENAME') {
      return res.status(400).json({ error: '文件名包含非法字符' });
    }
    log('ERROR', '删除附件失败', {
      username: req.user,
      filename: req.params.filename || req.body?.id,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: '删除失败' });
  }
});

router.put('/api/attachments/:filename(*)', async (req, res) => {
  try {
    const result = await attachmentService.renameAttachment(req.user, req.params.filename, req.body?.newName);
    log('INFO', '附件重命名成功', {
      username: req.user,
      oldName: result.oldName,
      newName: result.newName
    });
    res.json({ status: 'ok', ...result });
  } catch (error) {
    if (error.message === 'MISSING_NEW_NAME') {
      return res.status(400).json({ error: '新文件名不能为空' });
    }
    if (error.message === 'INVALID_FILENAME') {
      return res.status(400).json({ error: '文件名包含非法字符' });
    }
    if (error.message === 'SOURCE_NOT_FOUND') {
      return res.status(404).json({ error: '原文件不存在' });
    }
    if (error.message === 'TARGET_EXISTS') {
      return res.status(409).json({ error: '目标文件名已存在' });
    }
    log('ERROR', '重命名附件失败', {
      username: req.user,
      oldName: req.params.filename,
      newName: req.body?.newName,
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: '重命名失败' });
  }
});

router.get('/api/attachments/check-invalid', async (req, res) => {
  try {
    const count = await attachmentService.countInvalidAttachmentRefs(req.user);
    res.json({ count });
  } catch {
    res.status(500).json({ error: '检测失败' });
  }
});

router.post('/api/attachments/fix-paths', async (req, res) => {
  try {
    const { findText, replaceText } = req.body;
    if (!findText) {
      return res.status(400).json({ error: '请输入要查找的文本' });
    }
    if (!replaceText) {
      return res.status(400).json({ error: '请输入要替换的文本' });
    }

    const count = await attachmentService.fixAttachmentPaths(req.user, findText, replaceText);
    res.json({ count, message: `已替换 ${count} 条笔记中的内容` });
  } catch (error) {
    log('ERROR', '批量替换失败', { username: req.user, error: error.message });
    res.status(500).json({ error: '替换失败' });
  }
});

router.post('/api/purge-attachments', async (req, res) => {
  try {
    const deletedCount = await attachmentService.purgeUnusedAttachments(req.user);
    log('INFO', '清理附件成功', { username: req.user, deletedCount });
    res.json({ status: 'ok', deletedCount });
  } catch (error) {
    log('ERROR', '清理附件失败', { username: req.user, error: error.message, stack: error.stack });
    res.status(500).json({ error: '服务器内部错误' });
  }
});

router.post('/api/upload/create-session', async (req, res) => {
  try {
    const { filename, totalSize, mimeType } = req.body;
    if (!filename || !totalSize) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    const session = await attachmentService.createChunkUploadSession(req.user, filename, totalSize, mimeType);
    res.json(session);
  } catch (error) {
    if (error.message.startsWith('FILE_TOO_LARGE:')) {
      const [, maxFileSize] = error.message.split(':');
      return res.status(400).json({ error: `文件大小超出限制 (最大: ${Number(maxFileSize) / 1024 / 1024}MB)` });
    }
    if (error.message.startsWith('INVALID_FILE_TYPE:')) {
      return res.status(400).json({ error: error.message.slice('INVALID_FILE_TYPE:'.length) });
    }
    log('ERROR', '创建上传会话失败', { username: req.user, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/upload/chunk', createChunkUploadLimitMiddleware((uploadId, username) => chunkUploadService.getUploadSession(uploadId, username)), async (req, res) => {
  try {
    const uploadId = req.headers.uploadid || req.headers.uploadId;
    const chunkIndex = req.headers.chunkindex || req.headers.chunkIndex;

    if (!uploadId || chunkIndex === undefined) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: '无法读取分片数据' });
    }
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: '分片数据为空' });
    }

    const result = await chunkUploadService.uploadChunk(uploadId, req.user, parseInt(chunkIndex, 10), req.body);
    res.json(result);
  } catch (error) {
    log('ERROR', '上传分片失败', { username: req.user, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/upload/status/:uploadId', async (req, res) => {
  try {
    const status = await chunkUploadService.getUploadStatus(req.params.uploadId, req.user);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/upload/merge', async (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) {
      return res.status(400).json({ error: '缺少 uploadId' });
    }

    const result = await chunkUploadService.mergeChunks(uploadId, req.user);
    res.json(result);
  } catch (error) {
    log('ERROR', '合并分片失败', { username: req.user, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.delete('/api/upload/:uploadId', async (req, res) => {
  try {
    await chunkUploadService.cancelUpload(req.params.uploadId, req.user);
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/upload/sessions', async (req, res) => {
  try {
    const sessions = await chunkUploadService.getUserUploadSessions(req.user);
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/attachments/raw/:filename(*)', async (req, res) => {
  try {
    const { filename, filePath } = attachmentService.resolveRawAttachment(req.user, req.params.filename || '');

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).send('Not found');
    }

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");

    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    log('INFO', '附件原始文件发送', {
      username: req.user,
      filename,
      filePath,
      frameOptions: res.getHeader('X-Frame-Options')
    });

    return res.sendFile(filePath);
  } catch (error) {
    if (error.message === 'MISSING_FILENAME') {
      log('WARN', '附件原始访问缺少文件名', {
        event: ATTACHMENT_EVENTS.RAW_INVALID_FILENAME,
        username: req.user
      });
      return res.status(400).send('Invalid filename');
    }
    if (error.message === 'INVALID_FILENAME') {
      log('WARN', '附件原始访问文件名非法', {
        event: ATTACHMENT_EVENTS.RAW_INVALID_FILENAME,
        username: req.user,
        filename: req.params.filename
      });
      return res.status(400).send('Invalid filename');
    }
    if (error.message === 'BAD_PATH') {
      log('WARN', '附件原始访问路径越界', {
        event: ATTACHMENT_EVENTS.RAW_BAD_PATH,
        username: req.user,
        filename: req.params.filename
      });
      return res.status(400).send('Bad request');
    }
    log('ERROR', '附件原始访问异常', {
      event: ATTACHMENT_EVENTS.RAW_SERVER_ERROR,
      username: req.user,
      error: error.message,
      stack: error.stack
    });
    return res.status(500).send('Server error');
  }
});

router.get('/api/attachments/test-headers', (req, res) => {
  res.json({
    message: '测试响应头',
    headers: {
      'X-Frame-Options': res.getHeader('X-Frame-Options'),
      'Content-Security-Policy': res.getHeader('Content-Security-Policy')
    }
  });
});

module.exports = router;
