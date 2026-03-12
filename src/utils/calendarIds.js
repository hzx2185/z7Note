function toBase64Url(value) {
  return Buffer.from(String(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding ? normalized + '='.repeat(4 - padding) : normalized;
  return Buffer.from(padded, 'base64').toString('utf8');
}

function isScopedCalendarId(value) {
  return typeof value === 'string' && value.startsWith('calext_');
}

function scopeExternalCalendarId(username, rawId) {
  if (!rawId) return rawId;

  const stringId = String(rawId);
  if (isScopedCalendarId(stringId)) {
    return stringId;
  }

  return `calext_${toBase64Url(username)}_${toBase64Url(stringId)}`;
}

function getCalendarIdCandidates(username, id) {
  if (!id) return [];

  const candidates = [String(id)];
  const scopedId = scopeExternalCalendarId(username, id);
  if (scopedId && scopedId !== candidates[0]) {
    candidates.push(scopedId);
  }

  return [...new Set(candidates)];
}

function isLikelyInternalCalendarId(value) {
  const stringId = String(value || '');
  return isScopedCalendarId(stringId)
    || stringId.startsWith('sub_')
    || /^[a-z0-9]{12,}$/.test(stringId)
    || /^\d{13}-[a-z0-9]{9}$/.test(stringId);
}

function shouldScopeLegacyCalendarId(value) {
  if (!value) return false;
  return !isLikelyInternalCalendarId(value);
}

function toClientCalendarId(username, storedId) {
  if (!isScopedCalendarId(storedId)) {
    return storedId;
  }

  const match = String(storedId).match(/^calext_([^_]+)_(.+)$/);
  if (!match) {
    return storedId;
  }

  try {
    const storedUsername = fromBase64Url(match[1]);
    if (storedUsername !== username) {
      return storedId;
    }

    return fromBase64Url(match[2]);
  } catch (e) {
    return storedId;
  }
}

module.exports = {
  getCalendarIdCandidates,
  isLikelyInternalCalendarId,
  isScopedCalendarId,
  scopeExternalCalendarId,
  shouldScopeLegacyCalendarId,
  toClientCalendarId
};
