// 通讯录批量操作功能 - 新版表格视图

// 全局变量(不重复定义selectedContacts,使用contacts.html中定义的)
let smartDuplicates = null;

// 更新选中数量显示
function updateSelectedCount() {
  const selectedCount = document.getElementById('selected-count');
  const deleteBtn = document.getElementById('batch-delete-btn');
  const mergeBtn = document.getElementById('batch-merge-btn');
  
  if (selectedCount) {
    selectedCount.textContent = `已选中 ${selectedContacts.size} 个`;
  }
  
  // 显示/隐藏操作按钮
  if (deleteBtn) {
    deleteBtn.style.display = selectedContacts.size > 0 ? 'inline-block' : 'none';
  }
  if (mergeBtn) {
    mergeBtn.style.display = selectedContacts.size > 1 ? 'inline-block' : 'none';
  }
}

// 全选/取消全选
function toggleSelectAll() {
  const selectAllCheckbox = document.getElementById('select-all');
  
  if (selectedContacts.size === contacts.length) {
    selectedContacts.clear();
    selectAllCheckbox.checked = false;
  } else {
    contacts.forEach(c => selectedContacts.add(c.id));
    selectAllCheckbox.checked = true;
  }
  
  updateSelectedCount();
  renderContactsList();
}

// 选择/取消选择联系人
function toggleContactSelection(id, event) {
  if (event) {
    event.stopPropagation();
  }

  if (selectedContacts.has(id)) {
    selectedContacts.delete(id);
  } else {
    selectedContacts.add(id);
  }

  // 更新全选复选框状态
  const selectAllCheckbox = document.getElementById('select-all');
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = selectedContacts.size === contacts.length;
  }

  updateSelectedCount();
  renderContactsList();
}

// 批量删除联系人
async function batchDelete() {
  if (selectedContacts.size === 0) {
    alert('请先选择要删除的联系人');
    return;
  }

  if (!confirm(`确定删除选中的 ${selectedContacts.size} 个联系人吗?`)) {
    return;
  }

  try {
    const res = await fetch('/api/contacts/batch', {
      credentials: 'same-origin',
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedContacts) })
    });

    if (res.ok) {
      const result = await res.json();
      alert(result.message);
      selectedContacts.clear();
      updateSelectedCount();
      loadContacts();
    } else {
      const err = await res.json();
      alert(err.error || '删除失败');
    }
  } catch (e) {
    console.error('批量删除失败', e);
    alert('删除失败');
  }
}

// 批量合并选中的联系人
async function batchMerge() {
  if (selectedContacts.size < 2) {
    alert('请至少选择2个联系人进行合并');
    return;
  }

  const ids = Array.from(selectedContacts);
  
  if (!confirm(`确定合并选中的 ${ids.length} 个联系人吗?\n\n将保留第一个联系人,合并其他联系人的电话、邮箱和备注信息`)) {
    return;
  }

  try {
    const res = await fetch('/api/contacts/merge', {
      credentials: 'same-origin',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        keepId: ids[0], 
        mergeIds: ids.slice(1) 
      })
    });

    if (res.ok) {
      const result = await res.json();
      alert(result.message);
      selectedContacts.clear();
      updateSelectedCount();
      loadContacts();
    } else {
      const err = await res.json();
      alert(err.error || '合并失败');
    }
  } catch (e) {
    console.error('合并失败', e);
    alert('合并失败');
  }
}

