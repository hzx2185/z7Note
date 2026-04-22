export function enhanceUIAccount(UIManager) {
  Object.assign(UIManager, {
    _showEmailModalFeedback(msg, isSuccess = false) {
      const feedbackEl = document.getElementById('modal-email-feedback');
      if (!feedbackEl) return;
      feedbackEl.textContent = msg;
      feedbackEl.classList.remove('workspace-hidden', 'is-success', 'is-error');
      feedbackEl.classList.add(isSuccess ? 'is-success' : 'is-error');
    },

    promptBindEmail() {
      const modal = document.getElementById('email-modal');
      if (modal) {
        modal.style.display = 'flex';
        document.getElementById('modal-email-input').value = '';
        document.getElementById('modal-code-input').value = '';
        const feedbackEl = document.getElementById('modal-email-feedback');
        if (feedbackEl) feedbackEl.classList.add('workspace-hidden');
        const btn = document.getElementById('modal-send-btn');
        btn.textContent = '发送验证码';
        btn.disabled = false;
        setTimeout(() => document.getElementById('modal-email-input')?.focus(), 0);
      }
    },

    closeEmailModal() {
      const modal = document.getElementById('email-modal');
      if (modal) modal.style.display = 'none';
    },

    async modalSendCode() {
      const email = document.getElementById('modal-email-input').value.trim();
      if (!email || !email.includes('@')) {
        this._showEmailModalFeedback('请输入正确的邮箱地址', false);
        return;
      }

      const btn = document.getElementById('modal-send-btn');
      btn.disabled = true;
      this._showEmailModalFeedback('正在发送...', true);

      try {
        const res = await fetch('/api/send-bind-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const contentType = res.headers.get('content-type');
        let data = {};
        if (contentType && contentType.includes('application/json')) {
          data = await res.json();
        }

        if (res.ok) {
          this._showEmailModalFeedback('验证码已发送至您的邮箱', true);
          setTimeout(() => document.getElementById('modal-code-input')?.focus(), 0);

          let count = 60;
          btn.textContent = `${count}s`;
          const timer = setInterval(() => {
            count--;
            if (count <= 0) {
              clearInterval(timer);
              btn.disabled = false;
              btn.textContent = '发送验证码';
            } else {
              btn.textContent = `${count}s`;
            }
          }, 1000);
        } else {
          if (data.error && data.error.includes('会话已过期')) {
            this._showEmailModalFeedback('会话已过期，请重新登录', false);
            setTimeout(() => {
              window.location.href = '/login.html';
            }, 1500);
            return;
          }

          this._showEmailModalFeedback(data.error || '发送失败', false);
          btn.disabled = false;
        }
      } catch (e) {
        console.error('[SendCode] 网络连接或解析异常:', e);
        this._showEmailModalFeedback('发送失败，请检查网络', false);
        btn.disabled = false;
      }
    },

    async modalVerifyCode() {
      const btn = document.getElementById('modal-verify-btn');
      if (btn.disabled) {
        return;
      }

      const email = document.getElementById('modal-email-input').value.trim();
      const code = document.getElementById('modal-code-input').value.trim();

      if (!email || !code) {
        this._showEmailModalFeedback('请填写邮箱和验证码', false);
        return;
      }

      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '验证中...';
      this._showEmailModalFeedback('正在验证验证码...', true);

      let shouldKeepDisabled = false;

      try {
        const res = await fetch('/api/verify-bind-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, token: code })
        });

        let data = {};
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          try {
            data = await res.json();
          } catch (e) {
            console.error('[VerifyEmail] JSON 解析失败:', e);
          }
        }

        if (res.ok) {
          this._showEmailModalFeedback('绑定成功！正在刷新...', true);
          shouldKeepDisabled = true;
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        } else {
          if (res.status === 502) {
            this._showEmailModalFeedback('服务器响应异常 (502)，请稍后重试', false);
            console.error('[VerifyEmail] 服务器返回 502 错误');
          } else if (res.status === 401 || (data.error && data.error.includes('会话已过期'))) {
            this._showEmailModalFeedback('会话已过期，请重新登录', false);
            shouldKeepDisabled = true;
            setTimeout(() => {
              window.location.href = '/login.html';
            }, 1500);
          } else if (res.status === 400) {
            this._showEmailModalFeedback(data.error || '验证码错误', false);
          } else {
            this._showEmailModalFeedback(data.error || `验证失败 (${res.status})`, false);
          }
        }
      } catch (e) {
        console.error('[VerifyEmail] 网络连接或解析异常:', e);
        this._showEmailModalFeedback('无法连接到服务器，请检查网络', false);
      } finally {
        if (!shouldKeepDisabled) {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      }
    },

    showChangePasswordModal() {
      const modal = document.getElementById('change-password-modal');
      if (modal) {
        modal.style.display = 'flex';
        document.getElementById('old-password-input').value = '';
        document.getElementById('new-password-input').value = '';
        document.getElementById('confirm-password-input').value = '';
        document.getElementById('change-password-error').style.display = 'none';
        document.getElementById('change-password-btn').disabled = false;
        document.getElementById('change-password-btn').textContent = '确认修改';
        setTimeout(() => document.getElementById('old-password-input')?.focus(), 0);

        const userDisplay = document.getElementById('user-display');
        const usernameInput = document.getElementById('username-input');
        if (userDisplay && usernameInput) {
          const text = userDisplay.textContent;
          const username = text.replace('用户: ', '');
          usernameInput.value = username;
        }
      }
    },

    closeChangePasswordModal() {
      const modal = document.getElementById('change-password-modal');
      if (modal) modal.style.display = 'none';
    },

    async changePassword() {
      const oldPass = document.getElementById('old-password-input').value.trim();
      const newPass = document.getElementById('new-password-input').value.trim();
      const confirmPass = document.getElementById('confirm-password-input').value.trim();
      const errorEl = document.getElementById('change-password-error');
      const btn = document.getElementById('change-password-btn');

      if (!oldPass || !newPass || !confirmPass) {
        errorEl.textContent = '请填写所有字段';
        errorEl.style.display = 'block';
        return;
      }

      if (newPass.length < 6) {
        errorEl.textContent = '新密码至少需要6个字符';
        errorEl.style.display = 'block';
        return;
      }

      if (newPass !== confirmPass) {
        errorEl.textContent = '两次输入的新密码不一致';
        errorEl.style.display = 'block';
        return;
      }

      errorEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = '修改中...';

      try {
        const res = await fetch('/api/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ oldPass, newPass })
        });

        if (res.ok) {
          this.showToast('密码修改成功');
          this.closeChangePasswordModal();
        } else {
          const data = await res.json();
          errorEl.textContent = data.error || '修改失败';
          errorEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '确认修改';
        }
      } catch (e) {
        errorEl.textContent = '修改失败，请稍后重试';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '确认修改';
      }
    },

    async show2FASettings() {
      const modal = document.getElementById('2fa-modal');
      const content = document.getElementById('2fa-content');

      if (!modal || !content) return;

      modal.style.display = 'flex';
      content.innerHTML = '<div class="twofa-panel"><div class="twofa-card"><div class="twofa-feedback">加载中...</div></div></div>';

      try {
        const res = await fetch('/api/2fa/status');
        if (res.ok) {
          const data = await res.json();
          this.render2FAContent(data);
        } else if (res.status === 404) {
          content.innerHTML = this.render2FAStateMessage('⚠️', '功能未实现', '两步验证功能需要后端支持，请联系管理员启用此功能');
        } else {
          content.innerHTML = this.render2FAStateMessage('⚠️', '加载失败', '暂时无法获取两步验证状态，请稍后再试。');
        }
      } catch (e) {
        console.error('加载 2FA 状态失败:', e);
        content.innerHTML = this.render2FAStateMessage('⚠️', '网络错误', '无法连接到服务器，请检查网络连接。');
      }
    },

    render2FAStateMessage(icon, title, message, buttonLabel = '关闭', buttonAction = 'window.ui.close2FAModal()') {
      return `
        <div class="twofa-panel">
          <div class="twofa-header">
            <div class="twofa-icon">${icon}</div>
            <div class="twofa-title">${title}</div>
            <div class="twofa-subtitle">${message}</div>
          </div>
          <div class="twofa-actions">
            <button class="btn btn-primary" onclick="${buttonAction}">${buttonLabel}</button>
          </div>
        </div>
      `;
    },

    escapeHtml(value = '') {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    render2FABackupCodes(codes = [], { warning = '', emptyText = '无', primaryAction = '', primaryLabel = '', secondaryAction = '', secondaryLabel = '' } = {}) {
      const hasCodes = Array.isArray(codes) && codes.length > 0;
      const codesHtml = hasCodes
        ? `<div class="twofa-backup-grid">${codes.map((code) => `<div class="twofa-backup-code">${this.escapeHtml(code)}</div>`).join('')}</div>`
        : `<div class="twofa-feedback">${emptyText}</div>`;

      const actions = [
        primaryAction && primaryLabel ? `<button class="btn btn-secondary" onclick="${primaryAction}">${primaryLabel}</button>` : '',
        secondaryAction && secondaryLabel ? `<button class="btn btn-primary" onclick="${secondaryAction}">${secondaryLabel}</button>` : ''
      ].filter(Boolean).join('');

      return `
        <div class="twofa-card">
          <div class="twofa-card-title">备用代码${hasCodes ? `（${codes.length}）` : ''}</div>
          ${warning ? `<div class="twofa-feedback twofa-warning">${warning}</div>` : ''}
          ${codesHtml}
          ${actions ? `<div class="twofa-actions">${actions}</div>` : ''}
        </div>
      `;
    },

    render2FAContent(data) {
      const content = document.getElementById('2fa-content');
      if (!content) return;

      if (data.enabled) {
        const backupCodes = Array.isArray(data.backupCodes) ? data.backupCodes : [];
        this.currentBackupCodes = backupCodes;
        content.innerHTML = `
          <div class="twofa-panel">
            <div class="twofa-header">
              <div class="twofa-icon">✅</div>
              <div class="twofa-title">两步验证已启用</div>
              <div class="twofa-subtitle">账户已受保护，可使用动态验证码或备用代码登录。</div>
            </div>
            ${this.render2FABackupCodes(backupCodes, {
              emptyText: '当前没有可用备用代码。',
              primaryAction: 'window.ui.copyBackupCodes()',
              primaryLabel: '复制代码',
              secondaryAction: 'window.ui.refreshBackupCodes()',
              secondaryLabel: backupCodes.length > 0 ? '重新生成' : '生成备用代码'
            })}
            <div class="twofa-actions">
              <button class="btn btn-secondary" onclick="window.ui.close2FAModal()">取消</button>
              <button class="btn btn-danger" onclick="window.ui.disable2FA()">停用两步验证</button>
            </div>
          </div>
        `;
      } else {
        content.innerHTML = `
          <div class="twofa-panel">
            <div class="twofa-header">
              <div class="twofa-icon">🔐</div>
              <div class="twofa-title">启用两步验证</div>
              <div class="twofa-subtitle">使用验证器应用扫描二维码，或复制完整 otpauth 连接手动导入。</div>
            </div>
            <div class="twofa-card">
              <div class="twofa-card-title">验证器配置</div>
              <div id="2fa-qrcode" class="twofa-qr">
                <div class="twofa-feedback">加载中...</div>
              </div>
            </div>
            <div class="twofa-card">
              <div class="twofa-card-title">密钥</div>
              <div id="2fa-secret" class="twofa-secret">-</div>
            </div>
            <div class="twofa-card">
              <div class="twofa-card-title">完整连接</div>
              <div class="twofa-block">
                <textarea id="2fa-uri" class="twofa-uri-input" readonly spellcheck="false">-</textarea>
              </div>
              <div class="twofa-actions">
                <button class="btn btn-secondary" type="button" onclick="window.ui.copy2FAUri()">复制连接</button>
              </div>
            </div>
            <div class="twofa-card">
              <div class="twofa-card-title">验证码</div>
              <input type="text" id="2fa-code" class="twofa-code-input" placeholder="输入 6 位验证码" maxlength="6" autocomplete="one-time-code" inputmode="numeric" data-bwignore="true">
            </div>
            <div class="twofa-actions">
              <button class="btn btn-secondary" onclick="window.ui.close2FAModal()">取消</button>
              <button class="btn btn-primary" onclick="window.ui.enable2FA()">启用两步验证</button>
            </div>
          </div>
        `;

        this.generate2FAQRCode();
      }
    },

    async generate2FAQRCode() {
      try {
        const res = await fetch('/api/2fa/setup', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          const qrContainer = document.getElementById('2fa-qrcode');
          const secretSpan = document.getElementById('2fa-secret');
          const uriEl = document.getElementById('2fa-uri');

          if (qrContainer && data.qrCode) {
            qrContainer.innerHTML = `<img src="${data.qrCode}" alt="2FA QR Code">`;
          }

          if (secretSpan && data.secret) {
            secretSpan.textContent = data.secret;
          }

          if (uriEl && data.otpAuthUrl) {
            uriEl.textContent = data.otpAuthUrl;
          }

          setTimeout(() => document.getElementById('2fa-code')?.focus(), 0);
        }
      } catch (e) {
        console.error('生成 2FA QR 码失败:', e);
      }
    },

    async copy2FAUri() {
      const uri = document.getElementById('2fa-uri')?.value?.trim() || document.getElementById('2fa-uri')?.textContent?.trim();
      if (!uri || uri === '-') {
        this.showToast('暂无可复制的连接', false);
        return;
      }

      try {
        await navigator.clipboard.writeText(uri);
        this.showToast('完整连接已复制');
      } catch (e) {
        console.error('复制 2FA 连接失败:', e);
        this.showToast('复制失败', false);
      }
    },

    async enable2FA() {
      const code = document.getElementById('2fa-code')?.value.trim();
      if (!code || code.length !== 6) {
        this.showToast('请输入6位验证码', false);
        return;
      }

      try {
        const res = await fetch('/api/2fa/enable', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: code })
        });

        if (res.ok) {
          const data = await res.json();
          this.showToast('两步验证已启用');

          const content = document.getElementById('2fa-content');
          if (content) {
            const backupCodes = Array.isArray(data.backupCodes) ? data.backupCodes : [];
            this.currentBackupCodes = backupCodes;
            content.innerHTML = `
              <div class="twofa-panel">
                <div class="twofa-header">
                  <div class="twofa-icon">✅</div>
                  <div class="twofa-title">两步验证已成功启用</div>
                  <div class="twofa-subtitle">您的账户现在已受保护，请立即保存备用代码。</div>
                </div>
                ${this.render2FABackupCodes(backupCodes, {
                  warning: '请妥善保存以下备用代码，每个代码只能使用一次。',
                  primaryAction: 'window.ui.copyBackupCodes()',
                  primaryLabel: '复制备用代码'
                })}
                <div class="twofa-actions">
                  <button class="btn btn-primary" onclick="window.ui.close2FAModal()">确定</button>
                </div>
              </div>
            `;
          }

          this.update2FAStatus(true);
        } else {
          const data = await res.json();
          this.showToast(data.message || data.error || '启用失败', false);
        }
      } catch (e) {
        console.error('启用 2FA 失败:', e);
        this.showToast('启用失败', false);
      }
    },

    async copyBackupCodes() {
      if (this.currentBackupCodes && this.currentBackupCodes.length > 0) {
        try {
          await navigator.clipboard.writeText(this.currentBackupCodes.join('\n'));
          this.showToast('备用代码已复制到剪贴板');
        } catch (e) {
          console.error('复制失败:', e);
          this.showToast('复制失败', false);
        }
      }
    },

    async disable2FA() {
      if (!confirm('确定要禁用两步验证吗？这将降低账户安全性。')) {
        return;
      }

      try {
        const res = await fetch('/api/2fa/disable', {
          method: 'POST'
        });

        if (res.ok) {
          this.showToast('两步验证已禁用');
          this.close2FAModal();
          this.update2FAStatus(false);
        } else {
          const data = await res.json();
          this.showToast(data.error || '禁用失败', false);
        }
      } catch (e) {
        console.error('禁用 2FA 失败:', e);
        this.showToast('禁用失败', false);
      }
    },

    async refreshBackupCodes() {
      if (!confirm('确定要重新生成备用代码吗？这将使所有旧的备用代码失效。')) {
        return;
      }

      try {
        const res = await fetch('/api/2fa/refresh-backup-codes', {
          method: 'POST'
        });

        if (res.ok) {
          const data = await res.json();
          this.currentBackupCodes = data.backupCodes;
          const content = document.getElementById('2fa-content');
          if (content) {
            content.innerHTML = `
              <div class="twofa-panel">
                <div class="twofa-header">
                  <div class="twofa-icon">✅</div>
                  <div class="twofa-title">备用代码已重新生成</div>
                  <div class="twofa-subtitle">旧代码已失效，请保存新的备用代码。</div>
                </div>
                ${this.render2FABackupCodes(data.backupCodes, {
                  primaryAction: 'window.ui.copyBackupCodes()',
                  primaryLabel: '复制备用代码'
                })}
                <div class="twofa-actions">
                  <button class="btn btn-primary" onclick="window.ui.show2FASettings()">返回</button>
                </div>
              </div>
            `;
          }

          this.showToast('备用代码已重新生成');
        } else {
          const data = await res.json();
          this.showToast(data.message || data.error || '重新生成失败', false);
        }
      } catch (e) {
        console.error('重新生成备用代码失败:', e);
        this.showToast('重新生成失败', false);
      }
    },

    close2FAModal() {
      const modal = document.getElementById('2fa-modal');
      if (modal) modal.style.display = 'none';
    },

    update2FAStatus(enabled) {
      const statusDiv = document.getElementById('2fa-status');
      const statusText = document.getElementById('2fa-status-text');

      if (statusDiv && statusText) {
        statusDiv.style.display = 'block';
        statusText.textContent = enabled ? '已启用 ✅' : '未启用';
        statusText.style.color = enabled ? 'var(--green)' : 'var(--gray)';
      }
    }
  });
}
