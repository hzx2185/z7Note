window.createCalendarApi = function createCalendarApi() {
  return {
    async request(url, options = {}) {
      try {
        const response = await fetch(url, {
          ...options,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          }
        });

        if (!response.ok) {
          let detail = '';
          try {
            const payload = await response.json();
            detail = payload?.error || payload?.message || '';
          } catch {
            try {
              detail = (await response.text()).trim();
            } catch {
              detail = '';
            }
          }
          throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        console.error(`API请求失败: ${url}`, error);
        throw error;
      }
    },

    isRetryableGatewayError(error) {
      const message = String(error?.message || error || '');
      return /HTTP 502|HTTP 504|Failed to fetch|NetworkError|Load failed/i.test(message);
    },

    async getDayData(dateStr) {
      try {
        const response = await fetch(`/api/events/calendar/day/${dateStr}?t=${Date.now()}`, {
          credentials: 'include'
        });
        if (!response.ok) {
          if (response.status === 404) {
            return { todos: [], events: [], notes: [] };
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
      } catch (error) {
        return { todos: [], events: [], notes: [] };
      }
    },

      // 搜索数据
      async searchData(query) {
        try {
          const response = await fetch(`/api/events/search?q=${encodeURIComponent(query)}`, {
            credentials: 'include'
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return await response.json();
        } catch (error) {
          console.error('搜索失败:', error);
          return { todos: [], events: [], notes: [] };
        }
      },

    // 获取多天数据
    async getRangeData(startDate, endDate) {
      try {
        const startTs = Math.floor(startDate.getTime() / 1000);
        const endTs = Math.floor(endDate.getTime() / 1000);

        const [todos, events, notes] = await Promise.all([
          this.getMonthTodos(startTs, endTs),
          this.getMonthEvents(startTs, endTs),
          this.getMonthNotes(startTs, endTs)
        ]);

        return { todos, events, notes };
      } catch (error) {
        console.error('获取范围数据失败:', error);
        return { todos: [], events: [], notes: [] };
      }
    },

    async getMonthTodos(startDate, endDate) {
      try {
        const response = await fetch(`/api/todos?startDate=${startDate}&endDate=${endDate}&t=${Date.now()}`, {
          credentials: 'include'
        });
        return response.ok ? await response.json() : [];
      } catch (error) {
        console.error('获取月份数据失败:', error);
        return [];
      }
    },

    async getMonthEvents(startDate, endDate) {
      try {
        const response = await fetch(`/api/events?startDate=${startDate}&endDate=${endDate}&t=${Date.now()}`, {
          credentials: 'include'
        });
        return response.ok ? await response.json() : [];
      } catch (error) {
        console.error('获取月份数据失败:', error);
        return [];
      }
    },

    async getMonthNotes(startDate, endDate) {
      try {
        const response = await fetch(`/api/files`, {
          credentials: 'include'
        });
        const allFiles = response.ok ? await response.json() : [];

        const startDateMs = startDate * 1000;
        const endDateMs = endDate * 1000;

        const filteredFiles = allFiles.filter(file => {
          if (file.updatedAt) {
            return file.updatedAt >= startDateMs && file.updatedAt <= endDateMs;
          }
          return false;
        });

        return filteredFiles || [];
      } catch (error) {
        console.error('获取月份数据失败:', error);
        return [];
      }
    },

    async createTodo(data) {
      return this.request('/api/todos', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    async createEvent(data) {
      return this.request('/api/events', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },

    async toggleTodo(id, completed) {
      return this.request(`/api/todos/${id}/toggle`, {
        method: 'PATCH'
      });
    },

    async deleteTodo(id) {
      return this.request(`/api/todos/${id}`, {
        method: 'DELETE'
      });
    },

    async updateTodo(id, data) {
      return this.request(`/api/todos/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },

    async deleteEvent(id) {
      return this.request(`/api/events/${id}`, {
        method: 'DELETE'
      });
    },

    async deleteRecurringEvent(id, data) {
      const url = `/api/events/${id}/delete-scope`;
      const options = {
        method: 'POST',
        body: JSON.stringify(data)
      };

      try {
        return await this.request(url, options);
      } catch (error) {
        if (!this.isRetryableGatewayError(error)) {
          throw error;
        }

        console.warn('重复事件删除遇到网关/网络抖动，准备重试一次:', error);
        await new Promise(resolve => setTimeout(resolve, 500));
        return this.request(url, options);
      }
    },

    async updateEvent(id, data) {
      return this.request(`/api/events/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },

    async getLunarDate(dateStr) {
      try {
        const response = await fetch(`/api/lunar/${dateStr}`, {
          credentials: 'include'
        });
        return response.ok ? await response.json() : null;
      } catch (error) {
        console.error('获取农历日期失败:', error);
        return null;
      }
    }
  };
};
