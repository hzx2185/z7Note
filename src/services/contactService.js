const db = require('../db/client');
const log = require('../utils/logger');
const VCardGenerator = require('../utils/vCardGenerator');
const VCardParser = require('../utils/vCardParser');
const { ensureItemQuotaAvailable, getItemQuotaState } = require('./itemQuotaService');

const COMPOUND_CJK_SURNAMES = new Set([
  '欧阳', '太史', '端木', '上官', '司马', '东方', '独孤', '南宫', '万俟', '闻人',
  '夏侯', '诸葛', '尉迟', '公羊', '赫连', '澹台', '皇甫', '宗政', '濮阳', '公冶',
  '太叔', '申屠', '公孙', '慕容', '仲孙', '钟离', '长孙', '宇文', '司徒', '鲜于',
  '司空', '闾丘', '子车', '亓官', '司寇', '巫马', '公西', '颛孙', '壤驷', '公良',
  '漆雕', '乐正', '宰父', '谷梁', '拓跋', '夹谷', '轩辕', '令狐', '段干', '百里',
  '呼延', '东郭', '南门', '羊舌', '微生', '梁丘', '左丘', '东门', '西门', '南荣'
]);

const fieldNames = {
  fn: '全名',
  n_family: '姓',
  n_given: '名',
  n_middle: '中间名',
  n_prefix: '前缀',
  n_suffix: '后缀',
  tel: '电话',
  email: '邮箱',
  adr: '地址',
  org: '公司',
  title: '职位',
  url: '网址',
  photo: '照片',
  note: '备注',
  bday: '生日',
  nickname: '昵称'
};

const BATCH_EDITABLE_FIELDS = new Set(['fn', 'n_family', 'n_given', 'org', 'title', 'note', 'nickname', 'url', 'bday']);
const recentBatchUpdateRequests = new Map();

function generateId() {
  return 'contact_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function containsCJK(text) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text || '');
}

function normalizeContactArray(list, typeNormalizer = value => value) {
  if (!Array.isArray(list)) return [];
  return list
    .map(item => ({
      type: normalizeWhitespace(item?.type || ''),
      value: typeNormalizer(normalizeWhitespace(item?.value || ''))
    }))
    .filter(item => item.value);
}

function splitFormattedName(fn) {
  const formattedName = normalizeWhitespace(fn);
  if (!formattedName) return { n_family: '', n_given: '' };

  if (containsCJK(formattedName) && !formattedName.includes(' ')) {
    if (formattedName.length >= 2) {
      const family = COMPOUND_CJK_SURNAMES.has(formattedName.slice(0, 2))
        ? formattedName.slice(0, 2)
        : formattedName.slice(0, 1);
      return { n_family: family, n_given: formattedName.slice(family.length) };
    }
    return { n_family: formattedName, n_given: '' };
  }

  const parts = formattedName.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      n_family: parts[parts.length - 1],
      n_given: parts.slice(0, -1).join(' ')
    };
  }

  return { n_family: '', n_given: formattedName };
}

function buildFormattedName(contact) {
  const family = normalizeWhitespace(contact.n_family);
  const given = normalizeWhitespace(contact.n_given);
  const middle = normalizeWhitespace(contact.n_middle);
  const prefix = normalizeWhitespace(contact.n_prefix);
  const suffix = normalizeWhitespace(contact.n_suffix);

  if (!family && !given && !middle && !prefix && !suffix) return '';

  if (containsCJK(`${family}${given}${middle}`) && !prefix && !suffix) {
    return `${family}${given}${middle}`.trim();
  }

  return normalizeWhitespace([prefix, given, middle, family, suffix].filter(Boolean).join(' '));
}

