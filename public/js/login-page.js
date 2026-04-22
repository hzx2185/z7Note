let isLogin = true;
let tempToken = null;

function show(id, msg) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = msg;
  element.style.display = 'block';
}

function hide(id) {
  const element = document.getElementById(id);
  if (!element) return;
  element.style.display = 'none';
}

function toast(message) {
  const toastElement = document.getElementById('toast');
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.style.display = 'block';
  setTimeout(() => {
    toastElement.style.display = 'none';
  }, 3000);
}

function modal(message) {
  const modalMessage = document.getElementById('modalMsg');
  const modalElement = document.getElementById('modal');
  if (!modalMessage || !modalElement) return;
  modalMessage.textContent = message;
  modalElement.style.display = 'flex';
}

function toggleMode() {
  isLogin = !isLogin;
  document.getElementById('title').textContent = isLogin ? '用户登录' : '创建新账号';
  document.getElementById('submitBtn').textContent = isLogin ? '立即登录' : '注册并登录';
  document.getElementById('adminToken').style.display = isLogin ? 'none' : 'block';
}

function validateUser(username) {
  if (username.includes('@')) return '用户名不能包含@';
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return '只能包含字母、数字、下划线';
  if (username.length < 3 || username.length > 15) return '长度需3-15位';
  return null;
}

async function finalize(user, message) {
  try {
    const response = await fetch('/api/user-info', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('SESSION_NOT_READY');
    localStorage.setItem('z7note_username', user);
    toast(message);
    setTimeout(() => {
      location.href = '/';
    }, 800);
  } catch {
    show('authErr', '会话未建立，请检查HTTPS配置');
    document.getElementById('submitBtn').disabled = false;
  }
}

async function handleAuth(event) {
  event.preventDefault();
  const user = document.getElementById('username').value.trim();
  const pass = document.getElementById('password').value;
  const adminToken = document.getElementById('adminToken').value.trim();
  const button = document.getElementById('submitBtn');

  if (!isLogin) {
    const error = validateUser(user);
    if (error) return show('authErr', error);
    if (pass.length < 6) return show('authErr', '密码至少6位');
  }

  button.disabled = true;
  button.textContent = '验证中...';
  hide('authErr');

  try {
    const response = await fetch(isLogin ? '/api/login' : '/api/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, pass, adminToken })
    });
    const data = await response.json();
    if (response.ok) {
      if (data.status === 'tfa_required') {
        tempToken = data.tempToken;
        document.getElementById('authForm').style.display = 'none';
        document.getElementById('tfaForm').style.display = 'block';
      } else {
        await finalize(user, isLogin ? '登录成功' : '注册成功');
      }
    } else {
      show('authErr', data.error || '失败');
      button.disabled = false;
      button.textContent = isLogin ? '立即登录' : '注册并登录';
    }
  } catch {
    show('authErr', '网络错误');
    button.disabled = false;
  }
}

async function handleTFA(event) {
  event.preventDefault();
  const token = document.getElementById('tfaToken').value.trim();
  const button = document.getElementById('tfaBtn');
  if (token.length !== 6 && token.length !== 8) return show('tfaErr', '请输入6位验证码或8位备用代码');

  button.disabled = true;
  button.textContent = '验证中...';
  hide('tfaErr');

  try {
    const response = await fetch('/api/verify-tfa', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, tfaToken: token })
    });
    const data = await response.json();
    if (response.ok && data.status === 'ok') {
      await finalize(document.getElementById('username').value.trim(), '验证成功');
    } else {
      show('tfaErr', data.error || '验证失败');
      button.disabled = false;
      button.textContent = '验证';
    }
  } catch {
    show('tfaErr', '网络错误');
    button.disabled = false;
  }
}

async function sendCode() {
  const email = document.getElementById('resetEmail').value;
  if (!email.includes('@')) return toast('请输入正确邮箱');
  const button = document.getElementById('codeBtn');
  button.disabled = true;

  try {
    const response = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (response.ok) {
      modal('验证码已发送');
      let countdown = 60;
      const timer = setInterval(() => {
        countdown -= 1;
        button.textContent = `${countdown}s`;
        if (countdown <= 0) {
          clearInterval(timer);
          button.disabled = false;
          button.textContent = '获取验证码';
        }
      }, 1000);
    } else {
      const data = await response.json();
      toast(data.error || '发送失败');
      button.disabled = false;
    }
  } catch {
    toast('网络错误');
    button.disabled = false;
  }
}

async function doReset(event) {
  event.preventDefault();

  try {
    const response = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('resetEmail').value,
        token: document.getElementById('resetToken').value,
        newPass: document.getElementById('newPass').value
      })
    });
    if (response.ok) {
      modal('密码已重置');
      document.getElementById('resetForm').style.display = 'none';
      document.getElementById('authForm').style.display = 'block';
    } else {
      const data = await response.json();
      toast(data.error || '重置失败');
    }
  } catch {
    toast('网络错误');
  }
}

window.toggleMode = toggleMode;
window.handleAuth = handleAuth;
window.handleTFA = handleTFA;
window.sendCode = sendCode;
window.doReset = doReset;
