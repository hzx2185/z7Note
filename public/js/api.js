// API 调用模块
import { fetchWithTimeout } from './utils.js';
import { createAttachmentApi } from './api-attachments.js?v=1.0.16';
import { createAttachmentAuditApi } from './api-attachment-audit.js?v=1.0.16';
import { createUploadApi } from './api-upload.js?v=1.0.16';
import { createShareApi } from './api-shares.js?v=1.0.18';

const APIManager = {
    // 存储附件列表用于筛选
    attachmentsCache: [],
    // 附件管理视图模式: 'grid' 或 'list'
    attachmentViewMode: 'grid',
    // 分页设置
    attachmentPageSize: 20,
    attachmentCurrentPage: 1,
    // 筛选后的附件列表
    filteredAttachments: [],
    // 无效附件缓存
    invalidAttachmentsCache: [],
    // 引用异常的笔记缓存
    notesWithInvalidAttachments: [],

    ...createAttachmentApi(fetchWithTimeout),
    ...createAttachmentAuditApi(fetchWithTimeout),
    ...createUploadApi(fetchWithTimeout),
    ...createShareApi(fetchWithTimeout)
};

// 导出
window.api = APIManager;