function normalizeContactInput(payload, options = {}) {
  const inferStructuredNameFromFn = options.inferStructuredNameFromFn !== false;
  const explicitEmptyFields = new Set(
    Array.isArray(options.explicitEmptyFields)
      ? options.explicitEmptyFields.map(field => String(field || '').trim()).filter(Boolean)
      : []
  );

  const normalized = {
    fn: normalizeWhitespace(payload.fn),
    n_family: normalizeWhitespace(payload.n_family),
    n_given: normalizeWhitespace(payload.n_given),
    n_middle: normalizeWhitespace(payload.n_middle),
    n_prefix: normalizeWhitespace(payload.n_prefix),
    n_suffix: normalizeWhitespace(payload.n_suffix),
    org: normalizeWhitespace(payload.org),
    title: normalizeWhitespace(payload.title),
    url: normalizeWhitespace(payload.url),
    photo: normalizeWhitespace(payload.photo),
    note: String(payload.note || '').trim(),
    bday: normalizeWhitespace(payload.bday),
    nickname: normalizeWhitespace(payload.nickname)
  };

  if (normalized.fn && inferStructuredNameFromFn) {
    const inferred = splitFormattedName(normalized.fn);

    if (
      !explicitEmptyFields.has('n_family') &&
      !explicitEmptyFields.has('n_given') &&
      !normalized.n_family &&
      !normalized.n_given
    ) {
      normalized.n_family = inferred.n_family;
      normalized.n_given = inferred.n_given;
    } else if (
      !explicitEmptyFields.has('n_family') &&
      !explicitEmptyFields.has('n_given') &&
      !normalized.n_family &&
      normalized.n_given &&
      normalizeWhitespace(normalized.n_given) === normalized.fn
    ) {
      normalized.n_family = inferred.n_family;
      normalized.n_given = inferred.n_given || normalized.n_given;
    } else if (
      !explicitEmptyFields.has('n_given') &&
      normalized.n_family &&
      normalized.n_given &&
      normalizeWhitespace(normalized.n_given) === normalized.fn
    ) {
      const expectedGiven = normalizeWhitespace(normalized.fn.replace(new RegExp(`^${normalized.n_family}`), ''));
      if (expectedGiven) normalized.n_given = expectedGiven;
    } else {
      if (!explicitEmptyFields.has('n_family') && !normalized.n_family && inferred.n_family) normalized.n_family = inferred.n_family;
      if (!explicitEmptyFields.has('n_given') && !normalized.n_given && inferred.n_given) normalized.n_given = inferred.n_given;
    }
  }

  if (!normalized.fn && !explicitEmptyFields.has('fn')) {
    normalized.fn = buildFormattedName(normalized);
  }

  normalized.tel = normalizeContactArray(payload.tel, value => value.replace(/[^\d+]/g, ''));
  normalized.email = normalizeContactArray(payload.email, value => value.toLowerCase());
  normalized.adr = normalizeContactArray(payload.adr);

  return normalized;
}

function cleanupRecentBatchUpdateRequests() {
  const now = Date.now();
  for (const [key, entry] of recentBatchUpdateRequests.entries()) {
    if (!entry || entry.expiresAt <= now) {
      recentBatchUpdateRequests.delete(key);
    }
  }
}

function parseContactJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function combineBatchFieldValue(field, mode, oldValue, incomingValue) {
  const current = String(oldValue || '');
  const next = String(incomingValue || '');
  const separator = field === 'note' ? '\n' : '';

  if (mode === 'clear') return '';
  if (mode === 'set') return field === 'note' ? next.trim() : normalizeWhitespace(next);
  if (mode === 'append') {
    if (!current.trim()) return field === 'note' ? next.trim() : normalizeWhitespace(next);
    if (!next.trim()) return field === 'note' ? current.trim() : normalizeWhitespace(current);
    return field === 'note'
      ? `${current.trim()}${separator}${next.trim()}`
      : normalizeWhitespace(`${current}${separator}${next}`);
  }
  if (mode === 'prepend') {
    if (!current.trim()) return field === 'note' ? next.trim() : normalizeWhitespace(next);
    if (!next.trim()) return field === 'note' ? current.trim() : normalizeWhitespace(current);
    return field === 'note'
      ? `${next.trim()}${separator}${current.trim()}`
      : normalizeWhitespace(`${next}${separator}${current}`);
  }
  return current;
}

function applyReplaceRules(value, rules) {
  let result = String(value || '');
  for (const rule of rules) {
    if (!rule.from) continue;
    result = result.split(rule.from).join(rule.to);
  }
  return result;
}

function normalizeBatchOperation(rawOperation) {
  return {
    field: String(rawOperation?.field || '').trim(),
    mode: String(rawOperation?.mode || '').trim(),
    from: String(rawOperation?.from || ''),
    to: String(rawOperation?.to || '')
  };
}

function buildHistoryDetails(entry) {
  const field = normalizeWhitespace(entry?.field);
  const oldValue = entry?.old_value == null ? '' : String(entry.old_value);
  const newValue = entry?.new_value == null ? '' : String(entry.new_value);

  if (entry?.action === 'create') {
    if (field && newValue) return `${field}: ${newValue}`;
    if (newValue) return newValue;
    return field || '已创建联系人';
  }

  if (field) {
    if (oldValue && newValue) return `${field}: ${oldValue} -> ${newValue}`;
    if (oldValue && !newValue) return `${field}: ${oldValue} -> 已清空`;
    if (!oldValue && newValue) return `${field}: (空) -> ${newValue}`;
    return `${field}: 已更新`;
  }

  if (oldValue && newValue) return `${oldValue} -> ${newValue}`;
  if (oldValue && !newValue) return `${oldValue} -> 已清空`;
  if (!oldValue && newValue) return `(空) -> ${newValue}`;
  return entry?.action === 'update' ? '已更新' : '已创建';
}

