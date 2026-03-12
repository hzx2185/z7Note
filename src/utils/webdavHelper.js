const { createClient } = require('webdav');
const log = require('./logger');

/**
 * WebDAV 通用操作工具类
 */
class WebDAVHelper {
  /**
   * 获取 WebDAV 客户端实例
   */
  static getClient(url, username, password) {
    if (!url) return null;
    return createClient(url, {
      username: username || '',
      password: password || ''
    });
  }

  /**
   * 递归确保目录存在
   * @param {Object} client WebDAV 客户端
   * @param {string} dirPath 目录路径
   */
  static async ensureDirectory(client, dirPath) {
    const parts = dirPath.split('/').filter(p => p);
    let currentPath = '';

    for (const part of parts) {
      currentPath += '/' + part;
      try {
        await client.createDirectory(currentPath);
      } catch (e) {
        // 405 Method Not Allowed 或 409 Conflict 通常意味着目录已存在
        if (!e.message.includes('405') && !e.message.includes('409')) {
          throw e;
        }
      }
    }
  }

  /**
   * 上传文件（支持 Buffer 或 Stream）
   */
  static async uploadFile(client, remotePath, content) {
    try {
      await client.putFileContents(remotePath, content);
      return true;
    } catch (e) {
      log('ERROR', 'WebDAV 上传失败', { path: remotePath, error: e.message });
      throw e;
    }
  }

  /**
   * 清理旧备份文件
   * @param {Object} client WebDAV 客户端
   * @param {string} remoteDir 远程目录
   * @param {string} prefix 文件名前缀过滤器
   * @param {number} keepCount 保留数量
   */
  static async cleanupOldFiles(client, remoteDir, prefix, keepCount) {
    if (!keepCount || keepCount <= 0) return;

    try {
      const items = await client.getDirectoryContents(remoteDir);
      const files = items
        .filter(item => item.type === 'file' && (!prefix || item.basename.startsWith(prefix)))
        .map(item => ({
          name: item.basename,
          path: item.filename,
          time: item.lastmod ? new Date(item.lastmod) : new Date(item.timestamp)
        }));

      // 按时间倒序排序（最新的在前）
      files.sort((a, b) => b.time - a.time);

      if (files.length > keepCount) {
        const toDelete = files.slice(keepCount);
        for (const file of toDelete) {
          try {
            await client.deleteFile(file.path);
            log('INFO', 'WebDAV 清理旧文件成功', { file: file.name });
          } catch (e) {
            log('ERROR', 'WebDAV 清理文件失败', { file: file.name, error: e.message });
          }
        }
      }
    } catch (e) {
      log('ERROR', 'WebDAV 清理流程异常', { dir: remoteDir, error: e.message });
    }
  }
}

module.exports = WebDAVHelper;
