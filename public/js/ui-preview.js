export function enhanceUIPreview(UIManager) {
  Object.assign(UIManager, {
    async openDedicatedPreview() {
      const modal = document.getElementById('dedicated-preview-modal');
      const iframe = document.getElementById('dedicated-preview-frame');
      if (!modal || !iframe) return;

      let txt = '';
      if (this.editor && this.editor.getValue) {
        txt = this.editor.getValue();
      }

      await this.ensureMarkedLoaded();

      let html = '';
      if (window.marked) {
        html = marked.parse(txt);
        if (typeof DOMPurify !== 'undefined') {
          html = DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ['a', 'b', 'i', 'em', 'strong', 'code', 'pre', 'p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'br', 'hr', 'input', 'del', 's', 'u', 'sup', 'sub'],
            ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'name', 'type', 'checked', 'disabled', 'width', 'height', 'target', 'rel'],
            ALLOW_DATA_ATTR: false
          });
        }
        html = html.replace(/(src|href)=["']\/api\/uploads\/([^"']+)["']/ig, (m, p1, p2) => {
          return `${p1}="/api/attachments/raw/${encodeURIComponent(p2)}"`;
        });
      }

      this._setIframeSrcDoc(iframe, html);
      modal.style.display = 'flex';
    },

    closeDedicatedPreview() {
      const modal = document.getElementById('dedicated-preview-modal');
      if (modal) modal.style.display = 'none';
    },

    printPreviewFromModal() {
      const iframe = document.getElementById('dedicated-preview-frame');
      if (!iframe?.contentWindow) return;

      const win = iframe.contentWindow;
      win.focus();
      win.print();
    },

    printPreview() {
      const iframe = document.getElementById('preview-frame');
      if (!iframe) return;

      this.updatePreview(true);

      setTimeout(() => {
        try {
          const win = iframe.contentWindow;
          if (!win) return;

          const style = win.document.createElement('style');
          style.innerHTML = `
            @media print {
              body { padding: 0 !important; }
              .copy-code-btn, .pdf-placeholder, .media-placeholder { display: none !important; }
              pre { white-space: pre-wrap !important; word-break: break-all !important; }
            }
          `;
          win.document.head.appendChild(style);

          win.focus();
          win.print();
        } catch (e) {
          console.error('打印失败:', e);
          const content = iframe.srcdoc;
          const printWin = window.open('', '_blank');
          if (printWin) {
            printWin.document.write(content);
            printWin.document.close();
            printWin.onload = () => {
              printWin.focus();
              printWin.print();
            };
          }
        }
      }, 500);
    },

    syncScroll(src, type) {
      if (this.isScrolling || document.getElementById('main-view').className !== 'split') return;
      this.isScrolling = true;
      const iframe = document.getElementById('preview-frame');
      if (!iframe?.contentWindow) return;
      const previewScroll = iframe.contentWindow.document.documentElement;
      if (!previewScroll) {
        this.isScrolling = false;
        return;
      }

      let editorScrollTop = 0;
      let editorScrollHeight = 0;
      let editorClientHeight = 0;

      if (this.editor && this.editor.getScrollTop) {
        editorScrollTop = this.editor.getScrollTop();
        editorScrollHeight = this.editor.getScrollHeight();
        editorClientHeight = this.editor.getLayoutInfo().height;
      } else {
        editorScrollTop = src.scrollTop;
        editorScrollHeight = src.scrollHeight;
        editorClientHeight = src.clientHeight;
      }

      const pct = editorScrollTop / (editorScrollHeight - editorClientHeight);
      if (type === 'editor') previewScroll.scrollTop = pct * (previewScroll.scrollHeight - previewScroll.clientHeight);
      else if (this.editor && this.editor.setScrollTop) {
        this.editor.setScrollTop(pct * (editorScrollHeight - editorClientHeight));
      } else if (src && src.scrollTop !== undefined) {
        src.scrollTop = pct * (src.scrollHeight - src.clientHeight);
      }

      setTimeout(() => { this.isScrolling = false; }, 50);
    },

    updatePreview(force = false) {
      const mainView = document.getElementById('main-view');
      const viewMode = mainView ? mainView.className : '';
      const isPreviewVisible = viewMode === 'split' || viewMode === 'preview-only';

      if (!isPreviewVisible && !force) {
        return;
      }

      let txt = '';
      if (this.editor && this.editor.getValue) {
        txt = this.editor.getValue();
      }

      if (txt === this._lastPreviewContent && !force) {
        return;
      }

      if (this._previewDebounceTimer) {
        clearTimeout(this._previewDebounceTimer);
      }

      const delay = force ? 0 : 300;
      this._previewDebounceTimer = setTimeout(() => {
        this._doUpdatePreview(txt, force);
      }, delay);
    }
  });
}
