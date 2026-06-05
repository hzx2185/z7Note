const { spawn } = require('child_process');
const packageInfo = require('../../package.json');
const log = require('../utils/logger');

const DEFAULT_GITHUB_REPO = 'hzx2185/z7Note';
const DEFAULT_DOCKER_IMAGE = 'hzx2185/z7note';
const REMOTE_CACHE_MS = 10 * 60 * 1000;
const REMOTE_FETCH_TIMEOUT_MS = 8000;
const DOCKER_MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json'
].join(', ');

let remoteCache = null;
let updateState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  pid: null,
  code: null,
  signal: null,
  targetVersion: null,
  error: null
};

function trimEnv(name) {
  return typeof process.env[name] === 'string' ? process.env[name].trim() : '';
}

function getGithubRepo() {
  return trimEnv('Z7NOTE_GITHUB_REPO') || trimEnv('APP_GITHUB_REPO') || DEFAULT_GITHUB_REPO;
}

function getDockerImage() {
  return trimEnv('Z7NOTE_DOCKER_IMAGE') || trimEnv('APP_DOCKER_IMAGE') || DEFAULT_DOCKER_IMAGE;
}

function getUpdateCommand() {
  return trimEnv('Z7NOTE_UPDATE_COMMAND') || trimEnv('APP_UPDATE_COMMAND');
}

function getLocalVersion() {
  return trimEnv('Z7NOTE_VERSION') || trimEnv('APP_VERSION') || packageInfo.version || '0.0.0';
}

function getRuntimePlatform() {
  const archMap = {
    x64: 'amd64',
    arm64: 'arm64',
    arm: 'arm'
  };
  const arch = archMap[process.arch] || process.arch || 'unknown';
  const os = process.platform || 'unknown';
  return `${os}/${arch}`;
}

function normalizeTagName(value) {
  return String(value || '').trim();
}

function normalizeUpdateTargetTag(value) {
  const tag = normalizeTagName(value);
  if (!tag) return '';
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) {
    const error = new Error('UPDATE_TARGET_TAG_INVALID');
    error.statusCode = 400;
    throw error;
  }
  return tag;
}

function versionCore(value) {
  const text = normalizeTagName(value).replace(/^v/i, '');
  const match = text.match(/^(\d+(?:\.\d+){0,3})/);
  return match ? match[1] : '';
}

function compareVersions(current, latest) {
  const currentCore = versionCore(current);
  const latestCore = versionCore(latest);
  if (!currentCore || !latestCore) return null;

  const currentParts = currentCore.split('.').map(part => parseInt(part, 10) || 0);
  const latestParts = latestCore.split('.').map(part => parseInt(part, 10) || 0);
  const length = Math.max(currentParts.length, latestParts.length);

  for (let index = 0; index < length; index += 1) {
    const currentValue = currentParts[index] || 0;
    const latestValue = latestParts[index] || 0;
    if (latestValue > currentValue) return 1;
    if (latestValue < currentValue) return -1;
  }

  return 0;
}

