// SSE 路由 - 实现实时笔记同步通知
const log = require('../utils/logger');

// 存储每个用户的 SSE 连接
const sseConnections = new Map();

function setupSSE(app) {
    // SSE 端点 - 需要认证，但 auth 中间件会设置 req.user
    app.get('/api/sse', (req, res) => {
        // 设置 SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const username = req.user;

        if (!username) {
            res.write('event: error\ndata: {"error": "未登录"}\n\n');
            res.end();
            return;
        }

        console.log(`[SSE] 用户 ${username} 连接成功`);

        // 保存连接
        if (!sseConnections.has(username)) {
            sseConnections.set(username, []);
        }
        const connections = sseConnections.get(username);
        connections.push(res);

        // 发送连接成功消息
        res.write('event: connected\ndata: {"message": "已连接到实时同步"}\n\n');

        // 发送心跳，保持连接
        const heartbeat = setInterval(() => {
            res.write(':keepalive\n\n');
        }, 30000);

        // 清理断开的连接
        res.on('close', () => {
            clearInterval(heartbeat);
            console.log(`[SSE] 用户 ${username} 断开连接`);
            const userConnections = sseConnections.get(username);
            if (userConnections) {
                const index = userConnections.indexOf(res);
                if (index > -1) {
                    userConnections.splice(index, 1);
                }
                if (userConnections.length === 0) {
                    sseConnections.delete(username);
                }
            }
        });

        res.on('error', (err) => {
            clearInterval(heartbeat);
            console.error(`[SSE] 用户 ${username} 连接错误:`, err.message);
        });
    });

    console.log('[SSE] SSE 路由已注册');
}

// 广播笔记更新通知
function broadcastNoteUpdate(username, noteId, noteData) {
    const connections = sseConnections.get(username);
    if (!connections || connections.length === 0) {
        return;
    }

    const message = {
        type: 'note_update',
        noteId: noteId,
        note: noteData,
        timestamp: Date.now()
    };

    const data = JSON.stringify(message);
    let successCount = 0;

    connections.forEach((res, index) => {
        try {
            res.write(`event: note_update\ndata: ${data}\n\n`);
            successCount++;
        } catch (err) {
            console.error(`[SSE] 发送消息失败:`, err.message);
            // 移除失败的连接
            connections.splice(index, 1);
        }
    });

    console.log(`[SSE] 向用户 ${username} 广播笔记更新 ${noteId}，成功 ${successCount}/${connections.length}`);
}

// 广播笔记删除通知
function broadcastNoteDelete(username, noteId) {
    const connections = sseConnections.get(username);
    if (!connections || connections.length === 0) {
        return;
    }

    const message = {
        type: 'note_delete',
        noteId: noteId,
        timestamp: Date.now()
    };

    const data = JSON.stringify(message);
    let successCount = 0;

    connections.forEach((res, index) => {
        try {
            res.write(`event: note_delete\ndata: ${data}\n\n`);
            successCount++;
        } catch (err) {
            console.error(`[SSE] 发送消息失败:`, err.message);
            connections.splice(index, 1);
        }
    });

    console.log(`[SSE] 向用户 ${username} 广播笔记删除 ${noteId}，成功 ${successCount}/${connections.length}`);
}

// 广播笔记列表更新通知
function broadcastNotesUpdate(username) {
    const connections = sseConnections.get(username);
    if (!connections || connections.length === 0) {
        return;
    }

    const message = {
        type: 'notes_update',
        timestamp: Date.now()
    };

    const data = JSON.stringify(message);
    let successCount = 0;

    connections.forEach((res, index) => {
        try {
            res.write(`event: notes_update\ndata: ${data}\n\n`);
            successCount++;
        } catch (err) {
            console.error(`[SSE] 发送消息失败:`, err.message);
            connections.splice(index, 1);
        }
    });

    console.log(`[SSE] 向用户 ${username} 广播笔记列表更新，成功 ${successCount}/${connections.length}`);
}

module.exports = {
    setupSSE,
    broadcastNoteUpdate,
    broadcastNoteDelete,
    broadcastNotesUpdate
};
