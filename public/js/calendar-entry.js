import wsManager from '/js/websocket.js';

function toggleElement(id, visible) {
  const element = document.getElementById(id);
  if (!element) return;
  element.style.display = visible ? '' : 'none';
  if ('disabled' in element) {
    element.disabled = !visible;
  }
}

async function initCalendarAccess() {
  try {
    const response = await fetch('/api/user-info', { cache: 'no-store' });
    if (!response.ok) return;

    const data = await response.json();

    const capabilities = data.planCapabilities || {};
    toggleElement('nav-notes-btn', capabilities.notesEnabled !== false);
    toggleElement('nav-calendar-btn', capabilities.calendarEnabled !== false);
    toggleElement('nav-contacts-btn', capabilities.contactsEnabled !== false);
    toggleElement('reminder-settings-btn', capabilities.remindersEnabled !== false);
    toggleElement('subscription-btn', capabilities.calendarSubscriptionsEnabled !== false);
    toggleElement('add-subscription-btn', capabilities.calendarSubscriptionsEnabled !== false);
    toggleElement('export-btn', capabilities.importExport !== false);
    toggleElement('import-btn', capabilities.importExport !== false);
    toggleElement('new-event-btn', capabilities.calendarEnabled !== false);
    toggleElement('batch-add-text-btn', capabilities.calendarEnabled !== false || capabilities.todosEnabled !== false);
    toggleElement('todo-add-btn', capabilities.todosEnabled !== false);
    toggleElement('event-add-btn', capabilities.calendarEnabled !== false);
  } catch (error) {
    console.error('加载管理工作台入口失败:', error);
  }
}

async function initCalendarRealtime() {
  window.wsManager = wsManager;
  try {
    await wsManager.connect();
  } catch (error) {
    console.error(error);
  }
}

initCalendarAccess();
initCalendarRealtime();
