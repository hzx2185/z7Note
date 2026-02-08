// 主入口脚本 - 云端优先架构
import { fetchWithTimeout } from './utils.js';
import wsManager from './websocket.js';

(async () => {
    // 全局错误捕获 - 生产环境静默处理
    window.addEventListener('error', (e) => {
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
            console.error('[App] 全局错误:', e.error);
        }
    });

    // 初始化 UI
    await ui.init(null); // 不需要本地数据库

    // 身份预检
    try {
        const userCheck = await fetchWithTimeout('/api/user-info', {}, 5000);
        if (userCheck.status === 401) {
            localStorage.removeItem('p-theme');
            window.location.href = '/login.html';
            return;
        }

        // 显示加载状态
        const listEl = document.getElementById('list');
        if (listEl) {
            listEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--gray);">加载中...</div>';
        }

        // 从服务器加载笔记
        await loadNotesFromServer();

        // 连接WebSocket
        connectWebSocket();

        // 加载用户信息
        ui.loadUserInfo().catch(() => {});

    } catch (e) {
        console.error('[App] 初始化失败:', e);
        alert('初始化失败，请刷新页面重试');
    }

    // 从服务器加载笔记
    async function loadNotesFromServer() {
        try {
            const startTime = performance.now();

            const res = await fetchWithTimeout('/api/files');
            if (res.ok) {
                const notes = await res.json() || [];
                ui.notes = notes;

                const loadTime = performance.now() - startTime;

                // 使用 requestAnimationFrame 优化渲染
                requestAnimationFrame(() => {
                    ui.render(undefined, true);
                });
            }
        } catch (e) {
            console.error('[App] 加载笔记失败:', e);
            // 显示错误提示
            const listEl = document.getElementById('list');
            if (listEl) {
                listEl.innerHTML = '<div style="padding:40px;text-align:center;color:var(--red);">加载失败，请刷新重试</div>';
            }
        }
    }

    // 连接WebSocket
    async function connectWebSocket() {
        try {
            await wsManager.connect();

            // 注册笔记更新处理器
            wsManager.on('note_update', (data) => {
                handleNoteUpdate(data.note);
            });

            // 注册笔记删除处理器
            wsManager.on('note_delete', (data) => {
                handleNoteDelete(data.noteId);
            });

            // 注册批量笔记更新处理器
            wsManager.on('batch_notes_update', (data) => {
                data.notes.forEach(note => handleNoteUpdate(note));
            });

        } catch (e) {
            console.error('[WebSocket] 连接失败:', e);
            // WebSocket连接失败不影响使用，仍然可以通过轮询获取更新
            startPolling();
        }
    }

    // 处理笔记更新
    function handleNoteUpdate(note) {
        const index = ui.notes.findIndex(n => n.id.toString() === note.id.toString());

        if (index !== -1) {
            // 更新现有笔记
            ui.notes[index] = note;
        } else {
            // 添加新笔记
            ui.notes.unshift(note);
        }

        // 如果当前正在编辑这篇笔记，更新编辑器内容
        if (ui.activeId && ui.activeId.toString() === note.id.toString()) {
            if (ui.editor && ui.editor.setValue) {
                const currentContent = ui.editor.getValue();
                if (currentContent !== note.content) {
                    let cursor = null;
                    if (ui.editor.getCursor) {
                        cursor = ui.editor.getCursor();
                    }
                    ui.editor.setValue(note.content);
                    try { 
                        if (ui.editor.setCursor && cursor) ui.editor.setCursor(cursor);
                    } catch (e) {}
                    if (ui.updateStatus) ui.updateStatus('success', '内容已更新');
                    setTimeout(() => ui.updateStatus('idle', '就绪'), 3000);
                }
            }
        }

        ui.render(undefined, true);
    }

    // 处理笔记删除
    function handleNoteDelete(noteId) {
        ui.notes = ui.notes.filter(n => n.id.toString() !== noteId.toString());

        // 如果当前正在编辑这篇笔记，清空编辑器
        if (ui.activeId && ui.activeId.toString() === noteId.toString()) {
            ui.activeId = null;
            if (ui.editor && typeof ui.editor.destroy === 'function') {
                ui.editor.destroy();
            }
            ui.editor = null;
            ui.updatePreview("");
        }

        ui.render(undefined, true);

        if (ui.showToast) {
            ui.showToast('笔记已被删除');
        }
    }

    // 启动轮询（作为WebSocket的备用方案）
    function startPolling() {
        setInterval(async () => {
            try {
                const res = await fetchWithTimeout('/api/files');
                if (res.ok) {
                    const serverNotes = await res.json() || [];
                    const localNotes = ui.notes || [];

                    // 检查是否有更新
                    const serverNoteMap = new Map(serverNotes.map(n => [n.id.toString(), n]));
                    const remainingNotes = [];
                    let hasUpdate = false;
                    let deleteCount = 0;

                    // 处理服务器上的笔记
                    for (const serverNote of serverNotes) {
                        const localNote = localNotes.find(n => n.id.toString() === serverNote.id.toString());

                        if (localNote) {
                            if (serverNote.updatedAt > localNote.updatedAt) {
                                // 服务器版本更新
                                Object.assign(localNote, serverNote);
                                hasUpdate = true;
                            }
                            remainingNotes.push(localNote);
                        } else {
                            // 服务器有新笔记
                            remainingNotes.push(serverNote);
                            hasUpdate = true;
                        }
                    }

                    // 检查本地有但服务器没有的笔记
                    for (const localNote of localNotes) {
                        if (!serverNoteMap.has(localNote.id.toString())) {
                            // 服务器上没有这条笔记，说明被删除了
                            deleteCount++;
                            hasUpdate = true;
                        }
                    }

                    if (hasUpdate) {
                        ui.notes = remainingNotes;
                        ui.render(undefined, true);
                    }
                }
            } catch (e) {
                // 静默处理轮询错误
            }
        }, 30000); // 每30秒轮询一次
    }

    // 绑定工具函数到 ui
    try {
        Object.assign(ui, {
            // 编辑器操作
            undo: ui.undo.bind(ui),
            redo: ui.redo.bind(ui),
            editorAction: tools.editorAction.bind(tools),
            moveCursor: tools.moveCursor.bind(tools),
            insertSymbol: tools.insertSymbol.bind(tools),
            // 工具函数
            exportCurrentAsTxt: tools.exportCurrentAsTxt.bind(tools),
            findNext: tools.findNext.bind(tools),
            replaceAll: tools.replaceAll.bind(tools),
            replaceAllNotes: tools.replaceAllNotes.bind(tools),
            toggleSearchReplace: tools.toggleSearchReplace.bind(tools),
            exportData: tools.exportData.bind(tools),
            importData: tools.importData.bind(tools),
            // 批量操作
            toggleBatchMode: ui.toggleBatchMode.bind(ui),
            toggleSelect: ui.toggleSelect.bind(ui),
            batchSelectAll: ui.batchSelectAll.bind(ui),
            updateSelectAllCheckbox: ui.updateSelectAllCheckbox.bind(ui),
            batchDelete: ui.batchDelete.bind(ui),
            batchMove: ui.batchMove.bind(ui),
            // 分享功能
            shareCurrentNote: api.shareCurrentNote.bind(api),
            loadShares: api.loadShares.bind(api)
        });

    } catch (e) {
        console.error('[App] 函数绑定失败:', e);
    }

    // 渲染界面
    ui.render(undefined, true);

    // 打开最新的笔记
    const openLatestNote = async () => {
        if (ui.notes.length > 0) {
            const validNotes = ui.notes.filter(n => !n.deleted);
            if (validNotes.length > 0) {
                const latest = validNotes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
                if (!ui.activeId || ui.activeId.toString() !== latest.id.toString()) {
                    ui.switch(latest.id);
                }
            } else {
                await ui.create();
            }
        } else if (ui.notes.length === 0) {
            await ui.create();
        }
    };

    await openLatestNote();

    // 监听网络状态变化
    window.addEventListener('online', () => {
        if (ui.updateStatus) ui.updateStatus('success', '已联网');
        setTimeout(() => {
            if (ui.updateStatus) ui.updateStatus('idle', '就绪');
        }, 2000);

        // 尝试重新连接WebSocket
        if (!wsManager.isConnected) {
            connectWebSocket();
        }
    });

    window.addEventListener('offline', () => {
        if (ui.updateStatus) ui.updateStatus('error', '离线中');
    });

})();
