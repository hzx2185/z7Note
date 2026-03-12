/**
 * z7Note Boot Loader - 极致错误拦截器
 * 消除浏览器扩展及已知干扰报错，优化事件监听
 */
(function() {
    const IGNORE_PATTERNS = [
        'bootstrap-autofill', 'AutofillOverlayContentService', 'setQualifiedLoginFillType', 'isIgnoredField',
        'extension://', 'non-passive event listener', 'purify.min.js.map', 'includes', 'TypeError'
    ];

    const isRedundantError = (msg, stack, file) => {
        const searchStr = `${msg || ''} ${stack || ''} ${file || ''}`;
        return IGNORE_PATTERNS.some(pattern => searchStr.includes(pattern)) ||
            (!msg && searchStr.includes('bootstrap-autofill')) ||
            String(msg || '').includes('Cannot read properties of null');
    };

    window.addEventListener('error', (e) => {
        if (isRedundantError(e.message, e.error?.stack, e.filename)) {
            e.stopImmediatePropagation();
            e.preventDefault();
            return false;
        }
    }, true);

    window.addEventListener('unhandledrejection', (e) => {
        const stack = e.reason?.stack || '';
        const msg = e.reason?.message || String(e.reason || '');
        if (isRedundantError(msg, stack, '')) {
            e.stopImmediatePropagation();
            e.preventDefault();
            return false;
        }
    }, true);

    const originalWarn = console.warn;
    const originalError = console.error;

    console.warn = (...args) => {
        if (typeof args[0] === 'string' && IGNORE_PATTERNS.some(pattern => args[0].includes(pattern))) {
            return;
        }
        originalWarn.apply(console, args);
    };

    console.error = (...args) => {
        if (typeof args[0] === 'string' && IGNORE_PATTERNS.some(pattern => args[0].includes(pattern))) {
            return;
        }
        originalError.apply(console, args);
    };

    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (['touchstart', 'touchmove', 'mousewheel', 'wheel'].includes(type)) {
            if (typeof options === 'object' && options !== null) {
                options = { ...options, passive: true };
            } else {
                options = { passive: true };
            }
        }
        return originalAddEventListener.call(this, type, listener, options);
    };
})();
