// 工具函数库
// 所有通用工具函数统一在这里定义，避免重复

// 带超时的 fetch 包装函数
export async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('请求超时');
        }
        throw error;
    }
}

// 从内容的第一行提取标题和分类
export function parseTitleAndCategory(content) {
    let title = '未命名';
    let category = '';

    if (content && content.trim()) {
        const firstLine = content.split('\n')[0].trim();

        // 移除 Markdown 标记符号
        let cleanLine = firstLine.replace(/^#+\s*/, '').trim();
        cleanLine = cleanLine.replace(/^[`*_\-]+/, '').trim();

        // 检查是否包含斜杠（分类分隔符）
        if (cleanLine.includes('/')) {
            const parts = cleanLine.split('/');
            // 第一部分是分类（去掉 # 标记）
            category = parts[0].replace(/^#+\s*/, '').trim();
            // 剩余部分是标题
            title = parts.slice(1).join('/').trim();
        } else {
            // 没有斜杠，整行是标题
            title = cleanLine;
        }

        // 限制标题长度
        if (!title) title = '未命名';
        title = title.substring(0, 80);
    }

    // 如果分类存在，组合完整标题
    const fullTitle = category ? `${category}/${title}` : title;

    return { title, category, fullTitle };
}