async function fetchJson(url) {
  if (typeof fetch !== 'function') {
    throw new Error('当前 Node.js 运行时不支持 fetch');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'z7Note-version-check'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function parseDockerAuthChallenge(header = '') {
  const challenge = {};
  const match = String(header).match(/^Bearer\s+(.*)$/i);
  if (!match) return challenge;

  for (const part of match[1].split(',')) {
    const kv = part.trim().match(/^(\w+)="([^"]*)"$/);
    if (kv) {
      challenge[kv[1]] = kv[2];
    }
  }

  return challenge;
}

async function fetchDockerRegistryToken(image, challenge) {
  const realm = challenge.realm;
  if (!realm) {
    throw new Error('Docker registry auth challenge missing realm');
  }

  const tokenUrl = new URL(realm);
  tokenUrl.searchParams.set('service', challenge.service || 'registry.docker.io');
  tokenUrl.searchParams.set('scope', challenge.scope || `repository:${image}:pull`);

  const data = await fetchJson(tokenUrl.toString());
  if (!data?.token) {
    throw new Error('Docker registry token missing');
  }

  return data.token;
}

async function fetchDockerRegistryManifest(image, reference) {
  const manifestUrl = `https://registry-1.docker.io/v2/${image}/manifests/${encodeURIComponent(reference)}`;
  const headers = {
    Accept: DOCKER_MANIFEST_ACCEPT,
    'User-Agent': 'z7Note-version-check'
  };

  let response = await fetch(manifestUrl, { headers });
  if (response.status === 401) {
    const challenge = parseDockerAuthChallenge(response.headers.get('www-authenticate') || '');
    const token = await fetchDockerRegistryToken(image, challenge);
    response = await fetch(manifestUrl, {
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`
      }
    });
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function formatManifestPlatform(platform = {}) {
  const os = String(platform.os || '').trim();
  const arch = String(platform.architecture || '').trim();
  const variant = String(platform.variant || '').trim();

  if (!os || !arch || os === 'unknown' || arch === 'unknown') {
    return '';
  }

  return variant ? `${os}/${arch}/${variant}` : `${os}/${arch}`;
}

function extractManifestPlatforms(manifest) {
  if (Array.isArray(manifest?.manifests)) {
    return [...new Set(
      manifest.manifests
        .map(item => formatManifestPlatform(item?.platform))
        .filter(Boolean)
    )];
  }

  const singlePlatform = formatManifestPlatform(manifest?.platform);
  return singlePlatform ? [singlePlatform] : [];
}

async function fetchLatestGithubTag(repo) {
  try {
    const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
    if (release?.tag_name) {
      return {
        source: 'github-release',
        tagName: normalizeTagName(release.tag_name),
        publishedAt: release.published_at || release.created_at || '',
        htmlUrl: release.html_url || `https://github.com/${repo}/releases/latest`
      };
    }
  } catch (error) {
    log('WARN', '获取 GitHub 最新 Release 失败，尝试读取 tags', {
      repo,
      error: error.message
    });
  }

  const tags = await fetchJson(`https://api.github.com/repos/${repo}/tags?per_page=30`);
  const tag = Array.isArray(tags) ? tags.find(item => item?.name) : null;
  if (!tag) {
    throw new Error('未找到 GitHub tag');
  }

  return {
    source: 'github-tag',
    tagName: normalizeTagName(tag.name),
    publishedAt: '',
    htmlUrl: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag.name)}`
  };
}

async function fetchLatestDockerTag(image) {
  const [namespace, repository] = image.split('/');
  if (!namespace || !repository) {
    throw new Error('Docker 镜像名无效');
  }

  const data = await fetchJson(`https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags?page_size=50`);
  const tags = Array.isArray(data?.results) ? data.results : [];
  const semverTag = tags.find(tag => tag?.name && versionCore(tag.name) && tag.name !== 'latest');
  const latestTag = semverTag || tags.find(tag => tag?.name === 'latest') || tags[0];
  if (!latestTag?.name) {
    throw new Error('未找到 Docker tag');
  }

  const manifest = await fetchDockerRegistryManifest(image, latestTag.name);
  const platforms = extractManifestPlatforms(manifest);

  return {
    source: 'docker-hub',
    tagName: normalizeTagName(latestTag.name),
    publishedAt: latestTag.last_updated || '',
    htmlUrl: `https://hub.docker.com/r/${image}/tags`,
    platforms,
    manifestMediaType: manifest?.mediaType || '',
    manifestDigest: manifest?.digest || ''
  };
}

async function getRemoteVersion(options = {}) {
  const now = Date.now();
  if (!options.force && remoteCache && now - remoteCache.cachedAt < REMOTE_CACHE_MS) {
    return remoteCache.value;
  }

  const githubRepo = getGithubRepo();
  const dockerImage = getDockerImage();
  const errors = [];

  try {
    const remote = await fetchLatestGithubTag(githubRepo);
    remoteCache = { cachedAt: now, value: remote };
    return remote;
  } catch (error) {
    errors.push(`GitHub: ${error.message}`);
  }

  try {
    const remote = await fetchLatestDockerTag(dockerImage);
    remoteCache = { cachedAt: now, value: remote };
    return remote;
  } catch (error) {
    errors.push(`Docker Hub: ${error.message}`);
  }

  throw new Error(errors.join('；') || '无法获取远端版本');
}

function buildUpdateHint(targetTag, context = {}) {
  const dockerImage = getDockerImage();
  const tag = normalizeTagName(targetTag) || 'latest';
  const runtimePlatform = context.runtimePlatform || getRuntimePlatform();
  const remotePlatforms = Array.isArray(context.remotePlatforms) ? context.remotePlatforms.filter(Boolean) : [];
  const remotePlatformText = remotePlatforms.length ? remotePlatforms.join(' / ') : '未知';
  const platformMatch = remotePlatforms.length ? remotePlatforms.includes(runtimePlatform) : true;

  return [
    `镜像：${dockerImage}:${tag}`,
    `当前平台：${runtimePlatform}`,
    `远端平台：${remotePlatformText}`,
    platformMatch
      ? 'Docker Compose 会自动拉取当前平台对应的 amd64 / arm64 镜像。'
      : '远端平台与当前平台不一致，请确认镜像标签是否完整支持当前环境。',
    '若使用 Docker 镜像部署，可在宿主机更新 compose 中的镜像 tag 后执行：docker compose pull && docker compose up -d',
    '若使用当前源码构建部署，可在宿主机执行：git pull && docker compose build && docker compose up -d',
    '如需后台按钮直接执行，请设置 Z7NOTE_UPDATE_COMMAND 为宿主环境可用的固定更新命令。'
  ].join('\n');
}

