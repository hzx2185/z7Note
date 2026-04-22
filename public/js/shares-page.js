const params = new URLSearchParams(location.search);
const userParam = params.get('user');
const categoryParam = params.get('category');

let allShares = [];
let currentPage = 1;
let pageSize = 50;

function formatTime(timestamp) {
  if (!timestamp) return '-';
  const raw = parseInt(timestamp, 10);
  const date = new Date(raw > 10000000000 ? raw : raw * 1000);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatExpiry(expiresAt) {
  if (!expiresAt || expiresAt === '0') return '永久';
  const exp = parseInt(expiresAt, 10);
  const now = Date.now();
  const diff = exp - now;
  if (diff <= 0) return '过期';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}天`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  return `${hours}时`;
}

function getTypeLabel(type) {
  const labels = { category: '分类', note: '笔记', file: '附件' };
  return labels[type] || type;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderShareItem(share) {
  const shareUrl = `${location.protocol}//${location.host}/s/${share.token}`;
  const expiryClass = share.expiresAt && parseInt(share.expiresAt, 10) > 0 && parseInt(share.expiresAt, 10) - Date.now() < 86400000
    ? 'expiry-soon'
    : '';

  return `
    <div class="share-item">
      <span class="share-type ${share.type}">${getTypeLabel(share.type)}</span>
      <span>${share.category ? escapeHtml(share.category) : '-'}</span>
      <a href="${shareUrl}" class="share-title" target="_blank" title="${escapeHtml(share.title || '无标题')}">${escapeHtml(share.title || '无标题')}</a>
      <span class="${expiryClass}">${formatExpiry(share.expiresAt)}</span>
      <span>${formatTime(share.createdAt)}</span>
      <button class="copy-btn" onclick="copyShareLink('${shareUrl}', event)">🔗</button>
    </div>
  `;
}

function copyShareLink(url, clickEvent) {
  let copied = false;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      copied = true;
      updateCopyButtonState(clickEvent);
    }).catch((error) => {
      console.warn('Clipboard API 失败:', error);
      fallbackCopy(url, clickEvent);
    });
    return;
  }

  fallbackCopy(url, clickEvent);
}

function fallbackCopy(url, clickEvent) {
  let copied = false;
  try {
    const textArea = document.createElement('textarea');
    textArea.value = url;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    textArea.select();
    copied = document.execCommand('copy');
    document.body.removeChild(textArea);
  } catch (error) {
    console.warn('execCommand 复制失败:', error);
  }

  if (copied) {
    updateCopyButtonState(clickEvent);
  } else {
    prompt('按 Ctrl+C 复制链接:', url);
  }
}

function updateCopyButtonState(clickEvent) {
  const button = clickEvent?.target;
  if (!button) return;
  const originalText = button.textContent;
  button.textContent = '✓ 已复制';
  button.classList.add('is-copied');
  setTimeout(() => {
    button.textContent = originalText;
    button.classList.remove('is-copied');
  }, 1500);
}

async function loadAllShares() {
  const container = document.getElementById('main-container');
  const searchInput = document.getElementById('search-input');
  const searchValue = searchInput ? searchInput.value : '';

  container.innerHTML = `
    <div class="toolbar">
      <input type="text" id="search-input" placeholder="搜索分享标题、用户名或分类..." value="${escapeHtml(searchValue)}">
      <button onclick="loadAllShares()">刷新</button>
    </div>
    <div class="loading">加载中...</div>
  `;

  try {
    const response = await fetch('/api/share/public-list');
    if (!response.ok) throw new Error('加载失败');
    const shares = await response.json();
    allShares = shares;

    if (shares.length === 0) {
      const listContainer = document.querySelector('.share-list');
      if (listContainer) {
        listContainer.innerHTML = '<div class="empty">暂无公开分享</div>';
      } else {
        container.innerHTML += '<div class="share-list"><div class="empty">暂无公开分享</div></div>';
      }
      return;
    }

    const byUser = {};
    shares.forEach((share) => {
      if (!byUser[share.owner]) byUser[share.owner] = [];
      byUser[share.owner].push(share);
    });

    renderAllShares(shares, byUser);

    const input = document.getElementById('search-input');
    if (input) input.addEventListener('input', handleSearch);
  } catch {
    const listContainer = document.querySelector('.share-list');
    if (listContainer) {
      listContainer.innerHTML = '<div class="error">加载失败，请刷新重试</div>';
    } else {
      container.innerHTML += '<div class="share-list"><div class="error">加载失败，请刷新重试</div></div>';
    }
  }
}

