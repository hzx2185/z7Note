(function () {
    const STORAGE_KEY = 'ui-theme';
    const THEMES = ['default', 'ocean', 'forest', 'rose', 'midnight'];
    const THEME_OPTIONS = {
        default: { name: '琥珀', icon: 'A', swatch: 'linear-gradient(135deg, #c45f35, #1e7f5c)' },
        ocean: { name: '海蓝', icon: 'O', swatch: 'linear-gradient(135deg, #3474d4, #177f84)' },
        forest: { name: '森绿', icon: 'F', swatch: 'linear-gradient(135deg, #5d8c63, #3a7d55)' },
        rose: { name: '玫瑰', icon: 'R', swatch: 'linear-gradient(135deg, #c86a87, #964560)' },
        midnight: { name: '深夜', icon: 'N', swatch: 'linear-gradient(135deg, #38bdf8, #0f172a)' },
    };
    const META_THEME_COLORS = {
        app: {
            default: '#c45f35',
            ocean: '#edf5fb',
            forest: '#eef4ed',
            rose: '#faf1f3',
            midnight: '#0f172a',
        },
        site: {
            default: '#fcfbf7',
            ocean: '#edf5fb',
            forest: '#eef4ed',
            rose: '#faf1f3',
            midnight: '#0b1220',
        },
    };

    function normalizeTheme(theme) {
        if (theme === 'auto' || theme === 'system') return 'midnight';
        if (theme === 'dark') return 'midnight';
        if (theme === 'light') return 'default';
        if (THEMES.includes(theme)) return theme;
        return 'default';
    }

    function getBody() {
        return document.body || document.querySelector('body');
    }

    function getSurface() {
        return getBody()?.dataset.uiSurface || 'app';
    }

    function getSavedTheme() {
        const explicit = localStorage.getItem(STORAGE_KEY);
        if (explicit) return normalizeTheme(explicit);

        const pageTheme = localStorage.getItem('p-theme');
        if (pageTheme) return normalizeTheme(pageTheme);

        const legacyTheme = localStorage.getItem('theme');
        if (legacyTheme) return normalizeTheme(legacyTheme);

        return 'default';
    }

    function getAppliedTheme() {
        return normalizeTheme(getBody()?.dataset.theme || getSavedTheme());
    }

    function updateMetaThemeColor(theme) {
        const meta = document.querySelector('meta[name="theme-color"]');
        const surface = getSurface();
        const color = META_THEME_COLORS[surface]?.[theme];
        if (meta && color) meta.setAttribute('content', color);
    }

    function syncLegacyFlags(theme) {
        const isDark = theme === 'midnight';
        document.documentElement.classList.toggle('dark-mode', isDark);
        document.documentElement.classList.toggle('light-mode', !isDark);
        localStorage.setItem('p-theme', isDark ? 'dark' : 'light');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    }

    function getThemeButtonLabel(mode, theme) {
        const meta = THEME_OPTIONS[theme] || THEME_OPTIONS.default;
        if (mode === 'label') return `${meta.icon} ${meta.name}`;
        return meta.icon;
    }

    function openThemeMenu(target) {
        document.querySelectorAll('.theme-switcher.is-open').forEach((node) => {
            if (node !== target) node.classList.remove('is-open');
        });
        target.classList.add('is-open');
        target.querySelector('.theme-switcher-btn')?.classList.add('is-open');
        positionThemeMenu(target);
    }

    function closeThemeMenu(target) {
        if (target) {
            target.classList.remove('is-open');
            const button = target.querySelector('.theme-switcher-btn');
            button?.classList.remove('is-open');
            button?.setAttribute('aria-expanded', 'false');
            return;
        }
        document.querySelectorAll('.theme-switcher').forEach((node) => {
            node.classList.remove('is-open');
            const button = node.querySelector('.theme-switcher-btn');
            button?.classList.remove('is-open');
            button?.setAttribute('aria-expanded', 'false');
        });
    }

    function buildThemeMenu(buttonClass, buttonId, buttonType, mode) {
        const shell = document.createElement('div');
        const button = document.createElement('button');
        const menu = document.createElement('div');

        shell.className = 'theme-switcher';

        button.type = buttonType;
        button.className = [buttonClass, 'theme-switcher-btn'].filter(Boolean).join(' ');
        button.setAttribute('data-theme-toggle', mode);
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        if (buttonId) button.id = buttonId;
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const willOpen = !shell.classList.contains('is-open');
            closeThemeMenu();
            if (willOpen) {
                openThemeMenu(shell);
                button.setAttribute('aria-expanded', 'true');
            } else {
                button.setAttribute('aria-expanded', 'false');
            }
        });

        menu.className = 'theme-switcher-menu';
        menu.setAttribute('role', 'menu');

        THEMES.forEach((theme) => {
            const option = document.createElement('button');
            const copy = document.createElement('span');
            const swatch = document.createElement('span');
            const name = document.createElement('span');
            const mark = document.createElement('span');

            option.type = 'button';
            option.className = 'theme-option';
            option.dataset.themeOption = theme;
            option.setAttribute('role', 'menuitemradio');

            copy.className = 'theme-option-copy';
            swatch.className = 'theme-option-swatch';
            swatch.style.background = THEME_OPTIONS[theme].swatch;
            name.className = 'theme-option-name';
            name.textContent = THEME_OPTIONS[theme].name;
            mark.className = 'theme-option-mark';
            mark.textContent = '当前';

            copy.append(swatch, name);
            option.append(copy, mark);
            option.addEventListener('click', (event) => {
                event.preventDefault();
                setTheme(theme);
                closeThemeMenu(shell);
                button.setAttribute('aria-expanded', 'false');
            });
            menu.appendChild(option);
        });

        shell.append(button, menu);
        return shell;
    }

    function positionThemeMenu(target) {
        const button = target?.querySelector('.theme-switcher-btn');
        const menu = target?.querySelector('.theme-switcher-menu');
        if (!button || !menu) return;

        const buttonRect = button.getBoundingClientRect();
        const menuWidth = menu.offsetWidth || 184;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const left = Math.max(8, Math.min(buttonRect.right - menuWidth, viewportWidth - menuWidth - 8));

        menu.style.left = `${left}px`;
        menu.style.top = `${buttonRect.bottom + 8}px`;
    }

    function ensureToggleSlots() {
        document.querySelectorAll('[data-theme-slot]').forEach((slot) => {
            if (slot.dataset.themeSlotReady === '1') return;

            const mode = slot.getAttribute('data-theme-mode') || 'compact';
            const buttonClass = slot.getAttribute('data-theme-button-class');
            const buttonId = slot.getAttribute('data-theme-button-id');
            const buttonType = slot.getAttribute('data-theme-button-type') || 'button';

            slot.replaceChildren(buildThemeMenu(buttonClass, buttonId, buttonType, mode));
            slot.dataset.themeSlotReady = '1';
        });
    }

    function refreshToggleButtons(theme) {
        document.querySelectorAll('.theme-switcher-btn').forEach((button) => {
            const mode = button.getAttribute('data-theme-toggle');
            const label = getThemeButtonLabel(mode, theme);
            const meta = THEME_OPTIONS[theme] || THEME_OPTIONS.default;

            button.innerHTML = `<span class="theme-switcher-label"><span>${label}</span><span>▾</span></span>`;
            button.title = `当前主题：${meta.name}`;
            button.setAttribute('aria-label', `当前主题：${meta.name}`);
        });

        document.querySelectorAll('.theme-option').forEach((option) => {
            const isActive = option.dataset.themeOption === theme;
            option.classList.toggle('is-active', isActive);
            option.setAttribute('aria-checked', isActive ? 'true' : 'false');
        });
    }

    function getNextThemePreference(theme) {
        const current = normalizeTheme(theme);
        const currentIndex = THEMES.indexOf(current);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % THEMES.length : 0;
        return THEMES[nextIndex];
    }

    function applyTheme(theme, persist = false) {
        const nextTheme = normalizeTheme(theme);
        const body = getBody();
        if (!body) {
            document.addEventListener('DOMContentLoaded', () => applyTheme(nextTheme, persist), { once: true });
            return nextTheme;
        }

        ensureToggleSlots();
        body.dataset.theme = nextTheme;
        body.dataset.themePreference = nextTheme;
        syncLegacyFlags(nextTheme);
        updateMetaThemeColor(nextTheme);
        refreshToggleButtons(nextTheme);

        if (persist) localStorage.setItem(STORAGE_KEY, nextTheme);
        return nextTheme;
    }

    function applySavedTheme() {
        return applyTheme(getSavedTheme(), false);
    }

    function toggleTheme() {
        const current = normalizeTheme(getBody()?.dataset.themePreference || getSavedTheme());
        const next = getNextThemePreference(current);
        return applyTheme(next, true);
    }

    function setTheme(theme) {
        return applyTheme(theme, true);
    }

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.theme-switcher')) {
            closeThemeMenu();
            document.querySelectorAll('.theme-switcher-btn').forEach((button) => button.setAttribute('aria-expanded', 'false'));
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeThemeMenu();
            document.querySelectorAll('.theme-switcher-btn').forEach((button) => button.setAttribute('aria-expanded', 'false'));
        }
    });

    window.addEventListener('resize', () => {
        document.querySelectorAll('.theme-switcher.is-open').forEach((node) => positionThemeMenu(node));
    });

    window.addEventListener('scroll', () => {
        document.querySelectorAll('.theme-switcher.is-open').forEach((node) => positionThemeMenu(node));
    }, true);

    window.themeRuntime = {
        THEMES,
        getSavedTheme,
        getAppliedTheme,
        applySavedTheme,
        applyTheme,
        setTheme,
        toggleTheme,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applySavedTheme, { once: true });
    } else {
        applySavedTheme();
    }
})();
