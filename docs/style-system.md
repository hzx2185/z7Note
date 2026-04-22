# Style System

## Current Layers

- `public/css/tokens.css`
  Defines shared spacing, radius, font, shadow, and transition tokens.
- `public/css/base.css`
  Defines reset, typography inheritance, links, and scrollbar defaults.
- `public/css/components.css`
  Defines reusable primitives such as `.btn`, `.card`, and `.tool-btn`.
- `public/css/themes/theme-default.css`
  Defines the default app and site theme variables.
- `public/css/themes/theme-midnight.css`
  Provides an example alternate theme for both app and site surfaces.
- `public/css/pages/page-app.css`
  Holds workspace-specific layout and interaction styles.
- `public/css/pages/page-site.css`
  Holds public-site shell styles shared by homepage and future marketing pages.
- `public/css/app.css`
  Compatibility entry for app-style pages.
- `public/css/site.css`
  Entry for public site pages.

## Theme Model

Set theme and surface at the `body` level:

```html
<body data-ui-surface="app" data-theme="default">
<body data-ui-surface="site" data-theme="default">
```

Supported themes now:

- `default`
- `midnight`

Runtime switching is handled by `public/js/theme-runtime.js`.
It persists the current template in `localStorage['ui-theme']` and keeps legacy dark/light flags in sync for older app styles.

## How To Build A New Theme Template

1. Copy `public/css/themes/theme-midnight.css` to a new file such as `theme-paper.css`.
2. Override variables only. Do not rewrite component classes first.
3. Add one block for `data-ui-surface="app"` and one block for `data-ui-surface="site"` if both need support.
4. Import the file from `public/css/app.css` and `public/css/site.css`.
5. Switch the page with `data-theme="paper"`.

## Rules

- Put color, shadow, and radius changes in theme files.
- Put reusable UI rules in `components.css`.
- Put layout-only rules in `pages/`.
- Avoid new inline `style=""` unless the value is truly dynamic at runtime.
- When adding a new page, prefer linking `site.css` or `app.css` first, then keep only page-specific adjustments locally.

## Workspace List Page Template

For app-style list pages such as contacts and future admin/resource lists, prefer this shell:

```html
<body data-ui-surface="app">
  <div class="header workspace-header">
    ...
  </div>

  <div class="workspace-main workspace-main-offset workspace-main-stack workspace-main-padded workspace-list-shell">
    <div class="workspace-panel workspace-panel-row workspace-toolbar">
      <div class="workspace-search">
        <input class="workspace-search-input">
      </div>
      <div class="workspace-pagination">
        <select class="workspace-page-select"></select>
        <button class="workspace-page-btn">...</button>
        <input class="workspace-page-input">
      </div>
    </div>

    <div class="workspace-panel workspace-table-shell">
      <table class="workspace-table">
        ...
      </table>
    </div>
  </div>
</body>
```

Recommended shared classes for list pages:

- Shell: `workspace-main-offset`, `workspace-main-stack`, `workspace-main-padded`, `workspace-list-shell`
- Toolbar: `workspace-panel-row`, `workspace-toolbar`, `workspace-actions-scroll`
- Search and pagination: `workspace-search`, `workspace-search-input`, `workspace-pagination`, `workspace-page-select`, `workspace-page-btn`, `workspace-page-input`
- Table: `workspace-table`, `workspace-table-head`, `workspace-table-cell`, `workspace-table-row`, `workspace-table-row-active`, `workspace-cell-check`, `workspace-table-shell`

Keep only business-specific column widths, row decorations, and modal content styles in the page file.
