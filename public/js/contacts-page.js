    const $ = id => document.getElementById(id);
    const esc = t => (t||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    let contacts = [], selected = new Set(), curId = null, page = 1, pageSize = Number(localStorage.getItem('contacts-page-size') || 100), total = 0, query = '';
    let toastTimer = null;
    let fullNameTouched = false;
    let namePartsTouched = false;
    const CONTACT_COLUMNS_KEY = 'contacts-visible-columns';
    const DEFAULT_VISIBLE_COLUMNS = ['fn', 'tel', 'email', 'org', 'note'];
    const CONTACT_COLUMNS = [
      { key: 'fn', label: '全名', className: 'col-name' },
      { key: 'n_family', label: '姓', className: 'col-family' },
      { key: 'n_given', label: '名', className: 'col-given' },
      { key: 'tel', label: '电话', className: 'col-tel' },
      { key: 'email', label: '邮箱', className: 'col-email' },
      { key: 'org', label: '公司', className: 'col-org' },
      { key: 'title', label: '职位', className: 'col-title' },
      { key: 'nickname', label: '昵称', className: 'col-nickname' },
      { key: 'bday', label: '生日', className: 'col-bday' },
      { key: 'url', label: '网址', className: 'col-url' },
      { key: 'note', label: '备注', className: 'col-note' },
      { key: 'createdAt', label: '创建时间', className: 'col-created' },
      { key: 'updatedAt', label: '更新时间', className: 'col-updated' }
    ];

    function toast(message, ok = true) {
      const el = $('toast');
      if (!el) return;
      el.textContent = message;
      el.className = ok ? 'show' : 'show error';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.className = ''; }, 2600);
    }

    async function requestJSON(url, options = {}, fallbackMessage = '请求失败') {
      const { retryOnGateway = false, retryDelay = 800, ...fetchOptions } = options;
      let res;
      try {
        res = await fetch(url, { credentials: 'include', ...fetchOptions });
      } catch (error) {
        throw new Error('网络连接失败，请稍后重试');
      }

      if (retryOnGateway && (res.status === 502 || res.status === 504)) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        try {
          res = await fetch(url, { credentials: 'include', ...fetchOptions });
        } catch (error) {
          throw new Error('网络连接失败，请稍后重试');
        }
      }

      if (res.status === 401) {
        localStorage.removeItem('p-theme');
        window.location.href = '/login.html';
        throw new Error('会话已过期，请重新登录');
      }

      let data = null;
      const text = await res.text();
      if (!res.ok && text && text.trim().startsWith('<')) {
        throw new Error(`服务器返回 ${res.status} ${res.statusText || '错误'}，请稍后重试`);
      }
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (error) {
          throw new Error(`${fallbackMessage}，服务器返回了无效响应`);
        }
      }

      if (!res.ok) {
        throw new Error(data?.error || data?.message || fallbackMessage);
      }

      return data;
    }

    async function load() {
      try {
        const data = await requestJSON(`/api/contacts?limit=${pageSize}&offset=${(page-1)*pageSize}${query?`&search=${encodeURIComponent(query)}`:''}`, {}, '加载联系人失败');
        contacts = data.contacts || [];
        total = data.total || 0;
        const totalPages = getTotalPages();
        if (page > totalPages && total > 0) {
          page = totalPages;
          return load();
        }
        render();
      } catch (error) {
        contacts = [];
        total = 0;
        render();
        toast(error.message, false);
      }
    }

    function getVisibleColumns() {
      try {
        const saved = JSON.parse(localStorage.getItem(CONTACT_COLUMNS_KEY) || '[]');
        const valid = Array.isArray(saved)
          ? saved.filter(key => CONTACT_COLUMNS.some(column => column.key === key))
          : [];
        return valid.length ? valid : [...DEFAULT_VISIBLE_COLUMNS];
      } catch (error) {
        return [...DEFAULT_VISIBLE_COLUMNS];
      }
    }

    function setVisibleColumns(columns) {
      localStorage.setItem(CONTACT_COLUMNS_KEY, JSON.stringify(columns));
    }

    function formatTimestamp(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) return '-';
      const ms = numeric < 1e12 ? numeric * 1000 : numeric;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
    }

    function getTotalPages() {
      return Math.max(1, Math.ceil(total / pageSize) || 1);
    }

    function renderPagination() {
      const totalPages = getTotalPages();
      $('pagination').classList.toggle('show', total > 0);
      $('page-size').value = String(pageSize);
      $('page-input').value = String(page);
      $('page-input').max = String(totalPages);
      $('page-info').textContent = `${page}/${totalPages}`;
    }

    function getColumnValue(contact, key, tels, emails) {
      if (key === 'fn') return contact.fn || '未命名';
      if (key === 'n_family') return contact.n_family || '-';
      if (key === 'n_given') return contact.n_given || '-';
      if (key === 'tel') return (tels[0]?.value || '').replace(/[^\d+]/g, '') || '-';
      if (key === 'email') return emails[0]?.value || '-';
      if (key === 'org') return contact.org || '-';
      if (key === 'title') return contact.title || '-';
      if (key === 'nickname') return contact.nickname || '-';
      if (key === 'bday') return contact.bday || '-';
      if (key === 'url') return contact.url || '-';
      if (key === 'note') return contact.note || '-';
      if (key === 'createdAt') return formatTimestamp(contact.createdAt);
      if (key === 'updatedAt') return formatTimestamp(contact.updatedAt);
      return '-';
    }

    function renderTableHead() {
      const visibleColumns = getVisibleColumns();
      $('contacts-head').innerHTML = `
        <tr>
          <th class="workspace-table-head workspace-cell-check"><input type="checkbox" id="sel-all" ${contacts.length && contacts.every(c => selected.has(c.id)) ? 'checked' : ''} onclick="toggleAll(this.checked)"></th>
          ${visibleColumns.map(key => {
            const column = CONTACT_COLUMNS.find(item => item.key === key);
            return `<th class="workspace-table-head ${column.className}">${column.label}</th>`;
          }).join('')}
        </tr>
      `;
    }

    function render() {
      const visibleColumns = getVisibleColumns();
      renderTableHead();
      $('list').innerHTML = contacts.map(c => {
        let tels = [], emails = []; try { tels = JSON.parse(c.tel||'[]'); emails = JSON.parse(c.email||'[]'); } catch(e){}
        return `<tr class="workspace-table-row ${selected.has(c.id)?'workspace-table-row-active':''}" onclick="onRowClick('${c.id}', event)">
          <td class="workspace-table-cell workspace-cell-check" onclick="event.stopPropagation()"><input type="checkbox" ${selected.has(c.id)?'checked':''} onchange="toggleSel('${c.id}', this.checked)"></td>
          ${visibleColumns.map(key => {
            const column = CONTACT_COLUMNS.find(item => item.key === key);
            const value = getColumnValue(c, key, tels, emails);
            return `<td class="workspace-table-cell ${column.className}">${esc(value)}</td>`;
          }).join('')}
        </tr>`;
      }).join('') || `<tr><td colspan="${visibleColumns.length + 1}" class="table-empty-row">无数据</td></tr>`;
      $('count-info').textContent = `(${total}${selected.size?`/选${selected.size}`:''})`;
      renderPagination();
    }

    function renderColumnOptions() {
      const visibleColumns = new Set(getVisibleColumns());
      $('column-options').innerHTML = CONTACT_COLUMNS.map(column => `
        <label class="column-item">
          <input type="checkbox" ${visibleColumns.has(column.key) ? 'checked' : ''} onchange="toggleColumn('${column.key}', this.checked)">
          <span>${column.label}</span>
        </label>
      `).join('');
    }

    function openColumnsModal() {
      renderColumnOptions();
      $('columns-modal').classList.add('show');
    }

    function closeColumnsModal() {
      $('columns-modal').classList.remove('show');
    }

    function openBatchEditModal() {
      if (!selected.size) {
        toast('请先选择要批量修改的联系人', false);
        return;
      }
      $('batch-edit-form').reset();
      $('batch-edit-rows').innerHTML = '';
      addBatchEditRow();
      $('batch-edit-scope').textContent = `将修改选中的 ${selected.size} 个联系人`;
      $('batch-edit-modal').classList.add('show');
    }

    function closeBatchEditModal() {
      $('batch-edit-modal').classList.remove('show');
    }

    function addBatchEditRow(field = 'org', mode = 'set', from = '', to = '') {
      const row = document.createElement('div');
      row.className = 'batch-edit-row';
      row.innerHTML = `
        <div class="batch-edit-cell batch-edit-checkbox"><input type="checkbox" class="batch-op-enabled" checked></div>
        <div class="batch-edit-cell">
          <select class="batch-op-field">
            <option value="fn" ${field==='fn'?'selected':''}>全名</option>
            <option value="n_family" ${field==='n_family'?'selected':''}>姓</option>
            <option value="n_given" ${field==='n_given'?'selected':''}>名</option>
            <option value="org" ${field==='org'?'selected':''}>公司</option>
            <option value="title" ${field==='title'?'selected':''}>职位</option>
            <option value="note" ${field==='note'?'selected':''}>备注</option>
            <option value="nickname" ${field==='nickname'?'selected':''}>昵称</option>
            <option value="url" ${field==='url'?'selected':''}>网址</option>
            <option value="bday" ${field==='bday'?'selected':''}>生日</option>
          </select>
        </div>
        <div class="batch-edit-cell">
          <select class="batch-op-mode" onchange="updateBatchEditRowState(this.closest('.batch-edit-row'))">
            <option value="set" ${mode==='set'?'selected':''}>覆盖</option>
            <option value="replace" ${mode==='replace'?'selected':''}>替换</option>
            <option value="append" ${mode==='append'?'selected':''}>追加</option>
            <option value="prepend" ${mode==='prepend'?'selected':''}>前置</option>
            <option value="clear" ${mode==='clear'?'selected':''}>清空</option>
          </select>
        </div>
        <div class="batch-edit-cell"><input type="text" class="batch-op-from" placeholder="原内容" value="${esc(from)}"></div>
        <div class="batch-edit-cell"><input type="text" class="batch-op-to" placeholder="新内容" value="${esc(to)}"></div>
        <div class="batch-edit-cell"><button type="button" class="tool-btn" onclick="this.closest('.batch-edit-row').remove()">×</button></div>
      `;
      $('batch-edit-rows').appendChild(row);
      updateBatchEditRowState(row);
    }

    function updateBatchEditRowState(row) {
      if (!row) return;
      const mode = row.querySelector('.batch-op-mode').value;
      const fromInput = row.querySelector('.batch-op-from');
      const toInput = row.querySelector('.batch-op-to');
      if (mode === 'replace') {
        fromInput.disabled = false;
        toInput.disabled = false;
        fromInput.placeholder = '原内容';
        toInput.placeholder = '新内容';
      } else if (mode === 'clear') {
        fromInput.disabled = true;
        toInput.disabled = true;
        fromInput.value = '';
        toInput.value = '';
        fromInput.placeholder = '无需填写';
        toInput.placeholder = '无需填写';
      } else {
        fromInput.disabled = true;
        fromInput.value = '';
        fromInput.placeholder = '此模式不使用';
        toInput.disabled = false;
        toInput.placeholder = mode === 'prepend' ? '要加到前面的内容' : mode === 'append' ? '要追加的内容' : '覆盖后的内容';
      }
    }

    function toggleColumn(key, checked) {
      const visibleColumns = getVisibleColumns();
      const nextColumns = checked
        ? [...new Set([...visibleColumns, key])]
        : visibleColumns.filter(item => item !== key);

      if (!nextColumns.length) {
        toast('至少保留一列', false);
        renderColumnOptions();
        return;
      }

      const orderedColumns = CONTACT_COLUMNS
        .map(column => column.key)
        .filter(columnKey => nextColumns.includes(columnKey));
      setVisibleColumns(orderedColumns);
      renderColumnOptions();
      render();
    }

    function resetColumns() {
      setVisibleColumns([...DEFAULT_VISIBLE_COLUMNS]);
      renderColumnOptions();
      render();
      toast('已恢复默认显示列');
    }

    function showConfirm(message) {
      return new Promise(resolve => {
        const modal = $('confirm-modal');
        const messageEl = $('confirm-message');
        const okBtn = $('confirm-ok');
        const cancelBtn = $('confirm-cancel');

        messageEl.textContent = message;
        modal.classList.add('show');

        const cleanup = result => {
          modal.classList.remove('show');
          okBtn.onclick = null;
          cancelBtn.onclick = null;
          modal.onclick = null;
          resolve(result);
        };

        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        modal.onclick = event => {
          if (event.target === modal) cleanup(false);
        };
      });
    }

    function onSearch() { clearTimeout(this.t); this.t = setTimeout(() => { query = $('search-input').value; page = 1; load(); }, 300); }
    function goToPage(nextPage) {
      const targetPage = Number(nextPage);
      const totalPages = getTotalPages();
      if (!Number.isFinite(targetPage) || targetPage < 1 || targetPage > totalPages || targetPage === page) return;
      page = targetPage;
      load();
    }
    function jumpToPageInput() {
      goToPage(Number($('page-input').value));
    }
    function onPageInputKeydown(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        jumpToPageInput();
      }
    }
    function changePage(d) { goToPage(page + d); }
    function setPageSize(value) {
      const nextSize = Number(value);
      if (!Number.isFinite(nextSize) || nextSize <= 0 || nextSize === pageSize) return;
      pageSize = nextSize;
      localStorage.setItem('contacts-page-size', String(pageSize));
      page = 1;
      load();
    }
    function toggleSel(id, checked) { checked ? selected.add(id) : selected.delete(id); render(); }
    function toggleAll(checked) { contacts.forEach(c => checked ? selected.add(c.id) : selected.delete(c.id)); render(); }
    function onRowClick(id, e) { if (e.target.tagName !== 'INPUT') openModal(id); }

    function normalizeWhitespace(text) {
      return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function containsCJK(text) {
      return /[\u3400-\u9fff\uf900-\ufaff]/.test(text || '');
    }

    function splitFormattedName(fn) {
      const formatted = normalizeWhitespace(fn);
      if (!formatted) return { family: '', given: '' };
      const compoundSurnames = new Set(['欧阳','太史','端木','上官','司马','东方','独孤','南宫','万俟','闻人','夏侯','诸葛','尉迟','公羊','赫连','澹台','皇甫','宗政','濮阳','公冶','太叔','申屠','公孙','慕容','仲孙','钟离','长孙','宇文','司徒','鲜于','司空','闾丘','子车','亓官','司寇','巫马','公西','颛孙','壤驷','公良','漆雕','乐正','宰父','谷梁','拓跋','夹谷','轩辕','令狐','段干','百里','呼延','东郭','南门','羊舌','微生','梁丘','左丘','东门','西门','南荣']);

      if (containsCJK(formatted) && !formatted.includes(' ')) {
        if (formatted.length < 2) return { family: formatted, given: '' };
        const family = compoundSurnames.has(formatted.slice(0, 2)) ? formatted.slice(0, 2) : formatted.slice(0, 1);
        return { family, given: formatted.slice(family.length) };
      }

      const parts = formatted.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
      }
      return { family: '', given: formatted };
    }

    function buildFormattedName(family, given) {
      const cleanFamily = normalizeWhitespace(family);
      const cleanGiven = normalizeWhitespace(given);
      if (!cleanFamily && !cleanGiven) return '';
      if (containsCJK(`${cleanFamily}${cleanGiven}`)) {
        return `${cleanFamily}${cleanGiven}`.trim();
      }
      return normalizeWhitespace([cleanGiven, cleanFamily].filter(Boolean).join(' '));
    }

    function bindNameFields(form) {
      const familyInput = form.elements.n_family;
      const givenInput = form.elements.n_given;
      const fullInput = form.elements.fn;

      const syncFullName = () => {
        const generated = buildFormattedName(familyInput.value, givenInput.value);
        if (!fullNameTouched || !normalizeWhitespace(fullInput.value)) {
          fullInput.value = generated;
        }
      };

      const syncStructuredName = () => {
        if (namePartsTouched) return;
        const split = splitFormattedName(fullInput.value);
        if (!familyInput.value.trim() || !givenInput.value.trim()) {
          if (!familyInput.value.trim()) familyInput.value = split.family;
          if (!givenInput.value.trim()) givenInput.value = split.given;
        }
      };

      familyInput.oninput = () => {
        namePartsTouched = true;
        syncFullName();
      };
      givenInput.oninput = () => {
        namePartsTouched = true;
        syncFullName();
      };
      fullInput.oninput = () => {
        fullNameTouched = true;
        syncStructuredName();
      };
      fullInput.onblur = syncStructuredName;
    }

    function hasArrayContent(value) {
      try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) && parsed.some(item => normalizeWhitespace(item?.value));
      } catch (error) {
        return false;
      }
    }

    async function openModal(id = null) {
      curId = id; const f = $('contact-form'); f.reset(); $('tel-list').innerHTML = ''; $('email-list').innerHTML = ''; $('adr-list').innerHTML = '';
      fullNameTouched = false;
      namePartsTouched = false;
      $('contact-advanced').open = false;
      $('modal-title').textContent = id ? '编辑联系人' : '添加联系人';
      $('del-contact-btn').classList.toggle('hidden', !id);
      $('history-btn').classList.toggle('hidden', !id);
      if (id) {
        try {
          const c = await requestJSON(`/api/contacts/${id}`, {}, '获取联系人失败');
          if (c) {
            ['n_family','n_given','fn','org','title','note','n_prefix','n_middle','n_suffix','nickname','bday','url','photo'].forEach(k => {
              if (f[k]) f[k].value = c[k]||'';
            });
            try { JSON.parse(c.tel||'[]').forEach(t => addItem('tel', t.type, t.value)); } catch(e){}
            try { JSON.parse(c.email||'[]').forEach(m => addItem('email', m.type, m.value)); } catch(e){}
            try { JSON.parse(c.adr||'[]').forEach(a => addItem('adr', a.type, a.value)); } catch(e){}
            if (c.n_prefix || c.n_middle || c.n_suffix || c.nickname || c.bday || c.url || c.photo || hasArrayContent(c.adr)) {
              $('contact-advanced').open = true;
            }
          }
        } catch (error) {
          toast(error.message, false);
          return;
        }
      } else addItem('tel', 'CELL');
      bindNameFields(f);
      $('edit-modal').classList.add('show');
    }
    function closeModal() { $('edit-modal').classList.remove('show'); }

    function addItem(k, type = '', val = '') {
      const d = document.createElement('div'); d.className = 'multi-item';
      const os = k === 'tel'
        ? [['CELL','手机'],['WORK','工作'],['HOME','住宅']]
        : k === 'email'
          ? [['INTERNET','邮箱'],['WORK','工作'],['HOME','个人']]
          : [['HOME','家庭'],['WORK','工作'],['OTHER','其他']];
      const inputType = k === 'tel' ? 'tel' : k === 'email' ? 'email' : 'text';
      const placeholder = k === 'tel' ? '号码' : k === 'email' ? '邮箱' : '地址';
      d.innerHTML = `<select>${os.map(o => `<option value="${o[0]}" ${type===o[0]?'selected':''}>${o[1]}</option>`).join('')}</select>
        <input type="${inputType}" value="${esc(val)}" placeholder="${placeholder}">
        <button type="button" class="tool-btn" onclick="this.parentElement.remove()">×</button>`;
      $(k + '-list').appendChild(d);
    }

    async function saveContact(e) {
      e.preventDefault(); const fd = new FormData(e.target); const data = Object.fromEntries(fd.entries());
      data.tel = [...$('tel-list').children].map(d => ({type: d.querySelector('select').value, value: d.querySelector('input').value})).filter(x => x.value);
      data.email = [...$('email-list').children].map(d => ({type: d.querySelector('select').value, value: d.querySelector('input').value})).filter(x => x.value);
      data.adr = [...$('adr-list').children].map(d => ({type: d.querySelector('select').value, value: d.querySelector('input').value})).filter(x => x.value);
      
      // 前端也做一次清洗，提升即时感
      if (Array.isArray(data.tel)) {
        data.tel = data.tel.map(t => ({...t, value: t.value.replace(/[^\d+]/g, '')}));
      }

      try {
        await requestJSON(curId?`/api/contacts/${curId}`:`/api/contacts`, {
          method: curId ? 'PUT' : 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(data)
        }, curId ? '保存联系人失败' : '创建联系人失败');
        closeModal();
        await load();
        toast(curId ? '联系人已保存' : '联系人已创建');
      } catch (error) {
        toast(error.message, false);
      }
    }

    async function deleteSingle() {
      if (!(await showConfirm('确定删除此联系人?'))) return;
      try {
        await requestJSON(`/api/contacts/${curId}`, { method:'DELETE' }, '删除联系人失败');
        closeModal();
        selected.delete(curId);
        await load();
        toast('联系人已删除');
      } catch (error) {
        toast(error.message, false);
      }
    }
    async function batchDelete() { 
      if (!selected.size) return toast('请先选择要删除的联系人', false);
      if (await showConfirm(`确定删除选中的 ${selected.size} 个联系人?`)) {
        try {
          const result = await requestJSON('/api/contacts/batch', {
            method:'DELETE',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ids:[...selected]})
          }, '批量删除失败');
          selected.clear();
          await load();
          toast(result?.message || '联系人已删除');
        } catch (error) {
          toast(error.message, false);
        }
      } 
    }
    async function batchMerge() { 
      if (selected.size < 2) return toast('请至少选择两个联系人进行合并', false);
      if (await showConfirm(`确定合并选中的 ${selected.size} 个联系人?`)) {
        const ids=[...selected];
        try {
          const result = await requestJSON('/api/contacts/merge', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({keepId:ids[0],mergeIds:ids.slice(1)})
          }, '合并联系人失败');
          selected.clear();
          await load();
          toast(result?.message || '联系人已合并');
        } catch (error) {
          toast(error.message, false);
        }
      }
    }

    function readVcf(i) { const f = i.files[0]; if (f) { const r = new FileReader(); r.onload = e => $('vcard-text').value = e.target.result; r.readAsText(f); } }
    async function doImport() {
      const v = $('vcard-text').value;
      if (!v.trim()) {
        toast('请先粘贴 vCard 内容', false);
        return;
      }
      try {
        const result = await requestJSON('/api/contacts/import', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({vcard:v})
        }, '导入联系人失败');
        $('import-modal').classList.remove('show');
        $('vcard-text').value='';
        await load();
        toast(result?.message || '联系人导入成功');
      } catch (error) {
        toast(error.message, false);
      }
    }

    async function smartFindDuplicates() {
      let data;
      try {
        data = await requestJSON('/api/contacts/smart-duplicates', {}, '查重失败');
      } catch (error) {
        toast(error.message, false);
        return;
      }
      const allDups = [
        ...data.duplicates.byName.map(g => ({...g, field: '姓名'})),
        ...data.duplicates.byPhone.map(g => ({...g, field: '电话'})),
        ...data.duplicates.byEmail.map(g => ({...g, field: '邮箱'}))
      ];
      $('dup-list').innerHTML = allDups.map((g, i) => `
        <div class="item-card dup-card">
          <div class="dup-row dup-group-title">
            <input type="checkbox" class="dup-group-cb" checked> ${g.field}重复: ${esc(g.value)}
          </div>
          ${g.contacts.map((c, ci) => `
            <div class="dup-row dup-contact-row">
              <div class="dup-indent"></div>
              <div class="col-sel"><input type="radio" name="keep_${i}" value="${c.id}" ${ci===0?'checked':''}></div>
              <div class="dup-name">${esc(c.fn || '未命名')}</div>
            </div>
          `).join('')}
        </div>
      `).join('') || '<div class="empty-message">未发现明显重复</div>';
      $('dup-modal').classList.add('show');
    }

    async function batchMergeGroups() {
      const mergeList = [];
      document.querySelectorAll('#dup-list .item-card').forEach(card => {
        const cb = card.querySelector('.dup-group-cb');
        if (cb && cb.checked) {
          const checkedRadio = card.querySelector('input[type="radio"]:checked');
          if (checkedRadio) {
            const keepId = checkedRadio.value;
            const allIds = [...card.querySelectorAll('input[type="radio"]')].map(r => r.value);
            const mergeIds = allIds.filter(id => id !== keepId);
            if (mergeIds.length) mergeList.push({ keepId, mergeIds });
          }
        }
      });
      if (!mergeList.length) return toast('未选中任何组或无需合并', false);
      if (await showConfirm(`确定合并 ${mergeList.length} 组联系人?`)) {
        try {
          const result = await requestJSON('/api/contacts/merge-batch', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ mergeList }) }, '批量合并失败');
          $('dup-modal').classList.remove('show');
          selected.clear();
          await load();
          toast(result?.message || '重复联系人已合并');
        } catch (error) {
          toast(error.message, false);
        }
      }
    }

    async function showHistory() {
      try {
        const { history = [] } = await requestJSON(`/api/contacts/${curId}/history`, {}, '获取历史记录失败');
        $('history-list').innerHTML = history.map(h => `
        <div class="item-card">
          <div class="history-meta">${formatTimestamp(h.created_at)}</div>
          <div class="history-detail">${esc(h.action === 'update' ? '更新' : '创建')} - ${esc(h.details || '')}</div>
        </div>
        `).join('') || '<div class="empty-message">无历史记录</div>';
        $('history-modal').classList.add('show');
      } catch (error) {
        toast(error.message, false);
      }
    }

    async function formatContacts() {
      const ids = [...selected];
      const scopeLabel = ids.length > 0 ? `选中的 ${ids.length} 个联系人` : '全部联系人';
      if (!(await showConfirm(`确定格式化${scopeLabel}吗？会清理多余空格，并在全名缺失时尽量从现有姓名字段补全，不会再自动拆分补全姓和名。`))) return;
      try {
        const result = await requestJSON('/api/contacts/format', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ ids })
        }, '批量格式化失败');
        await load();
        toast(result?.message || '联系人已格式化');
      } catch (error) {
        toast(error.message, false);
      }
    }

    async function submitBatchEdit(event) {
      event.preventDefault();
      const submitButton = event.submitter || document.querySelector('#batch-edit-form button[type="submit"]');
      const requestId = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const ids = [...selected];
      if (!ids.length) {
        closeBatchEditModal();
        return toast('请先选择要批量修改的联系人', false);
      }
      const operations = [...document.querySelectorAll('#batch-edit-rows .batch-edit-row')].map(row => ({
        enabled: row.querySelector('.batch-op-enabled').checked,
        field: row.querySelector('.batch-op-field').value,
        mode: row.querySelector('.batch-op-mode').value,
        from: row.querySelector('.batch-op-from').value,
        to: row.querySelector('.batch-op-to').value
      })).filter(item => item.enabled);

      if (!operations.length) {
        return toast('请至少勾选一条批量修改规则', false);
      }

      for (const operation of operations) {
        if (operation.mode === 'replace' && !operation.from.trim()) {
          return toast('替换模式需要填写原内容', false);
        }
        if (!['replace', 'clear'].includes(operation.mode) && !operation.to.trim()) {
          return toast('请填写批量修改的新内容', false);
        }
      }

      if (!(await showConfirm(`确定对选中的 ${ids.length} 个联系人应用 ${operations.length} 条修改规则吗？`))) return;
      try {
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.textContent = '处理中...';
        }
        const result = await requestJSON('/api/contacts/batch-update', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ ids, operations, requestId }),
          retryOnGateway: true
        }, '批量修改失败');
        closeBatchEditModal();
        await load();
        toast(result?.message || '联系人已批量修改');
      } catch (error) {
        if (/502|504|网关/.test(error.message)) {
          closeBatchEditModal();
          await load();
          toast('网关异常，但修改很可能已生效，列表已刷新');
        } else {
          toast(error.message, false);
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = '应用修改';
        }
      }
    }

    Object.assign(window, {
      $,
      load,
      getTotalPages,
      openColumnsModal,
      closeColumnsModal,
      openBatchEditModal,
      closeBatchEditModal,
      addBatchEditRow,
      updateBatchEditRowState,
      toggleColumn,
      resetColumns,
      onSearch,
      goToPage,
      jumpToPageInput,
      onPageInputKeydown,
      changePage,
      setPageSize,
      toggleSel,
      toggleAll,
      onRowClick,
      openModal,
      closeModal,
      addItem,
      saveContact,
      deleteSingle,
      batchDelete,
      batchMerge,
      readVcf,
      doImport,
      smartFindDuplicates,
      batchMergeGroups,
      showHistory,
      formatContacts,
      submitBatchEdit
    });