async function recordContactHistory(username, contactId, action, field, oldValue, newValue) {
  try {
    const now = Math.floor(Date.now() / 1000);
    await db.execute(
      `INSERT INTO contact_history (contact_id, username, action, field, old_value, new_value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [contactId, username, action, field, oldValue, newValue, now]
    );
  } catch (error) {
    log('ERROR', '记录联系人历史失败', { username, contactId, action, error: error.message });
  }
}

async function recordFieldChanges(username, contactId, oldData, newData) {
  const fields = ['fn', 'n_family', 'n_given', 'n_middle', 'n_prefix', 'n_suffix', 'org', 'title', 'url', 'photo', 'note', 'bday', 'nickname'];

  for (const field of fields) {
    const oldVal = (oldData[field] || '').toString().trim();
    const newVal = (newData[field] || '').toString().trim();
    if (oldVal !== newVal) {
      await recordContactHistory(username, contactId, 'update', fieldNames[field] || field, oldVal || null, newVal || null);
    }
  }

  for (const field of ['tel', 'email', 'adr']) {
    const oldVal = oldData[field] ? JSON.stringify(JSON.parse(oldData[field])) : null;
    const newVal = newData[field] ? JSON.stringify(newData[field]) : null;
    if (oldVal === newVal) continue;

    let oldDisplay = null;
    let newDisplay = null;
    try {
      if (oldVal) {
        oldDisplay = JSON.parse(oldVal).map(item => `${item.type || ''}:${item.value || ''}`).join(', ');
      }
      if (newVal) {
        newDisplay = JSON.parse(newVal).map(item => `${item.type || ''}:${item.value || ''}`).join(', ');
      }
    } catch {
      oldDisplay = oldVal;
      newDisplay = newVal;
    }

    await recordContactHistory(username, contactId, 'update', fieldNames[field] || field, oldDisplay, newDisplay);
  }
}

async function listContacts(username, options = {}) {
  const limit = parseInt(options.limit || 100, 10);
  const offset = parseInt(options.offset || 0, 10);
  let query = 'SELECT id, fn, n_family, n_given, org, title, nickname, bday, url, note, tel, email, createdAt, updatedAt FROM contacts WHERE username = ?';
  const params = [username];

  if (options.search) {
    query += ' AND (fn LIKE ? OR n_family LIKE ? OR n_given LIKE ? OR org LIKE ? OR title LIKE ? OR nickname LIKE ? OR bday LIKE ? OR url LIKE ? OR note LIKE ? OR tel LIKE ? OR email LIKE ?)';
    const pattern = `%${options.search}%`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }

  const countQuery = query.replace(/^SELECT id, fn, n_family, n_given, org, title, nickname, bday, url, note, tel, email, createdAt, updatedAt FROM/, 'SELECT COUNT(*) as total FROM');
  const countResult = await db.queryOne(countQuery, params);
  query += ' ORDER BY fn ASC, createdAt DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const contacts = await db.queryAll(query, params);
  return { contacts, total: countResult.total, limit, offset };
}

async function findDuplicateContacts(username) {
  const duplicates = await db.queryAll(`
    SELECT fn, COUNT(*) as count, GROUP_CONCAT(id) as ids
    FROM contacts
    WHERE username = ? AND fn IS NOT NULL AND fn != ''
    GROUP BY fn
    HAVING count > 1
    ORDER BY count DESC
  `, [username]);

  const formatted = [];
  for (const dup of duplicates) {
    const ids = dup.ids.split(',');
    const contacts = await db.queryAll(
      `SELECT id, fn, tel, email, org, note FROM contacts WHERE id IN (${ids.map(() => '?').join(',')}) AND username = ?`,
      [...ids, username]
    );
    formatted.push({
      name: dup.fn,
      count: dup.count,
      contacts: contacts.map(contact => ({
        id: contact.id,
        fn: contact.fn,
        tel: contact.tel,
        email: contact.email,
        org: contact.org,
        note: contact.note
      }))
    });
  }

  return { duplicates: formatted, total: formatted.length };
}

async function findSmartDuplicates(username) {
  const duplicates = { byName: [], byPhone: [], byEmail: [] };

  const nameDuplicates = await db.queryAll(`
    SELECT fn, COUNT(*) as count, GROUP_CONCAT(id) as ids
    FROM contacts
    WHERE username = ? AND fn IS NOT NULL AND fn != ''
    GROUP BY fn
    HAVING count > 1
    ORDER BY count DESC
    LIMIT 20
  `, [username]);

  for (const dup of nameDuplicates) {
    const ids = dup.ids.split(',');
    const contacts = await db.queryAll(
      `SELECT id, fn, tel, email, org FROM contacts WHERE id IN (${ids.map(() => '?').join(',')}) AND username = ?`,
      [...ids, username]
    );
    duplicates.byName.push({
      type: 'name',
      field: '姓名',
      value: dup.fn,
      count: dup.count,
      contacts: contacts.map(contact => ({
        id: contact.id,
        fn: contact.fn,
        tel: contact.tel,
        email: contact.email,
        org: contact.org
      }))
    });
  }

  const allContacts = await db.queryAll(
    'SELECT id, fn, tel, email, org FROM contacts WHERE username = ? AND tel IS NOT NULL',
    [username]
  );
  const phoneMap = new Map();
  for (const contact of allContacts) {
    try {
      const tels = JSON.parse(contact.tel || '[]');
      for (const tel of tels) {
        if (!tel.value) continue;
        const normalizedPhone = tel.value.replace(/\D/g, '');
        if (!phoneMap.has(normalizedPhone)) phoneMap.set(normalizedPhone, []);
        phoneMap.get(normalizedPhone).push(contact);
      }
    } catch {}
  }
  for (const [phone, contacts] of phoneMap) {
    if (contacts.length > 1) {
      duplicates.byPhone.push({ type: 'phone', field: '电话', value: phone, count: contacts.length, contacts });
    }
  }

  const emailContacts = await db.queryAll(
    'SELECT id, fn, tel, email, org FROM contacts WHERE username = ? AND email IS NOT NULL',
    [username]
  );
  const emailMap = new Map();
  for (const contact of emailContacts) {
    try {
      const emails = JSON.parse(contact.email || '[]');
      for (const email of emails) {
        if (!email.value) continue;
        if (!emailMap.has(email.value)) emailMap.set(email.value, []);
        emailMap.get(email.value).push(contact);
      }
    } catch {}
  }
  for (const [email, contacts] of emailMap) {
    if (contacts.length > 1) {
      duplicates.byEmail.push({ type: 'email', field: '邮箱', value: email, count: contacts.length, contacts });
    }
  }

  return {
    duplicates,
    total: duplicates.byName.length + duplicates.byPhone.length + duplicates.byEmail.length,
    summary: {
      nameDuplicates: duplicates.byName.length,
      phoneDuplicates: duplicates.byPhone.length,
      emailDuplicates: duplicates.byEmail.length
    }
  };
}

async function createContact(username, payload) {
  const normalized = normalizeContactInput(payload);
  if (!normalized.fn || !normalized.fn.trim()) {
    throw new Error('EMPTY_NAME');
  }

  await ensureItemQuotaAvailable(username, 'contact');

  const id = generateId();
  const now = Math.floor(Date.now() / 1000);
  const contactData = { ...normalized, uid: id };
  const vcard = VCardGenerator.contactToVCard(contactData);

  await db.execute(
    `INSERT INTO contacts (
      id, username, uid, fn, n_family, n_given, n_middle, n_prefix, n_suffix,
      tel, email, adr, org, title, url, photo, note, bday, nickname, vcard,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, username, id, normalized.fn, normalized.n_family || '', normalized.n_given || '', normalized.n_middle || '', normalized.n_prefix || '', normalized.n_suffix || '',
      normalized.tel.length > 0 ? JSON.stringify(normalized.tel) : null,
      normalized.email.length > 0 ? JSON.stringify(normalized.email) : null,
      normalized.adr.length > 0 ? JSON.stringify(normalized.adr) : null,
      normalized.org || '', normalized.title || '', normalized.url || '', normalized.photo || '', normalized.note || '', normalized.bday || '', normalized.nickname || '',
      vcard, now, now
    ]
  );

  await recordContactHistory(username, id, 'create', null, null, normalized.fn);
  return { id, fn: normalized.fn };
}

async function updateContact(username, contactId, payload) {
  const normalized = normalizeContactInput(payload);
  if (!normalized.fn || !normalized.fn.trim()) {
    throw new Error('EMPTY_NAME');
  }

  const existing = await db.queryOne('SELECT * FROM contacts WHERE id = ? AND username = ?', [contactId, username]);
  if (!existing) {
    throw new Error('CONTACT_NOT_FOUND');
  }

  const now = Math.floor(Date.now() / 1000);
  const vcard = VCardGenerator.contactToVCard({ ...normalized });

  await db.execute(
    `UPDATE contacts SET
      fn = ?, n_family = ?, n_given = ?, n_middle = ?, n_prefix = ?, n_suffix = ?,
      tel = ?, email = ?, adr = ?, org = ?, title = ?, url = ?, photo = ?, note = ?,
      bday = ?, nickname = ?, vcard = ?, updatedAt = ?
    WHERE id = ? AND username = ?`,
    [
      normalized.fn, normalized.n_family || '', normalized.n_given || '', normalized.n_middle || '', normalized.n_prefix || '', normalized.n_suffix || '',
      normalized.tel.length > 0 ? JSON.stringify(normalized.tel) : null,
      normalized.email.length > 0 ? JSON.stringify(normalized.email) : null,
      normalized.adr.length > 0 ? JSON.stringify(normalized.adr) : null,
      normalized.org || '', normalized.title || '', normalized.url || '', normalized.photo || '', normalized.note || '', normalized.bday || '', normalized.nickname || '',
      vcard, now, contactId, username
    ]
  );

  await recordFieldChanges(username, contactId, existing, {
    ...normalized,
    tel: normalized.tel.length > 0 ? JSON.stringify(normalized.tel) : null,
    email: normalized.email.length > 0 ? JSON.stringify(normalized.email) : null,
    adr: normalized.adr.length > 0 ? JSON.stringify(normalized.adr) : null
  });
}

async function formatContacts(username, ids = []) {
  const now = Math.floor(Date.now() / 1000);
  let contacts = [];
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    contacts = await db.queryAll(
      `SELECT * FROM contacts WHERE username = ? AND id IN (${placeholders}) ORDER BY updatedAt DESC, createdAt DESC`,
      [username, ...ids]
    );
  } else {
    contacts = await db.queryAll('SELECT * FROM contacts WHERE username = ? ORDER BY updatedAt DESC, createdAt DESC', [username]);
  }

  let updatedCount = 0;
  await db.withTransaction(async (tx) => {
    for (const contact of contacts) {
      const normalized = normalizeContactInput({
        ...contact,
        tel: parseContactJsonArray(contact.tel),
        email: parseContactJsonArray(contact.email),
        adr: parseContactJsonArray(contact.adr)
      }, { inferStructuredNameFromFn: false });

      const vcard = VCardGenerator.contactToVCard({ ...normalized, uid: contact.uid || contact.id });
      const telJson = normalized.tel.length > 0 ? JSON.stringify(normalized.tel) : null;
      const emailJson = normalized.email.length > 0 ? JSON.stringify(normalized.email) : null;
      const adrJson = normalized.adr.length > 0 ? JSON.stringify(normalized.adr) : null;

      const changed = (
        normalized.fn !== (contact.fn || '') ||
        normalized.n_family !== (contact.n_family || '') ||
        normalized.n_given !== (contact.n_given || '') ||
        normalized.n_middle !== (contact.n_middle || '') ||
        normalized.n_prefix !== (contact.n_prefix || '') ||
        normalized.n_suffix !== (contact.n_suffix || '') ||
        normalized.org !== (contact.org || '') ||
        normalized.title !== (contact.title || '') ||
        normalized.url !== (contact.url || '') ||
        normalized.photo !== (contact.photo || '') ||
        normalized.note !== (contact.note || '') ||
        normalized.bday !== (contact.bday || '') ||
        normalized.nickname !== (contact.nickname || '') ||
        telJson !== (contact.tel || null) ||
        emailJson !== (contact.email || null) ||
        adrJson !== (contact.adr || null) ||
        vcard !== (contact.vcard || '')
      );
      if (!changed) continue;

      await tx.execute(
        `UPDATE contacts SET
          fn = ?, n_family = ?, n_given = ?, n_middle = ?, n_prefix = ?, n_suffix = ?,
          tel = ?, email = ?, adr = ?, org = ?, title = ?, url = ?, photo = ?, note = ?,
          bday = ?, nickname = ?, vcard = ?, updatedAt = ?
        WHERE id = ? AND username = ?`,
        [
          normalized.fn, normalized.n_family, normalized.n_given, normalized.n_middle, normalized.n_prefix, normalized.n_suffix,
          telJson, emailJson, adrJson, normalized.org, normalized.title, normalized.url, normalized.photo, normalized.note,
          normalized.bday, normalized.nickname, vcard, now, contact.id, username
        ]
      );
      updatedCount++;
    }
  });

  return { updatedCount, total: contacts.length };
}

