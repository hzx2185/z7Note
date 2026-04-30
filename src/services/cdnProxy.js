// CDN 代理服务 - 缓存外部资源到本地
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../config');
const log = require('../utils/logger');

// CDN 基础 URL（可配置）
let CDN_BASE_URL = 'https://cdn.bootcdn.net/ajax/libs';
const ALLOWED_CDN_HOSTS = new Set([
  'cdn.bootcdn.net',
  'cdnjs.cloudflare.com',
  'unpkg.com'
]);
let allResourcesUpdatePromise = null;
const resourceUpdatePromises = new Map();

// CDN 资源配置
const CDN_RESOURCES = [
  {
    name: 'marked',
    url: () => `${CDN_BASE_URL}/marked/12.0.1/marked.min.js`,
    localPath: 'marked.min.js'
  },
  {
    name: 'highlight.js',
    url: () => `${CDN_BASE_URL}/highlight.js/11.9.0/highlight.min.js`,
    localPath: 'highlight.min.js'
  },
  {
    name: 'localforage',
    url: () => `${CDN_BASE_URL}/localforage/1.10.0/localforage.min.js`,
    localPath: 'localforage.min.js'
  },
  {
    name: 'html2pdf',
    url: () => `${CDN_BASE_URL}/html2pdf.js/0.10.1/html2pdf.bundle.min.js`,
    localPath: 'html2pdf.bundle.min.js'
  },
  {
    name: 'codemirror',
    url: () => `${CDN_BASE_URL}/codemirror/5.65.13/codemirror.min.js`,
    localPath: 'codemirror.min.js'
  },
  {
    name: 'codemirror-markdown',
    url: () => `${CDN_BASE_URL}/codemirror/5.65.13/mode/markdown/markdown.min.js`,
    localPath: 'codemirror-markdown.min.js'
  },
  {
    name: 'codemirror-javascript',
    url: () => `${CDN_BASE_URL}/codemirror/5.65.13/mode/javascript/javascript.min.js`,
    localPath: 'codemirror-javascript.min.js'
  },
  {
    name: 'codemirror-css',
    url: () => `${CDN_BASE_URL}/codemirror/5.65.13/mode/css/css.min.js`,
    localPath: 'codemirror-css.min.js'
  },
  {
    name: 'codemirror-xml',
    url: () => `${CDN_BASE_URL}/codemirror/5.65.13/mode/xml/xml.min.js`,
    localPath: 'codemirror-xml.min.js'
  },
  {
    name: 'codemirror-closebrackets',
    url: () => `${CDN_BASE_URL}/codemirror/5.65.13/addon/edit/closebrackets.min.js`,
    localPath: 'codemirror-closebrackets.min.js'
  },
  {
    name: 'codemirror-matchbrackets',
    url: () => `${CDN_BASE_URL}/codemirror/5.65.13/addon/edit/matchbrackets.min.js`,
    localPath: 'codemirror-matchbrackets.min.js'
  },
  {
    name: 'highlight.js-css-dark',
    url: () => `${CDN_BASE_URL}/highlight.js/11.9.0/styles/github-dark.min.css`,
    localPath: 'highlight-dark.min.css'
  },
  {
    name: 'highlight.js-css-light',
    url: () => `${CDN_BASE_URL}/highlight.js/11.9.0/styles/github.min.css`,
    localPath: 'highlight-light.min.css'
  },
  {
    name: 'github-markdown-css',
    url: () => `${CDN_BASE_URL}/github-markdown-css/5.6.0/github-markdown.min.css`,
    localPath: 'github-markdown.min.css'
  },
  {
    name: 'codemirror-css',
    url: () => `${CDN_BASE_URL}/codemirror/5.65.13/codemirror.min.css`,
    localPath: 'codemirror.min.css'
  }
];

// 缓存目录
const CACHE_DIR = path.join(config.paths.data, 'cdn-cache');

// 初始化缓存目录
async function initCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (err) {
    log('ERROR', '创建 CDN 缓存目录失败', { cacheDir: CACHE_DIR, error: err.message, stack: err.stack });
  }
}

