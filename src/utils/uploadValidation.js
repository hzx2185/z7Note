const path = require('path');
const fs = require('fs').promises;

const MIME_EXTENSION_MAP = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/svg+xml': ['.svg'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md', '.markdown'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/zip': ['.zip'],
  'application/x-rar-compressed': ['.rar'],
  'application/x-7z-compressed': ['.7z'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav']
};

const MIME_ALIASES = {
  'application/x-zip-compressed': 'application/zip',
  'application/x-zip': 'application/zip',
  'multipart/x-zip': 'application/zip',
  'application/vnd.rar': 'application/x-rar-compressed',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav'
};

const ZIP_BASED_MIME_TYPES = new Set([
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

function normalizeMimeType(mimeType) {
  const normalized = String(mimeType || '').toLowerCase().split(';')[0].trim();
  return MIME_ALIASES[normalized] || normalized;
}

function inferMimeTypeFromFilename(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  const match = Object.entries(MIME_EXTENSION_MAP).find(([, exts]) => exts.includes(ext));
  return match ? match[0] : '';
}

function isExtensionAllowedForMime(filename, mimeType) {
  const ext = path.extname(filename || '').toLowerCase();
  const allowedExtensions = MIME_EXTENSION_MAP[mimeType] || [];
  return allowedExtensions.includes(ext);
}

function isLikelyText(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;

  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }

    const isCommonWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isPrintableAscii = byte >= 32 && byte <= 126;
    const isUtf8LeadOrTrail = byte >= 128;

    if (!isCommonWhitespace && !isPrintableAscii && !isUtf8LeadOrTrail) {
      suspicious += 1;
      if (suspicious > 8) {
        return false;
      }
    }
  }

  return true;
}

function detectMimeTypeFromBuffer(buffer, filename = '') {
  if (!buffer || buffer.length === 0) {
    return '';
  }

  if (buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a) {
    return 'image/png';
  }

  const asciiHead = buffer.subarray(0, 64).toString('ascii');
  if (asciiHead.startsWith('GIF87a') || asciiHead.startsWith('GIF89a')) {
    return 'image/gif';
  }

  if (asciiHead.startsWith('%PDF-')) {
    return 'application/pdf';
  }

  if (buffer.length >= 12 &&
      asciiHead.startsWith('RIFF') &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }

  if (buffer.length >= 12 &&
      asciiHead.startsWith('RIFF') &&
      buffer.subarray(8, 12).toString('ascii') === 'WAVE') {
    return 'audio/wav';
  }

  if (buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
      (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)) {
    return 'application/zip';
  }

  if (asciiHead.startsWith('Rar!')) {
    return 'application/x-rar-compressed';
  }

  if (buffer.length >= 6 &&
      buffer[0] === 0x37 &&
      buffer[1] === 0x7a &&
      buffer[2] === 0xbc &&
      buffer[3] === 0xaf &&
      buffer[4] === 0x27 &&
      buffer[5] === 0x1c) {
    return 'application/x-7z-compressed';
  }

  if (buffer.length >= 3 &&
      buffer[0] === 0x49 &&
      buffer[1] === 0x44 &&
      buffer[2] === 0x33) {
    return 'audio/mpeg';
  }

  if (buffer.length >= 2 &&
      buffer[0] === 0xff &&
      (buffer[1] & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }

  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return 'video/mp4';
  }

  if (buffer.length >= 4 &&
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3) {
    return 'video/webm';
  }

  const inferredByName = inferMimeTypeFromFilename(filename);
  if (inferredByName === 'image/svg+xml' || inferredByName.startsWith('text/')) {
    const textSample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').trimStart();
    if (inferredByName === 'image/svg+xml') {
      return /^<svg[\s>]/i.test(textSample) || /<svg[\s>]/i.test(textSample) ? 'image/svg+xml' : '';
    }
    if (isLikelyText(buffer)) {
      return inferredByName;
    }
  }

  return '';
}

function validateRequestedFileType({ filename, mimeType, allowedTypes }) {
  const normalizedInputMimeType = normalizeMimeType(mimeType);
  const normalizedMimeType = (!normalizedInputMimeType || normalizedInputMimeType === 'application/octet-stream')
    ? inferMimeTypeFromFilename(filename)
    : normalizedInputMimeType;

  if (!normalizedMimeType) {
    return { ok: false, error: '无法识别文件类型' };
  }

  if (!allowedTypes.includes(normalizedMimeType)) {
    return { ok: false, error: `不支持的文件类型: ${normalizedMimeType}` };
  }

  if (!isExtensionAllowedForMime(filename, normalizedMimeType)) {
    return { ok: false, error: '文件扩展名与声明的类型不匹配' };
  }

  return { ok: true, mimeType: normalizedMimeType };
}

async function validateStoredFile(filePath, { filename, mimeType, allowedTypes }) {
  const requested = validateRequestedFileType({ filename, mimeType, allowedTypes });
  if (!requested.ok) {
    return requested;
  }

  const fileBuffer = await fs.readFile(filePath);
  const detectedMimeType = detectMimeTypeFromBuffer(fileBuffer, filename);

  if (!detectedMimeType) {
    return { ok: false, error: '无法验证文件内容类型' };
  }

  if (detectedMimeType !== requested.mimeType) {
    const compatibleZipType = detectedMimeType === 'application/zip' && ZIP_BASED_MIME_TYPES.has(requested.mimeType);
    if (!compatibleZipType) {
      return {
        ok: false,
        error: `文件内容与类型不匹配，检测到 ${detectedMimeType}`
      };
    }
  }

  return {
    ok: true,
    mimeType: requested.mimeType,
    detectedMimeType
  };
}

module.exports = {
  normalizeMimeType,
  inferMimeTypeFromFilename,
  validateRequestedFileType,
  validateStoredFile
};