async function batchUpdateContacts(username, payload) {
  cleanupRecentBatchUpdateRequests();
  const ids = Array.isArray(payload?.ids) ? payload.ids.filter(Boolean) : [];
  const requestId = normalizeWhitespace(payload?.requestId);
  const requestCacheKey = requestId ? `${username}:${requestId}` : '';

  if (!ids.length) throw new Error('EMPTY_SELECTION');
  if (requestCacheKey && recentBatchUpdateRequests.has(requestCacheKey)) {
    return recentBatchUpdateRequests.get(requestCacheKey).result;
  }

  const placeholders = ids.map(() => '?').join(',');
  const contacts = await db.queryAll(
    `SELECT * FROM contacts WHERE username = ? AND id IN (${placeholders}) ORDER BY updatedAt DESC, createdAt DESC`,
    [username, ...ids]
  );
  if (!contacts.length) throw new Error('CONTACTS_NOT_FOUND');

  let operations = [];
  if (Array.isArray(payload?.operations) && payload.operations.length > 0) {
    operations = payload.operations.map(normalizeBatchOperation);
  } else {
    const legacyMode = String(payload?.mode || '').trim();
    if (legacyMode === 'replace') {
      const replaceFields = Array.isArray(payload?.fields)
        ? payload.fields.map(field => String(field || '').trim()).filter(Boolean)
        : [];
      const replacementRules = Array.isArray(payload?.replacements)
        ? payload.replacements.map(rule => ({ from: String(rule?.from || ''), to: String(rule?.to || '') })).filter(rule => rule.from)
        : [];
      operations = replaceFields.flatMap(field => replacementRules.map(rule => ({
        field,
        mode: 'replace',
        from: rule.from,
        to: rule.to
      })));
    } else {
      operations = [normalizeBatchOperation({
        field: payload?.field,
        mode: legacyMode,
        from: '',
        to: payload?.value
      })];
    }
  }

  operations = operations.filter(operation => operation.field && operation.mode);
  if (!operations.length) throw new Error('EMPTY_OPERATIONS');

  for (const operation of operations) {
    if (!BATCH_EDITABLE_FIELDS.has(operation.field)) throw new Error('UNSUPPORTED_BATCH_FIELD');
    if (!['set', 'replace', 'append', 'prepend', 'clear'].includes(operation.mode)) throw new Error('UNSUPPORTED_BATCH_MODE');
    if (operation.mode === 'replace' && !operation.from.trim()) throw new Error('REPLACE_FROM_REQUIRED');
    if (!['replace', 'clear'].includes(operation.mode) && !operation.to.trim()) throw new Error('BATCH_VALUE_REQUIRED');
  }

  const now = Math.floor(Date.now() / 1000);
  const updates = [];

  for (const contact of contacts) {
    const patch = {};
    for (const operation of operations) {
      const baseValue = Object.prototype.hasOwnProperty.call(patch, operation.field)
        ? patch[operation.field]
        : contact[operation.field];
      patch[operation.field] = operation.mode === 'replace'
        ? applyReplaceRules(baseValue, [{ from: operation.from, to: operation.to }])
        : combineBatchFieldValue(operation.field, operation.mode, baseValue, operation.to);
    }

    const explicitEmptyFields = [...new Set(operations.filter(operation => operation.mode === 'clear').map(operation => operation.field))];
    const normalized = normalizeContactInput({
      ...contact,
      tel: parseContactJsonArray(contact.tel),
      email: parseContactJsonArray(contact.email),
      adr: parseContactJsonArray(contact.adr),
      ...patch
    }, { explicitEmptyFields });

    const changedFields = [...new Set(operations.map(operation => operation.field))].filter(field => {
      const before = String(contact[field] || '');
      const after = String(normalized[field] || '');
      return before !== after;
    });
    if (!changedFields.length) continue;

    updates.push({
      id: contact.id,
      contact,
      changedFields,
      normalized,
      vcard: VCardGenerator.contactToVCard({ ...normalized, uid: contact.uid || contact.id })
    });
  }

  if (!updates.length) {
    return { message: '选中的联系人无需修改', updatedCount: 0 };
  }

  await db.withTransaction(async (tx) => {
    for (const item of updates) {
      const setClause = item.changedFields.map(field => `${field} = ?`).join(', ');
      await tx.execute(
        `UPDATE contacts SET ${setClause}, vcard = ?, updatedAt = ? WHERE id = ? AND username = ?`,
        [...item.changedFields.map(field => item.normalized[field] || ''), item.vcard, now, item.id, username]
      );
    }
  });

  for (const item of updates) {
    for (const field of item.changedFields) {
      await recordContactHistory(
        username,
        item.id,
        'update',
        fieldNames[field] || field,
        String(item.contact[field] || '') || null,
        String(item.normalized[field] || '') || null
      );
    }
  }

  const result = { message: `已批量修改 ${updates.length} 个联系人`, updatedCount: updates.length };
  if (requestCacheKey) {
    recentBatchUpdateRequests.set(requestCacheKey, {
      expiresAt: Date.now() + 5 * 60 * 1000,
      result
    });
  }
  return result;
}

