// 附件上传相关 API
export function createUploadApi(fetchWithTimeout) {
    return {
    // 显示上传进度
    showUploadProgress(show, text = '正在上传...', percent = 0, details = '') {
        const container = document.getElementById('upload-progress-container');
        const progressBar = document.getElementById('upload-progress-bar');
        const progressText = document.getElementById('upload-progress-text');
        const progressPercent = document.getElementById('upload-progress-percent');
        const progressDetails = document.getElementById('upload-progress-details');

        if (!container) return;

        if (show) {
            container.style.display = 'block';
            progressText.textContent = text;
            progressPercent.textContent = `${percent}%`;
            progressBar.style.width = `${percent}%`;
            progressDetails.textContent = details;
        } else {
            container.style.display = 'none';
        }
    },

    async parseErrorResponse(response, fallbackMessage) {
        const contentType = response.headers.get('content-type') || '';
        const responseText = await response.text();

        if (contentType.includes('application/json')) {
            try {
                const data = JSON.parse(responseText);
                return data.error || fallbackMessage;
            } catch (e) {
                return fallbackMessage;
            }
        }

        if (response.status === 502) {
            return '服务器返回 502 Bad Gateway，请检查应用服务是否正常运行';
        }

        if (responseText) {
            const compactText = responseText.replace(/\s+/g, ' ').trim().slice(0, 120);
            return `${fallbackMessage} (${response.status}): ${compactText}`;
        }

        return `${fallbackMessage} (${response.status})`;
    },

    // 分片上传文件
    async uploadFileInChunks(file, onProgress) {
        const totalSize = file.size;
        const chunkSize = 1 * 1024 * 1024;
        const chunkUploadThreshold = 5 * 1024 * 1024; // 5MB 以上启用分片，兼顾大文件稳定性与普通附件体验

        // 小文件直接走传统上传，较大文件启用分片以支持更稳的长传输与断点续传场景
        if (totalSize <= chunkUploadThreshold) {
            return await this.uploadFileTraditional(file, onProgress);
        }

        try {
            // 1. 创建上传会话
            onProgress && onProgress(5, '创建上传会话...', `准备上传 ${this.formatFileSize(totalSize)}`);
            const sessionRes = await fetchWithTimeout('/api/upload/create-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: file.name,
                    totalSize: totalSize,
                    mimeType: file.type
                })
            }, 30000);

            if (!sessionRes.ok) {
                const errorMessage = await this.parseErrorResponse(sessionRes, '创建上传会话失败');
                throw new Error(errorMessage);
            }

            const session = await sessionRes.json();
            const { uploadId, chunkSize: serverChunkSize, totalChunks } = session;

            // 2. 分片上传
            const chunks = Math.ceil(totalSize / serverChunkSize);
            let uploadedChunks = 0;
            let uploadedBytes = 0;
            let startTime = Date.now();

            for (let i = 0; i < chunks; i++) {
                const start = i * serverChunkSize;
                const end = Math.min(start + serverChunkSize, totalSize);
                const chunk = file.slice(start, end);

                // 将 Blob 转换为 ArrayBuffer，然后转为 Buffer
                const arrayBuffer = await chunk.arrayBuffer();
                const buffer = new Uint8Array(arrayBuffer);

                // 上传分片（设置60秒超时）
                const chunkRes = await fetchWithTimeout(`/api/upload/chunk`, {
                    method: 'POST',
                    headers: {
                        'uploadId': uploadId,
                        'chunkIndex': i.toString(),
                        'Content-Type': 'application/octet-stream'
                    },
                    body: buffer
                }, 60000);

                if (!chunkRes.ok) {
                    const errorMessage = await this.parseErrorResponse(chunkRes, `上传分片 ${i + 1}/${chunks} 失败`);
                    throw new Error(errorMessage);
                }

                uploadedChunks++;
                uploadedBytes += (end - start);

                // 计算上传速度
                const elapsedTime = (Date.now() - startTime) / 1000; // 秒
                const speedBytesPerSec = elapsedTime > 0 ? uploadedBytes / elapsedTime : 0;
                const speedText = this.formatFileSize(speedBytesPerSec) + '/s';

                const progress = Math.round((uploadedChunks / chunks) * 90) + 5; // 5% 到 95%
                onProgress && onProgress(
                    progress,
                    `上传中... (${uploadedChunks}/${chunks})`,
                    `已上传: ${this.formatFileSize(uploadedBytes)} / ${this.formatFileSize(totalSize)} | 速度: ${speedText}`
                );
            }

            // 3. 合并分片
            onProgress && onProgress(95, '合并文件...', '正在合并所有分片');
            const mergeRes = await fetchWithTimeout('/api/upload/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uploadId })
            }, 60000);

            if (!mergeRes.ok) {
                const errorMessage = await this.parseErrorResponse(mergeRes, '合并文件失败');
                throw new Error(errorMessage);
            }

            onProgress && onProgress(100, '上传完成', '文件已成功上传');
            return await mergeRes.json();

        } catch (error) {
            if (this.shouldFallbackToTraditionalUpload(error, file)) {
                onProgress && onProgress(5, '分片线路异常，切换普通上传...', '正在自动重试');
                const fallbackResult = await this.uploadFileTraditional(file, onProgress);
                return {
                    ...fallbackResult,
                    _usedTraditionalFallback: true
                };
            }
            throw error;
        }
    },

    shouldFallbackToTraditionalUpload(error, file) {
        const message = String(error?.message || '').toLowerCase();
        if (!file || file.size <= 0) return false;

        // 代理层 502 或分片接口异常时，优先回退普通上传以保证可用性
        return message.includes('502') ||
            message.includes('bad gateway') ||
            message.includes('上传分片') ||
            message.includes('创建上传会话失败');
    },

    // 传统方式上传文件（小文件）
    async uploadFileTraditional(file, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const formData = new FormData();
            formData.append('file', file);

            let startTime = Date.now();

            // 上传进度
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    const uploaded = this.formatFileSize(event.loaded);
                    const total = this.formatFileSize(event.total);

                    // 计算上传速度
                    const elapsedTime = (Date.now() - startTime) / 1000; // 秒
                    const speedBytesPerSec = elapsedTime > 0 ? event.loaded / elapsedTime : 0;
                    const speedText = this.formatFileSize(speedBytesPerSec) + '/s';

                    onProgress && onProgress(percent, '上传中...', `已上传: ${uploaded} / ${total} | 速度: ${speedText}`);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        resolve(data);
                    } catch (e) {
                        reject(new Error('解析响应失败'));
                    }
                } else {
                    try {
                        const errorData = JSON.parse(xhr.responseText);
                        reject(new Error(errorData.error || '上传失败'));
                    } catch (e) {
                        reject(new Error(`上传失败: ${xhr.status}`));
                    }
                }
            };

            xhr.onerror = () => {
                reject(new Error('网络错误，上传失败'));
            };

            xhr.ontimeout = () => {
                reject(new Error('上传超时'));
            };

            xhr.timeout = 60000; // 60秒超时
            xhr.open('POST', '/api/upload', true);
            xhr.send(formData);
        });
    },

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // 直接上传附件并插入到编辑器
    async handleDirectUpload(input) {
        if (!input.files[0]) return;
        const file = input.files[0];

        // 显示进度条
        this.showUploadProgress(true, `准备上传: ${file.name}`, 0, this.formatFileSize(file.size));

        try {
            // 使用分片上传
            const data = await this.uploadFileInChunks(file, (percent, text, details) => {
                this.showUploadProgress(true, text, percent, details);
            });

            const successDetails = data._usedTraditionalFallback
                ? '分片线路异常，已自动切换普通上传并完成'
                : '文件已成功上传';
            this.showUploadProgress(true, '上传成功', 100, successDetails);

            // 插入到编辑器
            if (!ui.editor) {
                ui.showToast("编辑器未就绪", false);
                this.showUploadProgress(false);
                return;
            }

            const isImage = file.type.startsWith('image/');
            const fileName = data.url.split('/').pop();
            const tag = isImage ? `![${fileName}](${data.url})` : `[${fileName}](${data.url})`;

            // 获取正确的插入位置（适配 CodeMirror）
            let insertIndex = 0;

            if (ui.editor.getCursorPos) {
                // CodeMirror 适配器 - 直接使用 getCursorPos 获取光标索引
                insertIndex = ui.editor.getCursorPos();
                // 确保 insertIndex 不超出文本长度
                const textLength = (ui.editor.getValue() || '').length;
                if (insertIndex < 0) insertIndex = 0;
                if (insertIndex > textLength) insertIndex = textLength;
            } else if (ui.editor.selectionStart !== undefined) {
                // 普通 textarea
                insertIndex = ui.editor.selectionStart;
                // 确保 insertIndex 不超出文本长度
                const textLength = (ui.editor.getValue() || '').length;
                if (insertIndex < 0) insertIndex = 0;
                if (insertIndex > textLength) insertIndex = textLength;
            } else {
                // 文件末尾
                insertIndex = (ui.editor.getValue() || '').length;
            }

            // 插入内容
            const fullText = ui.editor.getValue();
            const newContent = fullText.substring(0, insertIndex) + tag + fullText.substring(insertIndex);
            ui.editor.setValue(newContent);

            // 设置光标到插入内容的末尾
            const newIndex = insertIndex + tag.length;
            if (ui.editor.setSelection) {
                ui.editor.setSelection(newIndex, newIndex);
            } else if (ui.editor.selectionStart !== undefined) {
                ui.editor.selectionStart = ui.editor.selectionEnd = newIndex;
            }
            ui.editor.focus();

            ui.save();
            ui.updatePreview();
            ui.showToast(data._usedTraditionalFallback ? "已自动切换普通上传并插入" : "已插入");

            // 强制刷新附件列表，确保模态框里立刻看到新文件
            await this.loadAttachments(true);
            if (ui.loadUserInfo) {
                await ui.loadUserInfo();
            } else {
                ui.refreshUserInfo();
            }
            input.value = '';

            // 延迟隐藏进度条
            setTimeout(() => {
                this.showUploadProgress(false);
            }, 1000);

        } catch (e) {
            alert(`上传失败: ${e.message}`);
            this.showUploadProgress(true, '上传失败', 0, e.message);
            setTimeout(() => {
                this.showUploadProgress(false);
            }, 3000);
        }
    },
    };
}