function getUpdateState() {
  return {
    ...updateState,
    enabled: !!getUpdateCommand()
  };
}

async function getVersionStatus(options = {}) {
  const currentVersion = getLocalVersion();
  const githubRepo = getGithubRepo();
  const dockerImage = getDockerImage();
  const runtimePlatform = getRuntimePlatform();
  const releaseUrl = `https://github.com/${githubRepo}/releases`;
  let remote = null;
  let remoteError = '';

  try {
    remote = await getRemoteVersion(options);
  } catch (error) {
    remoteError = error.message;
  }

  const latestTag = remote?.tagName || '';
  const comparison = latestTag ? compareVersions(currentVersion, latestTag) : null;
  const updateAvailable = comparison === 1;
  const comparable = comparison !== null;
  const remotePlatforms = Array.isArray(remote?.platforms) ? remote.platforms : [];

  return {
    currentVersion,
    latestVersion: latestTag || '',
    comparable,
    updateAvailable,
    comparison,
    remoteError,
    source: remote?.source || '',
    publishedAt: remote?.publishedAt || '',
    releaseUrl: remote?.htmlUrl || releaseUrl,
    githubRepo,
    dockerImage,
    runtimePlatform,
    remotePlatforms,
    remotePlatformText: remotePlatforms.length ? remotePlatforms.join(' / ') : '',
    platformMatched: remotePlatforms.length ? remotePlatforms.includes(runtimePlatform) : true,
    targetImage: latestTag ? `${dockerImage}:${latestTag}` : `${dockerImage}:latest`,
    updateEnabled: !!getUpdateCommand(),
    updateHint: buildUpdateHint(latestTag, { runtimePlatform, remotePlatforms, dockerImage }),
    updateState: getUpdateState()
  };
}

function startSystemUpdate(options = {}) {
  const command = getUpdateCommand();
  if (!command) {
    const error = new Error('UPDATE_COMMAND_NOT_CONFIGURED');
    error.statusCode = 400;
    error.hint = buildUpdateHint(options.targetVersion);
    throw error;
  }

  if (updateState.running) {
    const error = new Error('UPDATE_ALREADY_RUNNING');
    error.statusCode = 409;
    throw error;
  }

  const targetVersion = normalizeUpdateTargetTag(options.targetVersion);
  const child = spawn('/bin/sh', ['-lc', command], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      Z7NOTE_TARGET_VERSION: targetVersion,
      Z7NOTE_TARGET_IMAGE: targetVersion ? `${getDockerImage()}:${targetVersion}` : `${getDockerImage()}:latest`,
      Z7NOTE_RUNTIME_PLATFORM: getRuntimePlatform(),
      Z7NOTE_DOCKER_IMAGE: getDockerImage()
    }
  });

  updateState = {
    running: true,
    startedAt: Math.floor(Date.now() / 1000),
    finishedAt: null,
    pid: child.pid || null,
    code: null,
    signal: null,
    targetVersion,
    error: null
  };

  child.on('error', (error) => {
    updateState.running = false;
    updateState.finishedAt = Math.floor(Date.now() / 1000);
    updateState.error = error.message;
    log('ERROR', '后台更新命令启动失败', {
      error: error.message,
      targetVersion,
      requestedBy: options.operator
    });
  });

  child.on('exit', (code, signal) => {
    updateState.running = false;
    updateState.finishedAt = Math.floor(Date.now() / 1000);
    updateState.code = code;
    updateState.signal = signal;
    log(code === 0 ? 'INFO' : 'ERROR', '后台更新命令结束', {
      code,
      signal,
      targetVersion,
      requestedBy: options.operator
    });
  });

  child.unref();

  log('INFO', '管理员触发后台更新命令', {
    targetVersion,
    pid: child.pid,
    requestedBy: options.operator
  });

  return getUpdateState();
}

module.exports = {
  compareVersions,
  getVersionStatus,
  startSystemUpdate,
  getUpdateState
};