async function deleteContact(username, contactId) {
  const contact = await db.queryOne('SELECT fn FROM contacts WHERE id = ? AND username = ?', [contactId, username]);
  if (!contact) throw new Error('CONTACT_NOT_FOUND');

  const result = await db.execute('DELETE FROM contacts WHERE id = ? AND username = ?', [contactId, username]);
  if (!result.changes) throw new Error('CONTACT_NOT_FOUND');
  await recordContactHistory(username, contactId, 'delete', null, contact.fn, null);
}

async function deleteContactsBatch(username, ids) {
  const placeholders = ids.map(() => '?').join(',');
  return db.execute(`DELETE FROM contacts WHERE id IN (${placeholders}) AND username = ?`, [...ids, username]);
}

function mergeContactCollections(keepContact, mergeContacts) {
  let tels = parseContactJsonArray(keepContact.tel);
  for (const contact of mergeContacts) {
    for (const tel of parseContactJsonArray(contact.tel)) {
      const normalizedVal = typeof tel.value === 'string' ? tel.value.replace(/[^\d+]/g, '') : tel.value;
      if (!tels.find(existing => (typeof existing.value === 'string' ? existing.value.replace(/[^\d+]/g, '') : existing.value) === normalizedVal)) {
        tels.push({ ...tel, value: normalizedVal });
      }
    }
  }
  tels = tels.map(tel => ({
    ...tel,
    value: typeof tel.value === 'string' ? tel.value.replace(/[^\d+]/g, '') : tel.value
  }));

  let emails = parseContactJsonArray(keepContact.email);
  for (const contact of mergeContacts) {
    for (const email of parseContactJsonArray(contact.email)) {
      if (!emails.find(existing => existing.value === email.value)) {
        emails.push(email);
      }
    }
  }

  let notes = keepContact.note || '';
  for (const contact of mergeContacts) {
    if (contact.note && contact.note !== notes) {
      notes += (notes ? '\n\n---\n\n' : '') + contact.note;
    }
  }

  return { tels, emails, notes };
}

