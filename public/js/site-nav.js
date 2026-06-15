import { inferMemberTierFromUserInfo, loadMemberTiers } from './member-data.js';

function updateNavForGuest() {
  const authLink = document.querySelector('[data-site-auth-link]');
  const registerLink = document.querySelector('[data-site-register-link]');
  const logoutLink = document.querySelector('[data-site-logout-link]');

  if (authLink) {
    authLink.href = '/login.html';
    authLink.textContent = '登录';
    authLink.classList.remove('is-member');
    authLink.classList.remove('site-hidden');
  }

  if (registerLink) {
    registerLink.classList.remove('site-hidden');
  }

  if (logoutLink) {
    logoutLink.classList.add('site-hidden');
  }
}

function applyModuleVisibility(userInfo = {}) {
  const capabilities = userInfo.planCapabilities || {};
  const moduleMap = {
    notes: capabilities.notesEnabled !== false,
    calendar: capabilities.calendarEnabled !== false,
    contacts: capabilities.contactsEnabled !== false
  };

  document.querySelectorAll('[data-site-module]').forEach((element) => {
    const moduleKey = element.getAttribute('data-site-module');
    const visible = moduleMap[moduleKey] !== false;
    element.style.display = visible ? '' : 'none';
    if ('disabled' in element) {
      element.disabled = !visible;
    }
  });
}

function updateNavForUser(userInfo) {
  const authLink = document.querySelector('[data-site-auth-link]');
  const registerLink = document.querySelector('[data-site-register-link]');
  const logoutLink = document.querySelector('[data-site-logout-link]');
  const tier = inferMemberTierFromUserInfo(userInfo);
  const username = userInfo.username || userInfo.user || '已登录用户';

  if (authLink) {
    authLink.href = '/member';
    authLink.textContent = `${username}`;
    authLink.classList.add('is-member');
    authLink.setAttribute('title', `${tier.name} · ${tier.badge}`);
  }

  if (registerLink) {
    registerLink.classList.add('site-hidden');
  }

  if (logoutLink) {
    logoutLink.classList.remove('site-hidden');
    logoutLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
        window.location.reload();
      } catch (err) {
        console.error('Logout failed:', err);
      }
    });
  }

  document.body.dataset.siteMemberTier = tier.key;
  applyModuleVisibility(userInfo);
}

async function initSiteNav() {
  updateNavForGuest();
  loadMemberTiers().catch(() => {});

  try {
    const response = await fetch('/api/user-info', {
      cache: 'no-store',
      credentials: 'same-origin'
    });

    if (!response.ok) return;

    const userInfo = await response.json();
    if (!userInfo) return;
    updateNavForUser(userInfo);
  } catch {
    // Keep guest navigation if the session check fails.
  }
}

initSiteNav();
