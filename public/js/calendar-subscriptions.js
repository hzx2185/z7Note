(function() {
  window.createCalendarSubscriptionHandlers = function(dependencies) {
    const { render, sidebarRenderer } = dependencies;
    const getHandlers = () => dependencies.handlers;

    return {
    openSubscriptionModal: () => {
      document.getElementById('subscription-modal').classList.add('show');
      getHandlers().loadSubscriptions();
    },

    openSubscriptionForm: (subscription = null) => {
      const modal = document.getElementById('subscription-form-modal');
      const title = document.getElementById('subscription-form-title');
      const form = document.getElementById('subscription-form');

      title.textContent = subscription ? '编辑订阅' : '添加订阅';

      if (subscription) {
        form.dataset.subscriptionId = subscription.id;
        form.name.value = subscription.name;
        form.url.value = subscription.url;
        form.color.value = subscription.color;
      } else {
        delete form.dataset.subscriptionId;
        form.reset();
        form.color.value = '#6366f1';
      }

      modal.classList.add('show');
    },

    closeSubscriptionModals: () => {
      document.getElementById('subscription-modal').classList.remove('show');
      document.getElementById('subscription-form-modal').classList.remove('show');
    },

    showSubscriptionStatus(message, isError = false) {
      const container = document.getElementById('subscription-list');
      if (!container) return;

      let status = document.getElementById('subscription-status');
      if (!status) {
        status = document.createElement('div');
        status.id = 'subscription-status';
        status.style.cssText = 'margin-bottom:8px;padding:8px 10px;border-radius:6px;font-size:12px;';
        container.parentNode.insertBefore(status, container);
      }

      status.textContent = message;
      status.style.display = 'block';
      status.style.background = isError ? 'rgba(220,38,38,0.12)' : 'rgba(37,99,235,0.12)';
      status.style.color = isError ? '#dc2626' : 'var(--accent)';

      clearTimeout(status._timer);
      status._timer = setTimeout(() => {
        status.style.display = 'none';
      }, 2600);
    },

    async requestSubscription(url, options = {}, fallbackMessage = '操作失败') {
      let response;
      try {
        response = await fetch(url, {
          credentials: 'include',
          ...options
        });
      } catch (error) {
        throw new Error('网络连接失败，请稍后重试');
      }

      let data = null;
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (error) {
          throw new Error(`${fallbackMessage}，服务器返回了无效响应`);
        }
      }

      if (!response.ok) {
        throw new Error(data?.error || fallbackMessage);
      }

      return data;
    },

    async loadSubscriptions() {
      try {
        const subscriptions = await getHandlers().requestSubscription('/api/calendar-subscriptions', {}, '加载订阅失败');
        getHandlers().renderSubscriptions(subscriptions);
      } catch (error) {
        console.error('加载订阅失败:', error);
        getHandlers().showSubscriptionStatus(error.message || '加载订阅失败', true);
      }
    },

    renderSubscriptions(subscriptions) {
      const container = document.getElementById('subscription-list');

      if (!subscriptions || subscriptions.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无订阅</div>';
        return;
      }

      container.innerHTML = subscriptions.map(sub => `
        <div class="subscription-item">
          <div class="subscription-swatch" style="background: ${sub.color};"></div>
          <div class="subscription-copy">
            <div class="subscription-name">${sub.name}</div>
            <div class="subscription-url">${sub.url}</div>
          </div>
          <div class="subscription-actions">
            <button type="button" class="subscription-btn sync-sub-btn" data-sub-id="${sub.id}">同步</button>
            <button type="button" class="subscription-btn edit-sub-btn" data-sub-id="${sub.id}">编辑</button>
            <button type="button" class="subscription-btn delete-sub-btn" data-sub-id="${sub.id}">删除</button>
          </div>
        </div>
      `).join('');

        // 绑定事件
        container.querySelectorAll('.sync-sub-btn').forEach(btn => {
          btn.addEventListener('click', () => this.syncSubscription(btn.dataset.subId));
        });
        container.querySelectorAll('.edit-sub-btn').forEach(btn => {
          btn.addEventListener('click', () => this.editSubscription(btn.dataset.subId));
        });
        container.querySelectorAll('.delete-sub-btn').forEach(btn => {
          btn.addEventListener('click', () => this.deleteSubscription(btn.dataset.subId));
        });
    },

    async handleSubscriptionSubmit(e) {
      e.preventDefault();
      const form = e.target;
      const formData = new FormData(form);

      const subscriptionId = form.dataset.subscriptionId;
      const data = {
        name: formData.get('name'),
        url: formData.get('url'),
        color: formData.get('color')
      };

      try {
        const url = subscriptionId
          ? `/api/calendar-subscriptions/${subscriptionId}`
          : '/api/calendar-subscriptions';
        const method = subscriptionId ? 'PUT' : 'POST';

        await getHandlers().requestSubscription(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        }, subscriptionId ? '更新订阅失败' : '创建订阅失败');

        getHandlers().closeSubscriptionModals();
        await getHandlers().loadSubscriptions();
        getHandlers().showSubscriptionStatus(subscriptionId ? '订阅已更新' : '订阅已创建');
      } catch (error) {
        console.error('保存订阅失败:', error);
        getHandlers().showSubscriptionStatus(error.message || '保存失败', true);
      }
    },

    async syncSubscription(id) {
      try {
        const result = await getHandlers().requestSubscription(`/api/calendar-subscriptions/${id}/sync`, {
          method: 'POST',
        }, '同步订阅失败');
        getHandlers().showSubscriptionStatus(`同步成功，导入 ${result.imported} 个事件`);

        render.calendar();
        sidebarRenderer.refresh();
      } catch (error) {
        console.error('同步订阅失败:', error);
        getHandlers().showSubscriptionStatus(error.message || '同步失败', true);
      }
    },

    async editSubscription(id) {
      try {
        const subscription = await getHandlers().requestSubscription(`/api/calendar-subscriptions/${id}`, {}, '获取订阅失败');
        getHandlers().openSubscriptionForm(subscription);
      } catch (error) {
        console.error('获取订阅失败:', error);
        getHandlers().showSubscriptionStatus(error.message || '获取订阅失败', true);
      }
    },

    async deleteSubscription(id) {
      if (!(await getHandlers().showConfirm('确定要删除这个订阅吗？这将同时删除该订阅的所有事件。'))) return;

      try {
        await getHandlers().requestSubscription(`/api/calendar-subscriptions/${id}`, {
          method: 'DELETE',
        }, '删除订阅失败');

        await getHandlers().loadSubscriptions();
        getHandlers().showSubscriptionStatus('订阅已删除');

        render.calendar();
        sidebarRenderer.refresh();
      } catch (error) {
        console.error('删除订阅失败:', error);
        getHandlers().showSubscriptionStatus(error.message || '删除失败', true);
      }
    }
    };
  };
})();