async function mergeContacts(username, keepId, mergeIds) {
  const now = Math.floor(Date.now() / 1000);
  const keepContact = await db.queryOne('SELECT * FROM contacts WHERE id = ? AND username = ?', [keepId, username]);
  if (!keepContact) throw new Error('CONTACT_NOT_FOUND');

  const mergeContactsList = await db.queryAll(
    `SELECT * FROM contacts WHERE id IN (${mergeIds.map(() => '?').join(',')}) AND username = ?`,
    [...mergeIds, username]
  );

  const { tels, emails, notes } = mergeContactCollections(keepContact, mergeContactsList);
  await db.execute(
    `UPDATE contacts SET tel = ?, email = ?, note = ?, updatedAt = ? WHERE id = ? AND username = ?`,
    [
      tels.length > 0 ? JSON.stringify(tels) : null,
      emails.length > 0 ? JSON.stringify(emails) : null,
      notes,
      now,
      keepId,
      username
    ]
  );

  const placeholders = mergeIds.map(() => '?').join(',');
  const deleteResult = await db.execute(`DELETE FROM contacts WHERE id IN (${placeholders}) AND username = ?`, [...mergeIds, username]);
  return { mergedCount: deleteResult.changes, telsCount: tels.length, emailsCount: emails.length };
}

