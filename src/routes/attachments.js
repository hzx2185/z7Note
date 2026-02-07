const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { getConnection } = require('../db/connection');
const { getUserFileSize, formatSize } = require('../utils/helpers');
const config = require('../config');
const { uploadRateLimit } = require('../middleware/rateLimit');
const { dynamicUploadRateLimit, createFileBasedUploadLimitMiddleware } = require('../utils/dynamicRateLimiter');
const { getSystemConfig, getAllowedFileTypes, getMaxFileSize } = require('../services/systemConfig');
const { compressImage } = require('../services/imageCompression');
const chunkUploadService = require('../services/chunkUpload');
const log = require('../utils/logger');

const router = express.Router();

// 文件类型验证中间件
async function fileFilter(req, file, cb) {
  try {
    const allowedTypes = await getAllowedFileTypes();
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      console.log('[上传] 文件类型不被支持:', file.mimetype, file.originalname);
      cb(new Error(`不支持的文件类型: ${file.mimetype}，请检查文件格式或联系管理员添加支持`), false);
    }
  } catch (error) {
    console.error('文件类型验证失败:', error);
    cb(null, true); // 验证失败时允许上传（兼容性）
  }
}

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const p = path.join(config.paths.uploads, req.user || 'temp');
    await fs.mkdir(p, { recursive: true });
    cb(null, p);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(-4)}${path.extname(file.originalname)}`)
});

// 使用动态限流和文件类型过滤
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxFileSize * 1024 * 1024 // 从环境变量读取
  }
});

// 获取附件列表
router.get('/api/attachments', async (req, res) => {
  try {
    const userDirPath = path.join(config.paths.uploads, req.user);
    try { await fs.access(userDirPath); } catch { return res.json([]); }

    const files = await fs.readdir(userDirPath);
    const fileList = await Promise.all(files.map(async (file) => {
      const stats = await fs.stat(path.join(userDirPath, file));
      const sizeBytes = stats.size;
      return {
        id: file,
        name: file,
        size: formatSize(sizeBytes),
        sizeBytes: sizeBytes,
        time: stats.mtime,
        url: `/api/attachments/raw/${file}`
      };
    }));
    res.json(fileList.sort((a, b) => b.time - a.time));
  } catch (e) {
    console.error('获取附件列表失败:', e);
    res.status(500).json({ error: "获取列表失败" });
  }
});

// Multer 错误处理中间件
const multerErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `文件大小超过限制` });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: `文件上传错误` });
    }
    return res.status(400).json({ error: `文件上传错误: ${err.message}` });
  } else if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: '服务器内部错误' });
};

// 上传附件
router.post('/api/upload', createFileBasedUploadLimitMiddleware(), upload.single('file'), multerErrorHandler, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未接收到文件" });

  const filename = req.file.filename;
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    await fs.unlink(req.file.path).catch(()=>{});
    return res.status(400).json({ error: "无效的文件名" });
  }

  try {
    const user = await getConnection().get('SELECT fileLimit FROM users WHERE username = ?', [req.user]);
    const limitMB = parseFloat(user?.fileLimit || 0);
    if (limitMB <= 0) {
      await fs.unlink(req.file.path).catch(()=>{});
      return res.status(403).json({ error: `上传失败：您的附件配额为 0MB` });
    }

    const currentSizeBytes = await getUserFileSize(req.user);
    if (currentSizeBytes / 1024 / 1024 >= limitMB) {
      await fs.unlink(req.file.path).catch(()=>{});
      return res.status(403).json({ error: `超出附件配额 (已用:${(currentSizeBytes / 1024 / 1024).toFixed(2)}MB / 上限:${limitMB}MB)` });
    }

    // 检查单个文件大小限制（动态获取）
    const maxFileSize = await getMaxFileSize();
    if (req.file.size > maxFileSize) {
      await fs.unlink(req.file.path).catch(()=>{});
      return res.status(400).json({ error: `单个文件大小不能超过${maxFileSize / 1024 / 1024}MB` });
    }

    // 图片压缩
    let compressionResult = null;
    const isImage = req.file.mimetype.startsWith('image/');
    if (isImage && !req.file.originalname.endsWith('.svg')) {
      const imageBuffer = await fs.readFile(req.file.path);
      compressionResult = await compressImage(imageBuffer, req.file.mimetype);

      if (compressionResult.compressed) {
        await fs.writeFile(req.file.path, compressionResult.buffer);
        log('INFO', '图片压缩成功', {
          username: req.user,
          filename,
          originalSize: compressionResult.originalSize,
          compressedSize: compressionResult.compressedSize,
          compressionRatio: compressionResult.compressionRatio
        });
      }
    }

    log('INFO', '附件上传成功', {
      username: req.user,
      filename,
      size: req.file.size,
      compressed: compressionResult?.compressed
    });

    res.json({
      url: `/api/attachments/raw/${req.file.filename}`,
      compressionResult
    });
  } catch (err) {
    log('ERROR', '上传拦截器异常', { error: err.message, stack: err.stack });
    if (req.file?.path) await fs.unlink(req.file.path).catch(()=>{});
    res.status(500).json({ error: "上传失败: " + err.message });
  }
});

// 删除附件
router.delete('/api/attachments/:filename(*)', async (req, res) => {
  try {
    let filename = req.params.filename;
    if (!filename) {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "缺少文件名或ID" });
      filename = typeof id === 'string' && id.includes('/') ? id.split('/').pop() : id;
    }

    const safeFilename = path.normalize(filename).replace(/^(\.\.(\/|\\|$))+/, '');
    if (safeFilename !== filename) {
      return res.status(400).json({ error: "文件名包含非法字符" });
    }

    const filePath = path.join(config.paths.uploads, req.user, safeFilename);
    await fs.unlink(filePath);
    log('INFO', '附件删除成功', { username: req.user, filename: safeFilename });
    res.json({ status: "ok", filename: safeFilename });
  } catch (e) {
    console.error('删除附件失败:', e);
    res.status(500).json({ error: "删除失败" });
  }
});

// 重命名附件
router.put('/api/attachments/:filename(*)', async (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName || typeof newName !== 'string') return res.status(400).json({ error: "新文件名不能为空" });

    const safeOldName = path.normalize(req.params.filename).replace(/^(\.\.(\/|\\|$))+/, '');
    const safeNewName = path.normalize(newName).replace(/^(\.\.(\/|\\|$))+/, '');

    if (safeOldName !== req.params.filename || safeNewName !== newName) {
      return res.status(400).json({ error: "文件名包含非法字符" });
    }

    const oldFilePath = path.join(config.paths.uploads, req.user, safeOldName);
    const newFilePath = path.join(config.paths.uploads, req.user, safeNewName);

    try {
      await fs.access(oldFilePath);
    } catch (e) {
      return res.status(404).json({ error: "原文件不存在" });
    }
    try {
      await fs.access(newFilePath);
      return res.status(409).json({ error: "目标文件名已存在" });
    } catch (e) {
      // 目标文件不存在，可以继续
    }

    await fs.rename(oldFilePath, newFilePath);
    log('INFO', '附件重命名成功', { username: req.user, oldName: safeOldName, newName: safeNewName });
    res.json({ status: "ok", oldName: safeOldName, newName: safeNewName, url: `/api/attachments/raw/${safeNewName}` });
  } catch (e) {
    console.error("重命名附件失败:", e);
    res.status(500).json({ error: "重命名失败" });
  }
});

// 检测无效附件
router.get('/api/attachments/check-invalid', async (req, res) => {
  try {
    const notes = await getConnection().all('SELECT id, content FROM notes WHERE username = ?', [req.user]);
    let count = 0;
    for (const note of notes) {
      if (note.content && note.content.includes('/api/uploads/')) {
        count++;
      }
    }
    res.json({ count });
  } catch (e) { res.status(500).json({ error: "检测失败" }); }
});

// 批量修复附件路径
router.post('/api/attachments/fix-paths', async (req, res) => {
  try {
    const { findText, replaceText } = req.body;
    if (!findText) return res.status(400).json({ error: "请输入要查找的文本" });
    if (!replaceText) return res.status(400).json({ error: "请输入要替换的文本" });

    const notes = await getConnection().all('SELECT id, content FROM notes WHERE username = ?', [req.user]);
    let count = 0;
    for (const note of notes) {
      if (note.content && note.content.includes(findText)) {
        const newContent = note.content.split(findText).join(replaceText);
        if (newContent !== note.content) {
          await getConnection().run('UPDATE notes SET content = ?, updatedAt = ? WHERE id = ?',
            [newContent, Date.now(), note.id]);
          count++;
        }
      }
    }
    res.json({ count, message: `已替换 ${count} 条笔记中的内容` });
  } catch (e) {
    log('ERROR', '批量替换失败', { error: e.message });
    res.status(500).json({ error: "替换失败" });
  }
});

// 清理未使用附件
router.post('/api/purge-attachments', async (req, res) => {
  try {
    let deletedCount = 0;
    const userDirPath = path.join(config.paths.uploads, req.user);
    try { await fs.access(userDirPath); } catch (e) { return res.json({ status: "ok", deletedCount: 0 }); }

    const files = await fs.readdir(userDirPath);
    const notes = await getConnection().all('SELECT content FROM notes WHERE username = ?', [req.user]);
    const allContent = notes.map(n => n.content || "").join(' ');

    for (const file of files) {
      const filePath = path.join(userDirPath, file);
      const stats = await fs.stat(filePath);
      if (!stats.isFile() || allContent.includes(file)) continue;
      await fs.unlink(filePath);
      deletedCount++;
    }
    log('INFO', '清理附件成功', { username: req.user, deletedCount });
    res.json({ status: "ok", deletedCount });
  } catch (e) { 
    console.error("清理附件失败:", e); 
    res.status(500).json({ error: "服务器内部错误" }); 
  }
});

// ============ 分片上传相关接口 ============

// 创建分片上传会话
router.post('/api/upload/create-session', async (req, res) => {
  try {
    const { filename, totalSize } = req.body;

    if (!filename || !totalSize) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 检查文件大小限制
    const maxFileSize = await getMaxFileSize();
    if (totalSize > maxFileSize) {
      return res.status(400).json({
        error: `文件大小超出限制 (最大: ${maxFileSize / 1024 / 1024}MB)`
      });
    }

    // 获取分片大小配置
    const chunkSizeMB = parseInt(await getSystemConfig('chunkSize')) || config.chunkUpload.chunkSize;
    const chunkSize = chunkSizeMB * 1024 * 1024;

    const session = await chunkUploadService.createUploadSession(
      req.user,
      filename,
      totalSize,
      chunkSize
    );

    res.json(session);
  } catch (err) {
    log('ERROR', '创建上传会话失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 上传分片 - 使用原始请求体
router.post('/api/upload/chunk', createFileBasedUploadLimitMiddleware(), async (req, res) => {
  try {
    // Express 会将请求头转换为小写
    const uploadId = req.headers['uploadid'] || req.headers['uploadId'];
    const chunkIndex = req.headers['chunkindex'] || req.headers['chunkIndex'];

    if (!uploadId || chunkIndex === undefined) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    // 获取二进制数据
    let chunkData;

    if (Buffer.isBuffer(req.body)) {
      chunkData = req.body;
    } else {
      return res.status(400).json({ error: '无法读取分片数据' });
    }

    if (!chunkData || chunkData.length === 0) {
      return res.status(400).json({ error: '分片数据为空' });
    }

    const result = await chunkUploadService.uploadChunk(
      uploadId,
      parseInt(chunkIndex),
      chunkData
    );

    res.json(result);
  } catch (err) {
    log('ERROR', '上传分片失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 获取上传状态
router.get('/api/upload/status/:uploadId', async (req, res) => {
  try {
    const status = await chunkUploadService.getUploadStatus(req.params.uploadId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 合并分片
router.post('/api/upload/merge', async (req, res) => {
  try {
    const { uploadId } = req.body;

    if (!uploadId) {
      return res.status(400).json({ error: '缺少 uploadId' });
    }

    const result = await chunkUploadService.mergeChunks(uploadId, req.user);
    res.json(result);
  } catch (err) {
    log('ERROR', '合并分片失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 取消上传
router.delete('/api/upload/:uploadId', async (req, res) => {
  try {
    await chunkUploadService.cancelUpload(req.params.uploadId, req.user);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取用户的上传会话列表
router.get('/api/upload/sessions', async (req, res) => {
  try {
    const sessions = await chunkUploadService.getUserUploadSessions(req.user);
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 传统上传接口 ============

// 获取附件原始文件
router.get('/api/attachments/raw/:filename(*)', async (req, res) => {
  try {
    const filename = req.params.filename || '';
    if (!filename) return res.status(400).send('Invalid filename');

    const safeFilename = path.normalize(filename).replace(/^\.\.\//, '').replace(/^\.\.\\/, '');
    if (safeFilename !== filename) {
      return res.status(400).send('Invalid filename');
    }

    const filePath = path.join(config.paths.uploads, req.user, safeFilename);

    if (!path.resolve(filePath).startsWith(path.resolve(config.paths.uploads))) {
      return res.status(400).send('Bad request');
    }

    try { await fs.access(filePath); } catch (err) { return res.status(404).send('Not found'); }
    return res.sendFile(filePath);
  } catch (err) { 
    console.error('[attachments/raw] error', err); 
    return res.status(500).send('Server error'); 
  }
});

module.exports = router;
