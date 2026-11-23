// ============================================================
// 主题切换 + 页眉/页脚注入 + 通用 UI 工具
// 依赖：style.css
// ============================================================

(function () {
  'use strict';

  // ---------- BASE 路径 ----------
  // 统一使用绝对路径 /，避免在子页面请求接口时路径错乱
  const BASE = '/';

  // ---------- 主题 ----------
  const STORAGE_KEY = 'xigem-theme';
  const DEFAULT_THEME = 'light';

  function getStoredTheme() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function setStoredTheme(theme) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
  }
  function resolveTheme() {
    const stored = getStoredTheme();
    if (stored === 'light' || stored === 'dark') return stored;
    return DEFAULT_THEME;
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.querySelector('.theme-toggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? '☀' : '☾';
      btn.setAttribute('aria-label', theme === 'dark' ? '切换到浅色' : '切换到深色');
    }
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setStoredTheme(next);
  }

  // 立即应用（按钮此时可能还不存在，注入后再同步一次）
  applyTheme(resolveTheme());

  // ---------- 页眉 / 页脚 ----------
  async function renderHeader() {
    const el = document.querySelector('[data-include="header"]');
    if (!el) return;

    // 如果是登录页，不需要渲染复杂的头部
    if (window.location.pathname.includes('login')) {
      el.innerHTML = ''; 
      return;
    }

    const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
    
    let isAdmin = false;
    try {
      // ✅ 修复：加上 BASE 前缀，确保接口路径正确
      const res = await fetch(BASE + 'api/me', { credentials: 'same-origin' });
      
      // 如果未登录（401），不报错，直接按普通用户处理（后续会被拦截器踢回登录页）
      if (res.ok) {
        const data = await res.json();
        if (data.username === '#admin#' || data.adminAuthenticated) {
          isAdmin = true;
        }
      }
    } catch (e) {}

    // 基础导航
    const links = [
      { href: BASE, label: '主页' },
      { href: BASE + 'list.html', label: '录屏列表' }
    ];
    
    // 动态追加管理员
    if (isAdmin) {
      links.push({ href: BASE + 'admin.html', label: '管理员' });
    }

    el.outerHTML = `
      <header class="site-header">
        <div class="container">
          <a class="brand" href="${BASE}">
            <img class="brand-logo" src="${BASE}logo.png" alt="logo" onerror="this.style.display='none'">
            <span>XIGEMBiliREC</span>
          </a>
          <nav>
            ${links.map(l => {
              const isActive = currentPath === l.href || (l.href !== BASE && currentPath.startsWith(l.href.replace('.html', '')));
              return `<a href="${l.href}"${isActive ? ' class="active"' : ''}>${l.label}</a>`;
            }).join('')}
          </nav>
          <div class="header-right">
            <button class="theme-toggle" type="button" aria-label="切换主题">☾</button>
            <button class="btn btn-primary" id="logoutBtn" type="button">退出</button>
          </div>
        </div>
      </header>
    `;

    const tbtn = document.querySelector('.theme-toggle');
    if (tbtn) tbtn.addEventListener('click', toggleTheme);

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          await fetch(BASE + 'api/logout', { method: 'POST', credentials: 'same-origin' });
        } catch (e) {}
        window.location.href = BASE + 'login'; 
      });
    }

    applyTheme(resolveTheme());
  }

  function renderFooter() {
    const el = document.querySelector('[data-include="footer"]');
    if (!el) return;
    el.outerHTML = `
      <footer class="site-footer">
        <div class="container">
          <p>XIGEMBiliREC · Beta 0.1.2</p>
        </div>
      </footer>
    `;
  }

  // ---------- 通用 UI：Toast ----------
  function ensureToastStack() {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(message, type, duration) {
    type = type || 'info';
    duration = typeof duration === 'number' ? duration : 3000;
    const stack = ensureToastStack();
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 200ms';
      setTimeout(() => el.remove(), 220);
    }, duration);
  }

  // ---------- 通用 UI：Modal ----------
  function openModal(options) {
    options = options || {};
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        ${options.title ? `<h3 class="modal-title">${escapeHtml(options.title)}</h3>` : ''}
        <div class="modal-body"></div>
        <div class="modal-actions">
          <button type="button" class="btn" data-modal-cancel>${escapeHtml(options.cancelText || '取消')}</button>
          <button type="button" class="btn btn-primary" data-modal-confirm>${escapeHtml(options.confirmText || '确定')}</button>
        </div>
      </div>
    `;
    const body = overlay.querySelector('.modal-body');
    if (options.content instanceof Node) body.appendChild(options.content);
    else if (typeof options.content === 'string') body.innerHTML = options.content;

    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);

    overlay.querySelector('[data-modal-cancel]').addEventListener('click', close);
    overlay.querySelector('[data-modal-confirm]').addEventListener('click', () => {
      const result = options.onConfirm ? options.onConfirm(overlay) : true;
      if (result !== false) close();
    });
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });

    return { close, overlay };
  }

  // ---------- 通用 UI：加载态 / 空状态 ----------
  function setLoading(container, text) {
    container.innerHTML = `
      <div class="loading-block">
        <span class="spinner"></span>
        <span>${escapeHtml(text || '加载中…')}</span>
      </div>
    `;
  }

  function setEmpty(container, title, desc) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◌</div>
        <div class="empty-title">${escapeHtml(title || '暂无数据')}</div>
        <div>${escapeHtml(desc || '')}</div>
      </div>
    `;
  }

  // ---------- 工具 ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function api(path, options) {
    options = options || {};
    const res = await fetch(BASE + path.replace(/^\//, ''), {
      credentials: 'same-origin',
      headers: Object.assign({ 'Content-Type': 'application/json' }, options.headers || {}),
      ...options
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const msg = (data && data.error) || ('请求失败 ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- 启动 ----------
  function boot() {
    renderHeader();
    renderFooter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 暴露给业务页面
  window.XIGEM = {
    BASE,
    toast,
    openModal,
    setLoading,
    setEmpty,
    api,
    escapeHtml
  };
})();