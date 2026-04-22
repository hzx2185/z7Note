export function enhanceUIMarker(UIManager) {
  Object.assign(UIManager, {
    setMarkerStart() {
      if (!this.editor) {
        this.updateStatus('error', '请先打开笔记');
        return;
      }

      try {
        this.clearMarkerHighlights();

        const cursor = this.editor.getCursor();
        if (cursor) {
          this.markerStart = { ...cursor };
          this.markerActive = true;

          if (this.markerEnd) {
            this.markerEnd = null;
          }

          this.updateStatus('success', `📍 标记起: 行 ${cursor.line + 1}, 列 ${cursor.ch + 1}`);

          if (this.markerEnd) {
            this.selectMarkerRange();
          }

          this.highlightMarkerLine(cursor.line, 'start');
          this.updateMarkerButtonState('start');
        }
      } catch (error) {
        console.error('设置标记起始位置失败:', error);
        this.updateStatus('error', '设置标记起始位置失败');
      }
    },

    setMarkerEnd() {
      if (!this.editor) {
        this.updateStatus('error', '请先打开笔记');
        return;
      }

      try {
        const cursor = this.editor.getCursor();
        if (cursor) {
          this.markerEnd = { ...cursor };

          if (this.markerStart) {
            this.updateStatus('success', `🏁 标记终: 行 ${cursor.line + 1}, 列 ${cursor.ch + 1}`);
            this.selectMarkerRange();
            this.highlightMarkerLine(cursor.line, 'end');
            this.updateMarkerButtonState('end');
          } else {
            this.updateStatus('warning', '⚠️ 请先设置标记起始位置');
            this.markerEnd = null;
          }
        }
      } catch (error) {
        console.error('设置标记结束位置失败:', error);
        this.updateStatus('error', '设置标记结束位置失败');
      }
    },

    selectMarkerRange() {
      if (!this.markerStart || !this.markerEnd || !this.editor) {
        return;
      }

      try {
        if (this.editor._editor && this.editor._editor.setSelection) {
          const from = {
            line: this.markerStart.line,
            ch: this.markerStart.ch,
          };
          const to = {
            line: this.markerEnd.line,
            ch: this.markerEnd.ch,
          };

          this.editor._editor.setSelection(from, to);
          this.editor._editor.scrollIntoView(from, 100);

          const selectedText = this.editor.getSelection();
          const textLength = selectedText ? selectedText.length : 0;
          const lineCount = Math.abs(to.line - from.line) + 1;
          this.updateStatus('success', `已选择 ${lineCount} 行, ${textLength} 个字符`);
          this.highlightMarkerRange(from, to);
        } else {
          const content = this.editor.getValue();
          const lines = content.split('\n');

          let fromIndex = 0;
          for (let i = 0; i < this.markerStart.line; i += 1) {
            fromIndex += (lines[i] || '').length + 1;
          }
          fromIndex += this.markerStart.ch;

          let toIndex = 0;
          for (let i = 0; i < this.markerEnd.line; i += 1) {
            toIndex += (lines[i] || '').length + 1;
          }
          toIndex += this.markerEnd.ch;

          this.editor.setSelection(fromIndex, toIndex);

          const selectedText = this.editor.getSelection();
          const textLength = selectedText ? selectedText.length : 0;
          const lineCount = Math.abs(this.markerEnd.line - this.markerStart.line) + 1;
          this.updateStatus('success', `已选择 ${lineCount} 行, ${textLength} 个字符`);
        }
      } catch (error) {
        console.error('选择标记区域失败:', error);
        this.updateStatus('error', '选择标记区域失败');
      }
    },

    highlightMarkerLine(line, type) {
      if (!this.editor) return;

      try {
        this.editor.addLineClass(line, 'background', `marker-${type}`);

        if (this.markerTimeouts[`line-${line}-${type}`]) {
          clearTimeout(this.markerTimeouts[`line-${line}-${type}`]);
        }
      } catch (error) {
        console.error('高亮标记行失败:', error);
      }
    },

    highlightMarkerRange(from, to) {
      if (!this.editor) return;

      try {
        const existingMarks = this.editor.getAllMarks ? this.editor.getAllMarks() : [];
        existingMarks.forEach((mark) => {
          if (mark.className === 'marker-highlight') {
            mark.clear();
          }
        });

        if (this.markerTimeouts.range) {
          clearTimeout(this.markerTimeouts.range);
        }

        const textMark = this.editor.markText(from, to, {
          className: 'marker-highlight',
          clearOnEnter: false,
        });

        this._currentRangeMark = textMark;
      } catch (error) {
        console.error('高亮标记区域失败:', error);
      }
    },

    clearMarkerHighlights() {
      if (!this.editor) return;

      try {
        if (this.markerStart) {
          this.editor.removeLineClass(this.markerStart.line, 'background', 'marker-start');
        }
        if (this.markerEnd) {
          this.editor.removeLineClass(this.markerEnd.line, 'background', 'marker-end');
        }

        const marks = this.editor.getAllMarks ? this.editor.getAllMarks() : [];
        marks.forEach((mark) => {
          if (mark.className === 'marker-highlight') {
            mark.clear();
          }
        });
      } catch (error) {
        console.error('清除标记高亮失败:', error);
      }
    },

    updateMarkerButtonState(type) {
      const startBtn = document.querySelector('button[onclick="ui.setMarkerStart()"]');
      const endBtn = document.querySelector('button[onclick="ui.setMarkerEnd()"]');

      if (!startBtn || !endBtn) return;

      startBtn.style.background = '';
      startBtn.style.borderColor = '';
      endBtn.style.background = '';
      endBtn.style.borderColor = '';

      if (type === 'start' || (this.markerStart && !this.markerEnd)) {
        startBtn.style.background = 'rgba(34, 197, 94, 0.2)';
        startBtn.style.borderColor = '#22c55e';
      } else if (type === 'end' || (this.markerStart && this.markerEnd)) {
        endBtn.style.background = 'rgba(239, 68, 68, 0.2)';
        endBtn.style.borderColor = '#ef4444';
        startBtn.style.background = 'rgba(34, 197, 94, 0.2)';
        startBtn.style.borderColor = '#22c55e';
      }
    },

    clearMarker() {
      this.markerStart = null;
      this.markerEnd = null;
      this.markerActive = false;

      this.clearMarkerHighlights();

      Object.values(this.markerTimeouts).forEach((timer) => clearTimeout(timer));
      this.markerTimeouts = {};

      this.updateStatus('idle', '标记已清除');
      this.updateMarkerButtonState('clear');
    },

    async copyMarkerRange() {
      if (!this.markerStart || !this.markerEnd || !this.editor) {
        this.updateStatus('warning', '请先设置标记区域');
        return;
      }

      try {
        this.selectMarkerRange();

        const selectedText = this.editor.getSelection();
        if (!selectedText) {
          this.updateStatus('warning', '没有选中的文本');
          return;
        }

        try {
          await navigator.clipboard.writeText(selectedText);
          this.updateStatus('success', `已复制 ${selectedText.length} 个字符`);
        } catch (clipboardError) {
          try {
            document.execCommand('copy');
            this.updateStatus('success', `已复制 ${selectedText.length} 个字符`);
          } catch (execError) {
            this.updateStatus('error', '复制失败,请手动复制');
          }
        }
      } catch (error) {
        console.error('复制标记区域失败:', error);
        this.updateStatus('error', '复制标记区域失败');
      }
    },

    cutMarkerRange() {
      if (!this.markerStart || !this.markerEnd || !this.editor) {
        this.updateStatus('warning', '请先设置标记区域');
        return;
      }

      try {
        this.selectMarkerRange();
        this.execCommand('cut');
        this.clearMarker();
        this.updateStatus('success', '已剪切标记区域');
      } catch (error) {
        this.updateStatus('error', '剪切标记区域失败');
      }
    },

    deleteMarkerRange() {
      if (!this.markerStart || !this.markerEnd || !this.editor) {
        this.updateStatus('warning', '请先设置标记区域');
        return;
      }

      try {
        this.selectMarkerRange();
        this.editor.replaceSelection('');
        this.clearMarker();
        this.updateStatus('success', '已删除标记区域');
      } catch (error) {
        this.updateStatus('error', '删除标记区域失败');
      }
    },

    execCommand(command) {
      if (!this.editor) return;

      try {
        if (this.editor.execCommand) {
          this.editor.execCommand(command);
        } else {
          document.execCommand(command);
        }
      } catch (error) {
        console.error('执行命令失败:', error);
      }
    },

    setupMarkerShortcuts() {
      if (!this.editor) return;

      try {
        const editorElement = this.editor.getWrapperElement();
        if (!editorElement) return;

        if (this._markerKeyHandler) {
          editorElement.removeEventListener('keydown', this._markerKeyHandler);
        }

        this._markerKeyHandler = (e) => {
          const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
          const modifierKey = isMac ? e.metaKey : e.ctrlKey;

          if (modifierKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
            return;
          }

          if (modifierKey && (e.key.toLowerCase() === 'y' || (isMac && e.shiftKey && e.key.toLowerCase() === 'z'))) {
            e.preventDefault();
            this.redo();
            return;
          }

          if (modifierKey && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            this.toggleSidebar();
            return;
          }

          if (e.altKey && e.key === '[') {
            e.preventDefault();
            this.setMarkerStart();
            return;
          }

          if (e.altKey && e.key === ']') {
            e.preventDefault();
            this.setMarkerEnd();
            return;
          }

          if (modifierKey && e.shiftKey && e.key === 'C') {
            e.preventDefault();
            this.copyMarkerRange();
            return;
          }

          if (modifierKey && e.shiftKey && e.key === 'X') {
            e.preventDefault();
            this.cutMarkerRange();
            return;
          }

          if (modifierKey && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            this.deleteMarkerRange();
            return;
          }

          if (e.key === 'Escape') {
            this.clearMarker();
          }
        };

        editorElement.addEventListener('keydown', this._markerKeyHandler);
      } catch (error) {
        console.error('设置标记快捷键失败:', error);
      }
    },

    cleanupMarkerShortcuts() {
      if (!this.editor || !this._markerKeyHandler) return;

      try {
        const editorElement = this.editor.getWrapperElement();
        if (editorElement) {
          editorElement.removeEventListener('keydown', this._markerKeyHandler);
        }
        this._markerKeyHandler = null;
      } catch (error) {
        console.error('清除标记快捷键失败:', error);
      }
    },
  });
}