function renderAllShares(shares) {
  const container = document.getElementById('main-container');
  const searchInput = document.getElementById('search-input');
  const searchValue = searchInput ? searchInput.value : '';
  const sortedShares = [...shares].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const totalShares = sortedShares.length;
  const totalPages = Math.ceil(totalShares / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageShares = sortedShares.slice(startIndex, endIndex);
  let listContainer = document.querySelector('.share-list');

  const buildListHtml = (items) => {
    let html = '<div class="share-header"><span>类型</span><span>目录</span><span>标题</span><span>有效期</span><span>日期</span><span></span></div>';
    if (items.length === 0) {
      html += '<div class="empty">暂无公开分享</div>';
    } else {
      items.forEach((share) => {
        html += renderShareItem(share);
      });
    }

    if (totalPages > 1) {
      html += '<div class="pagination">';
      html += `<button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`;
      html += `<span>第 ${currentPage} / ${totalPages} 页</span>`;
      html += `<button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>`;
      html += '</div>';
    }
    return html;
  };

  if (!listContainer) {
    container.innerHTML = `
      <div class="toolbar">
        <input type="text" id="search-input" placeholder="搜索分享标题、用户名或分类..." value="${escapeHtml(searchValue)}">
        <button onclick="loadAllShares()">刷新</button>
      </div>
      <div class="share-list">${buildListHtml(pageShares)}</div>
    `;
  } else {
    listContainer.innerHTML = buildListHtml(pageShares);
  }
}

function changePage(page) {
  const totalPages = Math.ceil(allShares.length / pageSize);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderAllShares(allShares);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleSearch(event) {
  const keyword = event.target.value.toLowerCase().trim();
  const listContainer = document.querySelector('.share-list');
  if (!listContainer) return;

  const sortedShares = [...allShares].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const totalShares = sortedShares.length;
  const totalPages = Math.ceil(totalShares / pageSize);

  if (keyword && currentPage !== 1) {
    currentPage = 1;
  }

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const pageShares = sortedShares.slice(startIndex, endIndex);
  let html = '<div class="share-header"><span>类型</span><span>目录</span><span>标题</span><span>有效期</span><span>日期</span><span></span></div>';

  if (!keyword) {
    if (pageShares.length === 0) {
      html += '<div class="empty">暂无公开分享</div>';
    } else {
      pageShares.forEach((share) => {
        html += renderShareItem(share);
      });
    }
  } else {
    const filtered = sortedShares.filter((share) =>
      (share.title || '').toLowerCase().includes(keyword) ||
      (share.owner || '').toLowerCase().includes(keyword) ||
      (share.category || '').toLowerCase().includes(keyword)
    );

    const filteredTotalPages = Math.ceil(filtered.length / pageSize);
    const filteredStartIndex = (currentPage - 1) * pageSize;
    const filteredEndIndex = filteredStartIndex + pageSize;
    const filteredPageShares = filtered.slice(filteredStartIndex, filteredEndIndex);

    if (filteredPageShares.length === 0) {
      html += '<div class="empty">没有找到匹配的分享</div>';
    } else {
      filteredPageShares.forEach((share) => {
        html += renderShareItem(share);
      });
    }

    if (filteredTotalPages > 1) {
      html += '<div class="pagination">';
      html += `<button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`;
      html += `<span>第 ${currentPage} / ${filteredTotalPages} 页</span>`;
      html += `<button onclick="changePage(${currentPage + 1})" ${currentPage === filteredTotalPages ? 'disabled' : ''}>下一页</button>`;
      html += '</div>';
    }
  }

  if (!keyword && totalPages > 1) {
    html += '<div class="pagination">';
    html += `<button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`;
    html += `<span>第 ${currentPage} / ${totalPages} 页</span>`;
    html += `<button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>`;
    html += '</div>';
  }

  listContainer.innerHTML = html;
}

async function loadUserShares(user) {
  document.getElementById('page-title').textContent = `${user} 的分享`;
  const container = document.getElementById('main-container');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const response = await fetch('/api/share/public-list');
    if (!response.ok) throw new Error('加载失败');
    const shares = await response.json();
    const userShares = shares.filter((share) => share.owner === user).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (userShares.length === 0) {
      container.innerHTML = '<div class="empty">该用户暂无分享</div>';
      return;
    }

    const categories = {};
    const noteCount = userShares.filter((share) => share.type === 'note').length;
    const fileCount = userShares.filter((share) => share.type === 'file').length;

    userShares.forEach((share) => {
      if (share.type === 'category') {
        categories[share.category] = { ...share, count: 0 };
      } else if (share.type === 'note') {
        const category = share.category || '未分类';
        if (!categories[category]) categories[category] = { name: category, count: 0 };
        categories[category].count += 1;
      }
    });

    let html = `<a href="shares.html" class="back-btn">← 返回分享中心</a>`;
    html += `
      <div class="user-header">
        <div class="user-avatar">${user.charAt(0).toUpperCase()}</div>
        <div class="user-info">
          <h2>${user}</h2>
          <p>${Object.keys(categories).length} 个分类 · ${noteCount} 篇笔记 · ${fileCount} 个附件</p>
        </div>
      </div>
      <div class="toolbar">
        <input type="text" id="user-search-input" placeholder="搜索此用户的分享...">
      </div>
      <div class="share-list" id="user-share-list">
        <div class="share-header">
          <span>类型</span>
          <span>目录</span>
          <span>标题</span>
          <span>有效期</span>
          <span>日期</span>
          <span></span>
        </div>
        ${userShares.map((share) => renderShareItem(share)).join('')}
      </div>
    `;

    container.innerHTML = html;
    document.getElementById('user-search-input').addEventListener('input', (event) => {
      const keyword = event.target.value.toLowerCase().trim();
      const listDiv = document.getElementById('user-share-list');
      const headerHtml = '<div class="share-header"><span>类型</span><span>目录</span><span>标题</span><span>有效期</span><span>日期</span><span></span></div>';

      if (!keyword) {
        listDiv.innerHTML = headerHtml + userShares.map((share) => renderShareItem(share)).join('');
      } else {
        const filtered = userShares.filter((share) =>
          (share.title || '').toLowerCase().includes(keyword) ||
          (share.category || '').toLowerCase().includes(keyword)
        );
        listDiv.innerHTML = headerHtml + filtered.map((share) => renderShareItem(share)).join('');
      }
    });
  } catch {
    container.innerHTML = '<div class="error">加载失败，请刷新重试</div>';
  }
}

async function loadCategoryNotes(user, category) {
  document.getElementById('page-title').textContent = `${category}`;
  const container = document.getElementById('main-container');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const listResponse = await fetch('/api/share/public-list');
    if (!listResponse.ok) throw new Error('加载失败');
    const shares = await listResponse.json();

    const categoryShare = shares.find((share) =>
      share.owner === user && share.type === 'category' && share.target === category
    );
    const categoryToken = categoryShare ? categoryShare.token : null;

    let html = `<a href="?user=${encodeURIComponent(user)}" class="back-btn">← 返回 ${user} 的分享</a>`;
    html += `<h3 class="section-title">📁 ${escapeHtml(category)}</h3>`;

    if (!categoryToken) {
      html += '<div class="empty">该分类下暂无笔记</div>';
      container.innerHTML = html;
      return;
    }

    const detailResponse = await fetch(`/api/share/public/${encodeURIComponent(categoryToken)}`);
    if (!detailResponse.ok) throw new Error('加载失败');

    const detail = await detailResponse.json();
    const notes = Array.isArray(detail.notes) ? detail.notes : [];

    if (notes.length === 0) {
      html += '<div class="empty">该分类下暂无笔记</div>';
    } else {
      html += '<div class="note-list">';
      notes.forEach((note) => {
        const displayTitle = note.title || '无标题';
        const noteShare = shares.find((share) =>
          share.owner === user && share.type === 'note' && share.target === note.id.toString()
        );
        const shareToken = noteShare ? noteShare.token : `${categoryToken}?note=${note.id}`;
        const shareLink = `/share.html?token=${encodeURIComponent(shareToken)}`;

        html += `
          <div class="note-item">
            <a href="${shareLink}" target="_blank">${escapeHtml(displayTitle)}</a>
            <span class="date">${formatTime(note.updatedAt)}</span>
          </div>
        `;
      });
      html += '</div>';
    }

    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div class="error">加载失败，请刷新重试</div>';
  }
}

window.copyShareLink = copyShareLink;
window.loadAllShares = loadAllShares;
window.changePage = changePage;

if (categoryParam && userParam) {
  loadCategoryNotes(userParam, categoryParam);
} else if (userParam) {
  loadUserShares(userParam);
} else {
  loadAllShares();
}