// 下载文件
function downloadFile(url, localPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = require('fs').createWriteStream(localPath);

    // 设置超时
    const timeout = setTimeout(() => {
      file.destroy();
      fs.unlink(localPath).catch(() => {});
      reject(new Error('下载超时（30秒）'));
    }, 30000); // 30秒超时

    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        clearTimeout(timeout);
        file.destroy();
        fs.unlink(localPath).catch(() => {});
        reject(new Error(`下载失败: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        clearTimeout(timeout);
        file.close();
        resolve();
      });

      file.on('error', (err) => {
        clearTimeout(timeout);
        fs.unlink(localPath).catch(() => {});
        reject(err);
      });
    }).on('error', (err) => {
      clearTimeout(timeout);
      file.destroy();
      fs.unlink(localPath).catch(() => {});
      reject(new Error(`网络请求失败: ${err.message}`));
    });
  });
}

// 检查文件是否存在且有效（7天内）
async function isFileValid(localPath) {
  try {
    const stats = await fs.stat(localPath);
    const age = Date.now() - stats.mtimeMs;
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7天
    return age < maxAge;
  } catch (err) {
    return false;
  }
}

// 更新单个资源
async function updateResource(resource, options = {}) {
  const localPath = path.join(CACHE_DIR, resource.localPath);
  const url = typeof resource.url === 'function' ? resource.url() : resource.url;
  const cacheKey = resource.localPath;

  if (resourceUpdatePromises.has(cacheKey)) {
    return resourceUpdatePromises.get(cacheKey);
  }

  const updatePromise = (async () => {
    await initCacheDir();

    try {
      // 检查是否需要更新
      const needsUpdate = options.force === true || !(await isFileValid(localPath));
      if (!needsUpdate) {
        return {
          success: true,
          updated: false,
          resource: resource.name
        };
      }

      await downloadFile(url, localPath);
      return {
        success: true,
        updated: true,
        resource: resource.name
      };
    } catch (err) {
      log('ERROR', 'CDN 资源下载失败', { resource: resource.name, url, error: err.message });
      return {
        success: false,
        updated: false,
        resource: resource.name,
        error: err.message
      };
    }
  })();

  resourceUpdatePromises.set(cacheKey, updatePromise);

  try {
    return await updatePromise;
  } finally {
    resourceUpdatePromises.delete(cacheKey);
  }
}

// 更新所有资源
async function updateAllResources() {
  if (allResourcesUpdatePromise) {
    return allResourcesUpdatePromise;
  }

  allResourcesUpdatePromise = (async () => {
    await initCacheDir();

    let successCount = 0;
    let failCount = 0;
    let updatedCount = 0;
    const failureSamples = [];

    for (const resource of CDN_RESOURCES) {
      const result = await updateResource(resource);
      if (result.success) {
        successCount++;
        if (result.updated) {
          updatedCount++;
        }
        continue;
      }

      failCount++;
      if (failureSamples.length < 5) {
        failureSamples.push({
          resource: resource.name,
          error: result.error
        });
      }
    }

    log(failCount > 0 ? 'WARN' : 'INFO', 'CDN 资源更新完成', {
      successCount,
      failCount,
      updatedCount,
      failureSamples: failureSamples.length > 0 ? failureSamples : undefined
    });

    return { successCount, failCount, updatedCount };
  })();

  try {
    return await allResourcesUpdatePromise;
  } finally {
    allResourcesUpdatePromise = null;
  }
}

// Express 中间件 - 代理 CDN 请求
function createProxyMiddleware() {
  return async (req, res, next) => {
    const fileName = req.params.file;

    // 处理 source map 文件请求
    if (fileName.endsWith('.map')) {
      const baseFileName = fileName.replace('.map', '');
      const resource = CDN_RESOURCES.find(r => r.localPath === baseFileName);

      if (resource) {
        const mapUrl = typeof resource.url === 'function' ? resource.url() + '.map' : resource.url + '.map';
        const protocol = mapUrl.startsWith('https') ? https : http;

        protocol.get(mapUrl, (mapRes) => {
          if (mapRes.statusCode === 200) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            mapRes.pipe(res);
          } else {
            res.status(404).send('Source map not found');
          }
        }).on('error', (err) => {
          res.status(404).send('Source map not found');
        });
        return;
      }
    }

    const resource = CDN_RESOURCES.find(r => r.localPath === fileName);

    if (!resource) {
      return next();
    }

    const localPath = path.join(CACHE_DIR, resource.localPath);

    try {
      // 检查文件是否存在
      const exists = await fs.access(localPath).then(() => true).catch(() => false);

      if (!exists) {
        const result = await updateResource(resource);
        if (!result.success) {
          return res.status(502).json({ error: 'CDN 资源加载失败', file: fileName, message: result.error });
        }
      }

      // 检查文件是否过期
      const valid = await isFileValid(localPath);
      if (!valid && !resourceUpdatePromises.has(resource.localPath)) {
        // 异步更新，不阻塞请求
        updateResource(resource).then(result => {
          if (!result.success) {
            log('ERROR', 'CDN 后台更新失败', { resource: resource.name, fileName, error: result.error });
          }
        }).catch(error => {
          log('ERROR', 'CDN 后台更新失败', { resource: resource.name, fileName, error: error.message });
        });
      }

      // 设置正确的 Content-Type
      const contentType = fileName.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
      res.setHeader('Content-Type', contentType);

      // 设置缓存策略（长期缓存，允许验证）
      res.setHeader('Cache-Control', 'public, max-age=604800, must-revalidate');

      // 读取文件并手动发送，避免 res.sendFile 的问题
      const fileContent = await fs.readFile(localPath);
      res.setHeader('Content-Length', fileContent.length);
      res.send(fileContent);
    } catch (err) {
      log('ERROR', 'CDN 资源服务失败', {
        resource: resource.name,
        fileName,
        error: err.message,
        stack: err.stack
      });
      res.status(500).json({ error: 'CDN 资源加载失败', file: fileName, message: err.message });
    }
  };
}

// 定时更新任务（每天凌晨3点）
function setupAutoUpdate() {
  const cron = require('node-cron');

  cron.schedule('0 3 * * *', async () => {
    await updateAllResources();
  });

  log('INFO', 'CDN 定时更新任务已设置', { schedule: '0 3 * * *' });
}

// 获取当前 CDN 基础 URL
function getCDNBaseUrl() {
  return CDN_BASE_URL;
}

// 设置 CDN 基础 URL
function setCDNBaseUrl(url) {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('CDN 地址不能为空');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url.trim());
  } catch (error) {
    throw new Error('CDN 地址格式无效');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('CDN 地址必须使用 HTTPS');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('CDN 地址不允许包含认证信息');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (!ALLOWED_CDN_HOSTS.has(hostname)) {
    throw new Error('CDN 地址不在允许名单中');
  }

  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('CDN 地址不允许指向本地网络');
  }

  CDN_BASE_URL = parsedUrl.toString().replace(/\/+$/, '');
  log('INFO', 'CDN 基础 URL 已更新', { baseUrl: CDN_BASE_URL });
}

// 获取 CDN 资源状态
async function getCDNStatus() {
  const status = [];
  for (const resource of CDN_RESOURCES) {
    const localPath = path.join(CACHE_DIR, resource.localPath);
    try {
      const stats = await fs.stat(localPath);
      status.push({
        name: resource.name,
        file: resource.localPath,
        size: stats.size,
        lastModified: stats.mtime,
        isValid: await isFileValid(localPath)
      });
    } catch (err) {
      status.push({
        name: resource.name,
        file: resource.localPath,
        error: '文件不存在'
      });
    }
  }
  return status;
}

// 清理缓存
async function clearCache() {
  try {
    const files = await fs.readdir(CACHE_DIR);
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(CACHE_DIR, file);
      await fs.unlink(filePath);
      deletedCount++;
    }

    log('INFO', 'CDN 缓存清理完成', { deletedCount });
    return { success: true, deletedCount };
  } catch (err) {
    log('ERROR', 'CDN 缓存清理失败', { error: err.message, stack: err.stack });
    throw err;
  }
}

module.exports = {
  initCacheDir,
  updateAllResources,
  createProxyMiddleware,
  setupAutoUpdate,
  getCDNBaseUrl,
  setCDNBaseUrl,
  getCDNStatus,
  clearCache,
  CDN_RESOURCES
};