async function mergeContactsBatch(username, mergeList) {
  const now = Math.floor(Date.now() / 1000);
  let totalMerged = 0;
  let totalTels = 0;
  let totalEmails = 0;

  await db.withTransaction(async (tx) => {
    for (const item of mergeList) {
      const { keepId, mergeIds } = item;
      if (!keepId || !mergeIds || mergeIds.length === 0) continue;

      const keepContact = await tx.queryOne('SELECT * FROM contacts WHERE id = ? AND username = ?', [keepId, username]);
      if (!keepContact) continue;

      const mergeContactsList = await tx.queryAll(
        `SELECT * FROM contacts WHERE id IN (${mergeIds.map(() => '?').join(',')}) AND username = ?`,
        [...mergeIds, username]
      );

      const { tels, emails, notes } = mergeContactCollections(keepContact, mergeContactsList);
      await tx.execute(
        `UPDATE contacts SET tel = ?, email = ?, note = ?, updatedAt = ? WHERE id = ? AND username = ?`,
        [
          tels.length > 0 ? JSON.stringify(tels) : null,
          emails.length > 0 ? JSON.stringify(emails) : null,
          notes,
          now,
          keepId,
          username
        ]
      );

      const placeholders = mergeIds.map(() => '?').join(',');
      const deleteResult = await tx.execute(`DELETE FROM contacts WHERE id IN (${placeholders}) AND username = ?`, [...mergeIds, username]);
      totalMerged += deleteResult.changes;
      totalTels += tels.length;
      totalEmails += emails.length;
    }
  });

  return { mergedCount: totalMerged, telsCount: totalTels, emailsCount: totalEmails };
}

