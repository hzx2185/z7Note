(function initContactsEntry() {
  function toggleElement(id, visible) {
    const element = document.getElementById(id);
    if (!element) return;
    element.style.display = visible ? '' : 'none';
    if ('disabled' in element) {
      element.disabled = !visible;
    }
  }

  async function syncWorkspaceEntry() {
    try {
      const response = await fetch('/api/user-info', { cache: 'no-store' });
      if (!response.ok) return;

      const data = await response.json();
      const capabilities = data.planCapabilities || {};
      toggleElement('nav-notes-btn', capabilities.notesEnabled !== false);
      toggleElement('nav-calendar-btn', capabilities.calendarEnabled !== false);
      toggleElement('nav-contacts-btn', capabilities.contactsEnabled !== false);
      toggleElement('contacts-add-btn', capabilities.contactsEnabled !== false);
      toggleElement('contacts-batch-delete-btn', capabilities.contactsEnabled !== false);
      toggleElement('contacts-batch-merge-btn', capabilities.contactsEnabled !== false);
      toggleElement('contacts-dedupe-btn', capabilities.contactsEnabled !== false);
      toggleElement('contacts-format-btn', capabilities.contactsEnabled !== false);
      toggleElement('contacts-batch-edit-btn', capabilities.contactsEnabled !== false);
      toggleElement('contacts-columns-btn', capabilities.contactsEnabled !== false);
      toggleElement('contacts-import-btn', capabilities.importExport !== false);
      toggleElement('contacts-export-btn', capabilities.importExport !== false);
    } catch (error) {
      console.error('加载工作区入口失败:', error);
    }
  }

  syncWorkspaceEntry();
  if (typeof window.load === 'function') {
    window.load();
  }
})();