// 智能查重
async function smartFindDuplicates() {
  const btn = document.getElementById('smart-duplicates-btn');
  const originalText = btn.textContent;
  
  try {
    btn.textContent = '🔍 查找中...';
    btn.disabled = true;

    const res = await fetch('/api/contacts/smart-duplicates', { credentials: 'same-origin' });

    if (res.ok) {
      smartDuplicates = await res.json();
      
      if (smartDuplicates.total === 0) {
        alert('没有发现重复项!\n\n所有联系人的姓名、电话、邮箱都是唯一的。');
        return;
      }
      
      renderSmartDuplicates();
      document.getElementById('duplicates-modal').classList.add('show');
    } else {
      const err = await res.json();
      alert(err.error || '查找失败');
    }
  } catch (e) {
    console.error('智能查重失败', e);
    alert('查找失败: ' + e.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// 渲染智能查重结果
function renderSmartDuplicates() {
  const container = document.getElementById('duplicates-list');

  if (!smartDuplicates || smartDuplicates.total === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-text">没有发现重复项</div></div>';
    return;
  }

  const { duplicates, summary } = smartDuplicates;

  container.innerHTML = `
    <div style="margin-bottom: 15px; padding: 10px; background: #fff3cd; border-radius: 4px; border-left: 4px solid #ffc107;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>发现 ${smartDuplicates.total} 组重复项</strong>
          <div style="font-size: 13px; margin-top: 5px; color: #666;">
            姓名重复: ${summary.nameDuplicates} 组 | 
            电话重复: ${summary.phoneDuplicates} 组 | 
            邮箱重复: ${summary.emailDuplicates} 组
          </div>
        </div>
        <button class="btn btn-primary" onclick="batchMergeAllDuplicates()" style="font-size: 13px; padding: 6px 12px;">
          批量合并全部
        </button>
      </div>
    </div>
    
    ${renderDuplicateSection('姓名重复', duplicates.byName, 'name')}
    ${renderDuplicateSection('电话重复', duplicates.byPhone, 'phone')}
    ${renderDuplicateSection('邮箱重复', duplicates.byEmail, 'email')}
  `;
}

// 渲染重复项分组
function renderDuplicateSection(title, items, type) {
  if (!items || items.length === 0) return '';

  return `
    <div style="margin-bottom: 20px;">
      <h3 style="font-size: 15px; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 2px solid #007bff;">
        ${title} (${items.length} 组)
      </h3>
      ${items.map((item, index) => renderDuplicateItem(item, type, index)).join('')}
    </div>
  `;
}

// 渲染单个重复项
function renderDuplicateItem(item, type, index) {
  const contacts = item.contacts || [];
  
  return `
    <div style="margin-bottom: 15px; border: 1px solid #ddd; border-radius: 4px; overflow: hidden;">
      <div style="background: #f8f9fa; padding: 8px 12px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span style="font-weight: 600;">${escapeHtml(item.value)}</span>
          <span style="color: #666; font-size: 12px; margin-left: 10px;">重复 ${item.count} 次</span>
        </div>
        <button class="btn btn-primary" onclick="mergeDuplicateGroup('${type}', ${index})" style="font-size: 12px; padding: 4px 10px;">
          合并此组
        </button>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #f0f0f0;">
            <th style="padding: 6px 8px; text-align: left; width: 40px; border-bottom: 1px solid #ddd;">
              <input type="checkbox" onchange="toggleGroupSelection('${type}', ${index}, this.checked)">
            </th>
            <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #ddd;">姓名</th>
            <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #ddd;">电话</th>
            <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #ddd;">邮箱</th>
            <th style="padding: 6px 8px; text-align: left; border-bottom: 1px solid #ddd;">公司</th>
          </tr>
        </thead>
        <tbody>
          ${contacts.map((c, idx) => {
            let tels = '-';
            let emails = '-';
            
            try {
              if (c.tel) {
                const telData = typeof c.tel === 'string' ? JSON.parse(c.tel) : c.tel;
                tels = telData.map(t => t.value).join(', ');
              }
            } catch(e) {}
            
            try {
              if (c.email) {
                const emailData = typeof c.email === 'string' ? JSON.parse(c.email) : c.email;
                emails = emailData.map(e => e.value).join(', ');
              }
            } catch(e) {}
            
            return `
              <tr style="cursor: pointer;" onclick="viewContact(${c.id})">
                <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">
                  <input type="checkbox" data-type="${type}" data-index="${index}" data-id="${c.id}" onclick="event.stopPropagation();">
                </td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${escapeHtml(c.fn || '-')}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${escapeHtml(tels)}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${escapeHtml(emails)}</td>
                <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${escapeHtml(c.org || '-')}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 选择整组重复项
function toggleGroupSelection(type, index, checked) {
  const checkboxes = document.querySelectorAll(`input[data-type="${type}"][data-index="${index}"]`);
  checkboxes.forEach(cb => {
    cb.checked = checked;
    const id = parseInt(cb.dataset.id);
    if (checked) {
      selectedContacts.add(id);
    } else {
      selectedContacts.delete(id);
    }
  });
  updateSelectedCount();
}

// 合并重复组
async function mergeDuplicateGroup(type, index) {
  const item = smartDuplicates.duplicates[`by${type.charAt(0).toUpperCase() + type.slice(1)}`][index];
  const contacts = item.contacts || [];
  
  if (contacts.length < 2) {
    alert('至少需要2个联系人才能合并');
    return;
  }

  if (!confirm(`确定合并此组重复联系人吗?\n\n将保留第一个联系人,合并其他 ${contacts.length - 1} 个联系人的信息`)) {
    return;
  }

  const ids = contacts.map(c => c.id);
  
  try {
    const res = await fetch('/api/contacts/merge', {
      credentials: 'same-origin',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        keepId: ids[0], 
        mergeIds: ids.slice(1) 
      })
    });

    if (res.ok) {
      const result = await res.json();
      alert(result.message);
      // 重新查重
      smartFindDuplicates();
      loadContacts();
    } else {
      const err = await res.json();
      alert(err.error || '合并失败');
    }
  } catch (e) {
    console.error('合并失败', e);
    alert('合并失败');
  }
}

// 查看联系人详情
function viewContact(id) {
  // 跳转到详情页或打开详情模态框
  window.location.href = `/contacts.html?id=${id}`;
}

// 批量合并所有重复项
async function batchMergeAllDuplicates() {
  if (!smartDuplicates || smartDuplicates.total === 0) {
    alert('没有重复项需要合并');
    return;
  }

  const { duplicates } = smartDuplicates;
  const allGroups = [
    ...duplicates.byName,
    ...duplicates.byPhone,
    ...duplicates.byEmail
  ];

  if (allGroups.length === 0) {
    alert('没有重复项需要合并');
    return;
  }

  const totalContacts = allGroups.reduce((sum, group) => sum + group.contacts.length, 0);
  const totalToDelete = totalContacts - allGroups.length;

  if (!confirm(`确定批量合并所有 ${allGroups.length} 组重复项吗?

将删除 ${totalToDelete} 个重复联系人

每组将保留第一个联系人,合并其他联系人的信息`)) {
    return;
  }

  try {
    let mergedCount = 0;
    
    for (const group of allGroups) {
      const contacts = group.contacts || [];
      if (contacts.length < 2) continue;

      const ids = contacts.map(c => c.id);
      
      const res = await fetch('/api/contacts/merge', {
        credentials: 'same-origin',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          keepId: ids[0], 
          mergeIds: ids.slice(1) 
        })
      });

      if (res.ok) {
        mergedCount++;
      }
    }

    alert(`成功合并 ${mergedCount} 组重复项`);
    
    // 重新查重
    smartFindDuplicates();
    
    // 刷新列表
    if (typeof loadContacts === 'function') {
      loadContacts();
    }
  } catch (e) {
    console.error('批量合并失败', e);
    alert('批量合并失败');
  }
}

// 事件监听
document.addEventListener('DOMContentLoaded', function() {
  const selectAllCheckbox = document.getElementById('select-all');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', toggleSelectAll);
  }

  const deleteBtn = document.getElementById('batch-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', batchDelete);
  }

  const mergeBtn = document.getElementById('batch-merge-btn');
  if (mergeBtn) {
    mergeBtn.addEventListener('click', batchMerge);
  }

  const smartBtn = document.getElementById('smart-duplicates-btn');
  if (smartBtn) {
    smartBtn.addEventListener('click', smartFindDuplicates);
  }

  const closeBtn = document.getElementById('duplicates-modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('duplicates-modal').classList.remove('show');
    });
  }

  const cancelBtn = document.getElementById('duplicates-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      document.getElementById('duplicates-modal').classList.remove('show');
    });
  }
});