async function exportContact(username, contactId) {
  const contact = await db.queryOne('SELECT * FROM contacts WHERE id = ? AND username = ?', [contactId, username]);
  if (!contact) throw new Error('CONTACT_NOT_FOUND');
  return {
    contact,
    vcard: VCardGenerator.contactToVCard(contact),
    filename: `${contact.fn || 'contact'}.vcf`
  };
}

async function exportAllContacts(username) {
  const contacts = await db.queryAll('SELECT * FROM contacts WHERE username = ?', [username]);
  return {
    vcard: contacts.map(contact => VCardGenerator.contactToVCard(contact)).join('\r\n'),
    filename: `contacts_${Date.now()}.vcf`
  };
}

async function importContacts(username, vcardContent) {
  const contactsData = VCardParser.parseMultiple(vcardContent);
  if (!contactsData || contactsData.length === 0) {
    throw new Error('EMPTY_IMPORT_DATA');
  }

  const now = Math.floor(Date.now() / 1000);
  const importedContacts = [];
  const skippedContacts = [];

  await db.withTransaction(async (tx) => {
    const contactQuota = await getItemQuotaState(username, 'contact', tx);
    let nextContactCount = contactQuota.current;

    for (const contactData of contactsData) {
      const existing = await tx.queryOne(
        'SELECT id FROM contacts WHERE username = ? AND fn = ?',
        [username, contactData.fn || '']
      );
      if (existing) {
        skippedContacts.push({ fn: contactData.fn, reason: '重复' });
        continue;
      }

      if (contactQuota.limit > 0 && nextContactCount + 1 > contactQuota.limit) {
        const error = new Error('ITEM_QUOTA_EXCEEDED');
        error.type = 'contact';
        error.label = contactQuota.label;
        error.limit = contactQuota.limit;
        error.current = nextContactCount;
        error.incomingCount = 1;
        throw error;
      }

      const id = generateId();
      await tx.execute(
        `INSERT INTO contacts (
          id, username, uid, fn, n_family, n_given, n_middle, n_prefix, n_suffix,
          tel, email, adr, org, title, url, photo, note, bday, nickname, vcard,
          createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, username, contactData.uid || id,
          contactData.fn || '', contactData.n_family || '', contactData.n_given || '',
          contactData.n_middle || '', contactData.n_prefix || '', contactData.n_suffix || '',
          contactData.tel || null, contactData.email || null, contactData.adr || null,
          contactData.org || '', contactData.title || '', contactData.url || '',
          contactData.photo || '', contactData.note || '', contactData.bday || '',
          contactData.nickname || '', contactData.vcard || vcardContent, now, now
        ]
      );
      importedContacts.push({ id, fn: contactData.fn });
      nextContactCount += 1;
    }
  });

  return {
    count: importedContacts.length,
    skipped: skippedContacts.length,
    total: contactsData.length,
    contacts: importedContacts
  };
}

async function getContactHistory(username, contactId) {
  const history = await db.queryAll(
    `SELECT * FROM contact_history WHERE contact_id = ? AND username = ? ORDER BY created_at DESC LIMIT 50`,
    [contactId, username]
  );
  return {
    history: history.map(item => ({ ...item, details: buildHistoryDetails(item) }))
  };
}

async function getContactDetail(username, contactId) {
  const contact = await db.queryOne('SELECT * FROM contacts WHERE id = ? AND username = ?', [contactId, username]);
  if (!contact) throw new Error('CONTACT_NOT_FOUND');
  return contact;
}

module.exports = {
  normalizeWhitespace,
  listContacts,
  findDuplicateContacts,
  findSmartDuplicates,
  createContact,
  updateContact,
  formatContacts,
  batchUpdateContacts,
  deleteContact,
  deleteContactsBatch,
  mergeContacts,
  mergeContactsBatch,
  exportContact,
  exportAllContacts,
  importContacts,
  getContactHistory,
  getContactDetail
};
