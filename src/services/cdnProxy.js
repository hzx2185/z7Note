// CDN 代理服务 - 缓存外部资源到本地
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const config = require('../config');

// CDN 基础 URL（可配置）
let CDN_BASE_URL = 'https://cdn.bootcdn.net/ajax/libs';

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
    console.log('[CDN Proxy] 缓存目录已创建:', CACHE_DIR);
  } catch (err) {
    console.error('[CDN Proxy] 创建缓存目录失败:', err);
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
async function updateResource(resource) {
  const localPath = path.join(CACHE_DIR, resource.localPath);
  const url = typeof resource.url === 'function' ? resource.url() : resource.url;

  try {
    // 检查是否需要更新
    const needsUpdate = !(await isFileValid(localPath));
    if (!needsUpdate) {
      console.log(`[CDN Proxy] ${resource.name} 已是最新，跳过`);
      return true;
    }

    console.log(`[CDN Proxy] 正在下载 ${resource.name}...`);
    await downloadFile(url, localPath);
    console.log(`[CDN Proxy] ${resource.name} 下载成功`);
    return true;
  } catch (err) {
    console.error(`[CDN Proxy] ${resource.name} 下载失败:`, err.message);
    return false;
  }
}

// 更新所有资源
async function updateAllResources() {
  console.log('[CDN Proxy] 开始更新 CDN 资源...');
  await initCacheDir();

  let successCount = 0;
  let failCount = 0;

  for (const resource of CDN_RESOURCES) {
    const success = await updateResource(resource);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log(`[CDN Proxy] 更新完成: 成功 ${successCount}, 失败 ${failCount}`);
  return { successCount, failCount };
}

// Express 中间件 - 代理 CDN 请求
function createProxyMiddleware() {
  return async (req, res, next) => {
    const fileName = req.params.file;

    console.log(`[CDN Proxy] 收到请求: /cdn/${fileName}`);

    // 处理 source map 文件请求
    if (fileName.endsWith('.map')) {
      const baseFileName = fileName.replace('.map', '');
      const resource = CDN_RESOURCES.find(r => r.localPath === baseFileName);

      if (resource) {
        const mapUrl = typeof resource.url === 'function' ? resource.url() + '.map' : resource.url + '.map';
        const protocol = mapUrl.startsWith('https') ? https : http;

        console.log(`[CDN Proxy] 处理 source map: ${mapUrl}`);

        protocol.get(mapUrl, (mapRes) => {
          if (mapRes.statusCode === 200) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            mapRes.pipe(res);
          } else {
            console.error(`[CDN Proxy] Source map 下载失败: ${mapRes.statusCode}`);
            res.status(404).send('Source map not found');
          }
        }).on('error', (err) => {
          console.error(`[CDN Proxy] Source map 请求错误:`, err);
          res.status(404).send('Source map not found');
        });
        return;
      }
    }

    const resource = CDN_RESOURCES.find(r => r.localPath === fileName);

    if (!resource) {
      console.log(`[CDN Proxy] 资源未找到: ${fileName}`);
      return next();
    }

    const localPath = path.join(CACHE_DIR, resource.localPath);

    try {
      // 检查文件是否存在
      const exists = await fs.access(localPath).then(() => true).catch(() => false);

      if (!exists) {
        console.log(`[CDN Proxy] ${resource.name} 不存在，开始下载...`);
        await updateResource(resource);
      }

      // 检查文件是否过期
      const valid = await isFileValid(localPath);
      if (!valid) {
        console.log(`[CDN Proxy] ${resource.name} 已过期，后台更新...`);
        // 异步更新，不阻塞请求
        updateResource(resource).catch(err => {
          console.error(`[CDN Proxy] 后台更新失败:`, err.message);
        });
      }

      // 设置正确的 Content-Type
      const contentType = fileName.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8';
      res.setHeader('Content-Type', contentType);

      // 设置缓存策略（短期缓存，允许验证）
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');

      // 读取文件并手动发送，避免 res.sendFile 的问题
      const fileContent = await fs.readFile(localPath);
      res.setHeader('Content-Length', fileContent.length);
      res.send(fileContent);

      console.log(`[CDN Proxy] ${resource.name} 服务成功 (${(fileContent.length / 1024).toFixed(2)}KB)`);
    } catch (err) {
      console.error(`[CDN Proxy] 服务 ${resource.name} 失败:`, err);
      console.error(`[CDN Proxy] 错误堆栈:`, err.stack);
      res.status(500).json({ error: 'CDN 资源加载失败', file: fileName, message: err.message });
    }
  };
}

// 定时更新任务（每天凌晨3点）
function setupAutoUpdate() {
  const cron = require('node-cron');

  cron.schedule('0 3 * * *', async () => {
    console.log('[CDN Proxy] 定时任务开始执行...');
    await updateAllResources();
  });

  console.log('[CDN Proxy] 定时更新任务已设置（每天凌晨3点）');
}

// 获取当前 CDN 基础 URL
function getCDNBaseUrl() {
  return CDN_BASE_URL;
}

// 设置 CDN 基础 URL
function setCDNBaseUrl(url) {
  CDN_BASE_URL = url;
  console.log('[CDN Proxy] CDN 基础 URL 已更新为:', CDN_BASE_URL);
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

    console.log(`[CDN Proxy] 清理缓存完成: 删除 ${deletedCount} 个文件`);
    return { success: true, deletedCount };
  } catch (err) {
    console.error(`[CDN Proxy] 清理缓存失败:`, err);
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
