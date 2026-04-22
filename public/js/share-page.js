function syncHighlightTheme() {
  const highlightLink = document.querySelector('link[href*="highlight"]');
  if (!highlightLink) return;
  const isDark = document.body.dataset.theme === 'midnight' || document.documentElement.classList.contains('dark-mode');
  highlightLink.href = isDark ? '/cdn/highlight-dark.min.css' : '/cdn/highlight-light.min.css';
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  const raw = parseInt(timestamp, 10);
  const ms = raw > 10000000000 ? raw : raw * 1000;
  return new Date(ms).toLocaleString('zh-CN');
}

function formatExpiry(expiresAt) {
  if (!expiresAt || expiresAt === '0') return '永久有效';
  const exp = parseInt(expiresAt, 10);
  const now = Date.now();
  const diff = exp - now;
  if (diff <= 0) return '已过期';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `剩余 ${days} 天`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  return `剩余 ${hours} 小时`;
}

function showError(message) {
  setHidden('loading', true);
  const errorElement = document.getElementById('error');
  errorElement.textContent = message;
  errorElement.classList.remove('share-hidden');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setHidden(id, hidden) {
  const element = document.getElementById(id);
  if (!element) return;
  element.classList.toggle('share-hidden', hidden);
}

function renderNav(prev, next) {
  const navDiv = document.getElementById('nav-links');
  const prevLink = document.getElementById('prev-link');
  const nextLink = document.getElementById('next-link');

  if (prev) {
    prevLink.href = `/share.html?token=${encodeURIComponent(prev.token)}`;
    prevLink.textContent = `← ${prev.title}`;
    prevLink.classList.remove('disabled');
  } else {
    prevLink.href = '#';
    prevLink.textContent = '← 无';
    prevLink.classList.add('disabled');
  }

  if (next) {
    nextLink.href = `/share.html?token=${encodeURIComponent(next.token)}`;
    nextLink.textContent = `${next.title} →`;
    nextLink.classList.remove('disabled');
  } else {
    nextLink.href = '#';
    nextLink.textContent = '无 →';
    nextLink.classList.add('disabled');
  }

  navDiv.classList.remove('share-hidden');
}

function renderNote(data, token) {
  const note = data.note;
  setHidden('loading', true);
  setHidden('content-card', false);

  document.getElementById('title').textContent = (note.title || '无标题').split('/').pop() || note.title;
  document.getElementById('meta').innerHTML = `
    <span>📝 笔记</span>
    <span>${data.category || '未分类'}</span>
    <span>📅 ${formatTime(note.updatedAt)}</span>
  `;

  let content = note.content || '';
  content = content.replace(/!\[([^\]]*)\]\(\/api\/uploads\/([^)]+)\)/g,
    (_, alt, path) => `![${alt}](/api/share/attachment/${encodeURIComponent(token)}/${encodeURIComponent(path)})`);
  content = content.replace(/\[([^\]]+)\]\(\/api\/uploads\/([^)]+)\)/g,
    (_, alt, path) => `[${alt}](/api/share/attachment/${encodeURIComponent(token)}/${encodeURIComponent(path)})`);

  let html = window.marked.parse(content);
  if (typeof window.DOMPurify !== 'undefined') {
    html = window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['a', 'b', 'i', 'em', 'strong', 'code', 'pre', 'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'br', 'hr', 'input', 'del', 's', 'u', 'sup', 'sub'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'name', 'type', 'checked', 'disabled', 'width', 'height', 'target', 'rel'],
      ALLOW_DATA_ATTR: false
    });
  }

  const contentElement = document.getElementById('content');
  contentElement.innerHTML = html;
  contentElement.classList.add('markdown-body');

  if (window.hljs) {
    document.querySelectorAll('pre code').forEach((block) => window.hljs.highlightElement(block));
  }

  renderNav(data.prevShare, data.nextShare);
}

