// 应用入口 - 优化模块加载
(async () => {
    // 使用应用版本号作为缓存版本
    const VERSION = '1.0.5';
    const cacheBuster = `?v=${VERSION}`;

    try {
        // 并行加载独立模块（不相互依赖）
        await Promise.all([
            import(`./editor-adapters.js${cacheBuster}`),
            import(`./tools.js${cacheBuster}`),
            import(`./api.js${cacheBuster}`),
            import(`./websocket.js${cacheBuster}`)
        ]);

        // UI 模块依赖其他模块，最后加载
        try {
            await import(`./ui.js${cacheBuster}`);
        } catch (e) {
            console.error('[AppEntry] ui.js 加载失败:', e);
            throw e;
        }

        // 所有模块加载完成后，加载主入口
        await import(`./main.js${cacheBuster}`);

    } catch (e) {
        console.error('[AppEntry] 模块加载失败:', e);
    }
})();