async function renderCategory(data) {
  setHidden('loading', true);
  setHidden('content-card', false);

  document.getElementById('title').textContent = `${data.category} (${data.notes.length} 篇)`;
  document.getElementById('meta').innerHTML = `
    <span>📁 分类分享</span>
    <span>👤 ${data.owner}</span>
  `;

  if (!data.notes || data.notes.length === 0) {
    document.getElementById('content').innerHTML = '<div class="error">该分类下暂无笔记</div>';
    return;
  }

  let allShares = [];
  try {
    const response = await fetch('/api/share/public-list');
    if (response.ok) {
      allShares = await response.json();
    }
  } catch (error) {
    console.error('获取分享列表失败:', error);
  }

  const shareByNoteId = {};
  allShares.filter((share) => share.type === 'note').forEach((share) => {
    shareByNoteId[share.target] = share.token;
  });

  let html = '<div class="note-list">';
  data.notes.forEach((note) => {
    const title = note.title.split('/').pop() || note.title;
    const noteToken = shareByNoteId[note.id] || '';
    const shareLink = noteToken ? `/share.html?token=${noteToken}` : '#';
    const linkClass = noteToken ? '' : 'note-link-disabled';
    html += `
      <div class="note-item">
        <a href="${shareLink}" target="_blank" class="${linkClass}">${escapeHtml(title)}</a>
        <span class="date">${formatTime(note.updatedAt)}${noteToken ? '' : ' · 未分享'}</span>
      </div>
    `;
  });
  html += '</div>';
  document.getElementById('content').innerHTML = html;
}

function renderFile(data, token) {
  setHidden('loading', true);
  setHidden('content-card', false);

  const fileName = data.target.split('/').pop() || data.target;
  const fileExt = fileName.split('.').pop().toLowerCase();
  const url = `/s/${encodeURIComponent(token)}`;

  document.getElementById('title').textContent = fileName;
  document.getElementById('meta').innerHTML = `
    <span>📎 附件</span>
    <span>👤 ${data.owner}</span>
  `;

  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(data.target)) {
    document.getElementById('content').innerHTML = `
      <div class="file-preview">
        <img src="${url}" alt="${escapeHtml(fileName)}">
        <br>
        <a href="${url}" download class="download-btn">📥 下载图片</a>
      </div>
    `;
  } else if (fileExt === 'pdf') {
    document.getElementById('content').innerHTML = `
      <div class="pdf-placeholder" id="pdf-placeholder">
        <div class="pdf-placeholder-icon">📄</div>
        <div class="pdf-placeholder-text">点击加载PDF预览</div>
      </div>
      <div class="pdf-download-wrap">
        <a href="${url}" download class="download-btn">📥 下载PDF</a>
      </div>
    `;

    const placeholder = document.getElementById('pdf-placeholder');
    if (placeholder) {
      placeholder.onclick = function onPdfClick() {
        this.innerHTML = `
          <div class="pdf-loading">
            <div class="pdf-loading-spinner"></div>
            <div class="pdf-loading-text">加载中...</div>
          </div>
        `;

        const iframe = document.createElement('iframe');
        iframe.className = 'pdf-preview-frame';
        iframe.allow = 'fullscreen';
        iframe.allowFullscreen = true;
        iframe.referrerPolicy = 'no-referrer';

        iframe.onload = function onLoad() {
          console.log('[Share PDF] 加载成功');
        };

        iframe.onerror = () => {
          console.error('[Share PDF] 加载失败');
          placeholder.innerHTML = `
            <div class="pdf-error-state">
              <div class="pdf-error-icon">❌</div>
              <div class="pdf-error-text">PDF加载失败</div>
            </div>
          `;
        };

        setTimeout(() => {
          this.replaceWith(iframe);
          iframe.src = url;
        }, 100);
      };
    }
  } else {
    document.getElementById('content').innerHTML = `
      <div class="file-preview">
        <div class="file-generic-icon">📄</div>
        <div class="file-generic-name">${escapeHtml(fileName)}</div>
        <a href="${url}" download class="download-btn">📥 下载文件</a>
      </div>
    `;
  }

  renderNav(data.prevShare, data.nextShare);
}

async function loadShare() {
  const params = new URLSearchParams(location.search);
  const token = params.get('token');

  if (!token) {
    showError('无效的分享链接');
    return;
  }

  try {
    const response = await fetch(`/api/share/public/${encodeURIComponent(token)}`);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      if (data?.error === 'expired') {
        showError('⏰ 此分享链接已过期');
      } else {
        showError('⚠️ 分享内容不存在或已被删除');
      }
      return;
    }

    const data = await response.json();
    if (data.owner) {
      const backLink = document.getElementById('back-link');
      backLink.href = `/shares.html?user=${encodeURIComponent(data.owner)}`;
      backLink.textContent = `← ${data.owner} 的分享`;
    }

    if (data.type === 'note') {
      renderNote(data, token);
    } else if (data.type === 'category') {
      await renderCategory(data);
    } else if (data.type === 'file') {
      renderFile(data, token);
    }
  } catch {
    showError('❌ 网络错误，请检查连接后重试');
  }
}

syncHighlightTheme();

const themeObserver = new MutationObserver(() => {
  syncHighlightTheme();
});

themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class'] });

if (typeof window.marked !== 'undefined') {
  loadShare();
} else {
  window.addEventListener('load', loadShare);
}
