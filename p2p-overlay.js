/*!
 * P2P Page Overlay — мультиплеер для любой страницы на базе Trystero (https://trystero.dev)
 * --------------------------------------------------------------------------------------
 * Что делает:
 *  - Подключает посетителей сайта друг к другу через WebRTC (без своего сервера).
 *  - Показывает живые курсоры/тачи людей, которые сейчас на ТОЙ ЖЕ странице.
 *  - Общий чат на весь сайт (домен) + системный лог: кто зашёл, кто вышел,
 *    кто перешёл на другую страницу.
 *  - Счётчик "сейчас на этой странице" и "сейчас на сайте".
 *  - Работает на ПК (мышь) и мобиле (касания), через плавающую кнопку.
 *  - Безопасен для повторного подключения скрипта — если он уже загружен,
 *    повторная вставка ничего не делает (работает только первый экземпляр).
 *
 * Подключение (один раз, в любом месте HTML, лучше перед </body>):
 *   <script src="p2p-overlay.js"></script>
 *
 * Больше ничего подключать не нужно — Trystero сам подгружается изнутри
 * этого файла через dynamic import с официального CDN (esm.run).
 */
(function () {
  'use strict';

  // ---------- 1. Защита от дублирования ----------
  // Если скрипт уже работает на странице (например, вставлен дважды,
  // или другой плагин/виджет/менеджер тегов тоже его подключил) —
  // выходим немедленно. Работает только самый первый экземпляр.
  if (window.__p2pOverlayLoaded) {
    console.info('[p2p-overlay] Уже запущен на этой странице — пропускаю повторную инициализацию.');
    return;
  }
  window.__p2pOverlayLoaded = true;

  // ---------- 2. Конфигурация ----------
  const CONFIG = {
    // appId изолирует вашу сеть от чужих пользователей Trystero на том же signaling-backend.
    // Берём из домена сайта, чтобы разные сайты не видели друг друга.
    appId: 'p2p-overlay:' + location.hostname,
    // Комната уровня "весь сайт" — для чата, лога входов/выходов/переходов и списка "кто на сайте".
    siteRoomId: 'site',
    // Комната уровня "эта страница" — для курсоров/тачей и списка "кто на этой странице".
    // Нормализуем URL (без query/hash), чтобы ?utm=... не создавал отдельную комнату.
    pageRoomId: 'page:' + location.origin + location.pathname,
    // Сколько системных сообщений держать в логе одновременно.
    maxLogLines: 80,
    // Цвета для курсоров/аватаров — стабильно назначаются по peerId.
    palette: ['#ff5d5d', '#ffb24c', '#ffe14c', '#7ee787', '#4cc9ff', '#7c8bff', '#d97cff', '#ff7cc6'],
  };

  // ---------- 3. Утилиты ----------
  const STORAGE_KEY = 'p2pOverlayName';
  function getStoredName() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function setStoredName(name) {
    try { localStorage.setItem(STORAGE_KEY, name); } catch (e) {}
  }
  function randomName() {
    const adjectives = ['Тихий', 'Быстрый', 'Смелый', 'Ловкий', 'Юркий', 'Звёздный', 'Туманный', 'Шумный', 'Спокойный', 'Дикий'];
    const animals = ['Лис', 'Енот', 'Сокол', 'Барсук', 'Кит', 'Волк', 'Ёж', 'Орёл', 'Заяц', 'Рысь'];
    return adjectives[Math.floor(Math.random() * adjectives.length)] + ' ' + animals[Math.floor(Math.random() * animals.length)] + ' ' + Math.floor(Math.random() * 90 + 10);
  }
  function colorForPeer(peerId) {
    let hash = 0;
    for (let i = 0; i < peerId.length; i++) hash = (hash * 31 + peerId.charCodeAt(i)) >>> 0;
    return CONFIG.palette[hash % CONFIG.palette.length];
  }
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  function timeNow() {
    const d = new Date();
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }
  function shortPath(pathname) {
    if (pathname === '/' || pathname === '') return 'главную страницу';
    return pathname.length > 40 ? pathname.slice(0, 40) + '…' : pathname;
  }

  // ---------- 4. Стили (изолированы префиксом, чтобы не конфликтовать с хостом) ----------
  const style = document.createElement('style');
  style.textContent = `
    .p2pov-root, .p2pov-root * { box-sizing: border-box; }
    .p2pov-root {
      position: fixed; z-index: 2147483646; bottom: 20px; right: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px; line-height: 1.4; color: #1c1c1e;
      pointer-events: none;
    }
    .p2pov-fab {
      pointer-events: auto;
      width: 56px; height: 56px; border-radius: 50%;
      background: #16181d; color: #fff; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 18px rgba(0,0,0,.28);
      position: relative; transition: transform .15s ease;
    }
    .p2pov-fab:hover { transform: scale(1.06); }
    .p2pov-fab svg { width: 24px; height: 24px; }
    .p2pov-badge {
      position: absolute; top: -4px; right: -4px;
      background: #34c759; color: #fff; font-size: 11px; font-weight: 700;
      min-width: 18px; height: 18px; border-radius: 9px; padding: 0 4px;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff;
    }
    .p2pov-panel {
      pointer-events: auto;
      position: absolute; bottom: 68px; right: 0;
      width: 320px; max-width: calc(100vw - 32px);
      max-height: 70vh; min-height: 320px;
      background: #fff; border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,.25);
      display: flex; flex-direction: column; overflow: hidden;
      opacity: 0; transform: translateY(8px) scale(.98);
      transition: opacity .15s ease, transform .15s ease;
      visibility: hidden;
    }
    .p2pov-panel.p2pov-open { opacity: 1; transform: translateY(0) scale(1); visibility: visible; }
    .p2pov-head {
      padding: 12px 14px; border-bottom: 1px solid #eee;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      background: #fafafa;
    }
    .p2pov-head-title { font-weight: 600; font-size: 13px; color: #111; }
    .p2pov-head-sub { font-size: 11px; color: #888; margin-top: 1px; }
    .p2pov-tabs { display: flex; border-bottom: 1px solid #eee; background: #fff; }
    .p2pov-tab {
      flex: 1; padding: 8px 0; text-align: center; font-size: 12px; font-weight: 600;
      color: #999; cursor: pointer; border-bottom: 2px solid transparent; background: none; border-top:none;border-left:none;border-right:none;
    }
    .p2pov-tab.p2pov-active { color: #111; border-bottom-color: #16181d; }
    .p2pov-body { flex: 1; overflow-y: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; }
    .p2pov-body::-webkit-scrollbar { width: 6px; }
    .p2pov-body::-webkit-scrollbar-thumb { background: #ddd; border-radius: 3px; }
    .p2pov-msg { font-size: 13px; word-wrap: break-word; }
    .p2pov-msg b { color: #111; }
    .p2pov-sys { font-size: 12px; color: #999; font-style: italic; }
    .p2pov-sys.p2pov-join { color: #2a9d3f; }
    .p2pov-sys.p2pov-leave { color: #c0392b; }
    .p2pov-sys.p2pov-nav { color: #8a6d00; }
    .p2pov-time { color: #bbb; font-size: 11px; margin-right: 4px; }
    .p2pov-inputrow { display: flex; gap: 6px; padding: 10px; border-top: 1px solid #eee; }
    .p2pov-input {
      flex: 1; border: 1px solid #ddd; border-radius: 10px; padding: 8px 10px;
      font-size: 13px; outline: none; font-family: inherit;
    }
    .p2pov-input:focus { border-color: #16181d; }
    .p2pov-send {
      background: #16181d; color: #fff; border: none; border-radius: 10px;
      padding: 0 14px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .p2pov-send:disabled { opacity: .4; cursor: default; }
    .p2pov-peoplelist { display: flex; flex-direction: column; gap: 4px; }
    .p2pov-person { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 4px 2px; }
    .p2pov-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .p2pov-empty { color: #aaa; font-size: 12px; text-align: center; padding: 20px 0; }
    .p2pov-namepill {
      pointer-events: auto; cursor: pointer; font-size: 11px; color: #888;
      padding: 2px 6px; border-radius: 6px; background: #f1f1f1; align-self: flex-end;
      margin-bottom: 4px;
    }

    /* Курсоры/тачи других людей на странице */
    .p2pov-cursor {
      position: fixed; top: 0; left: 0; z-index: 2147483647;
      pointer-events: none; will-change: transform;
      transition: transform .08s linear; display: flex; align-items: flex-start; gap: 4px;
    }
    .p2pov-cursor svg { width: 20px; height: 20px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
    .p2pov-cursor-label {
      margin-top: 12px; padding: 2px 6px; border-radius: 6px; color: #fff;
      font-size: 11px; font-weight: 600; white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    @media (max-width: 480px) {
      .p2pov-root { bottom: 14px; right: 14px; }
      .p2pov-panel { width: calc(100vw - 28px); right: -6px; }
    }
  `;
  document.head.appendChild(style);

  // ---------- 5. UI: корневой узел, кнопка, панель ----------
  const root = document.createElement('div');
  root.className = 'p2pov-root';
  root.innerHTML = `
    <div class="p2pov-panel" id="p2pov-panel">
      <div class="p2pov-head">
        <div>
          <div class="p2pov-head-title">Люди рядом</div>
          <div class="p2pov-head-sub" id="p2pov-counts">подключение…</div>
        </div>
        <div class="p2pov-namepill" id="p2pov-namepill" title="Изменить ваше имя">вы: …</div>
      </div>
      <div class="p2pov-tabs">
        <button class="p2pov-tab p2pov-active" data-tab="chat">Чат</button>
        <button class="p2pov-tab" data-tab="page">На странице</button>
        <button class="p2pov-tab" data-tab="site">На сайте</button>
      </div>
      <div class="p2pov-body" id="p2pov-body"></div>
      <div class="p2pov-inputrow" id="p2pov-inputrow">
        <input class="p2pov-input" id="p2pov-input" type="text" maxlength="500" placeholder="Сообщение для всего сайта…" autocomplete="off" />
        <button class="p2pov-send" id="p2pov-send">→</button>
      </div>
    </div>
    <button class="p2pov-fab" id="p2pov-fab" title="Люди рядом">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <span class="p2pov-badge" id="p2pov-badge">1</span>
    </button>
  `;
  document.body.appendChild(root);

  const els = {
    panel: root.querySelector('#p2pov-panel'),
    fab: root.querySelector('#p2pov-fab'),
    badge: root.querySelector('#p2pov-badge'),
    counts: root.querySelector('#p2pov-counts'),
    namepill: root.querySelector('#p2pov-namepill'),
    body: root.querySelector('#p2pov-body'),
    input: root.querySelector('#p2pov-input'),
    send: root.querySelector('#p2pov-send'),
    inputrow: root.querySelector('#p2pov-inputrow'),
    tabs: Array.from(root.querySelectorAll('.p2pov-tab')),
  };

  let myName = getStoredName() || randomName();
  setStoredName(myName);
  els.namepill.textContent = 'вы: ' + myName;

  let activeTab = 'chat';
  const logLines = [];   // системный лог + чат, общий для сайта
  const sitePeople = new Map(); // peerId -> {name, path}
  const pagePeople = new Map(); // peerId -> {name}

  function setTab(tab) {
    activeTab = tab;
    els.tabs.forEach(t => t.classList.toggle('p2pov-active', t.dataset.tab === tab));
    els.inputrow.style.display = tab === 'chat' ? 'flex' : 'none';
    renderBody();
  }
  els.tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

  function renderBody() {
    if (activeTab === 'chat') {
      els.body.innerHTML = logLines.map(renderLogLine).join('');
      els.body.scrollTop = els.body.scrollHeight;
    } else if (activeTab === 'page') {
      els.body.innerHTML = renderPeopleList(pagePeople, 'Пока вы здесь один(на).');
    } else {
      els.body.innerHTML = renderPeopleList(sitePeople, 'Пока на сайте только вы.');
    }
  }

  function renderLogLine(line) {
    const t = `<span class="p2pov-time">${line.time}</span>`;
    if (line.kind === 'chat') {
      return `<div class="p2pov-msg">${t}<b style="color:${line.color}">${escapeHtml(line.name)}:</b> ${escapeHtml(line.text)}</div>`;
    }
    return `<div class="p2pov-sys p2pov-${line.kind}">${t}${escapeHtml(line.text)}</div>`;
  }

  function renderPeopleList(map, emptyText) {
    if (map.size === 0) return `<div class="p2pov-empty">${emptyText}</div>`;
    let html = '<div class="p2pov-peoplelist">';
    map.forEach((info, peerId) => {
      html += `<div class="p2pov-person"><span class="p2pov-dot" style="background:${colorForPeer(peerId)}"></span>${escapeHtml(info.name)}${info.path ? '<span style="color:#aaa;font-size:11px;margin-left:auto">' + escapeHtml(shortPath(info.path)) + '</span>' : ''}</div>`;
    });
    html += '</div>';
    return html;
  }

  function pushLog(kind, text, extra) {
    logLines.push(Object.assign({ kind, text, time: timeNow() }, extra));
    if (logLines.length > CONFIG.maxLogLines) logLines.shift();
    if (activeTab === 'chat') renderBody();
  }

  function updateCounts() {
    els.counts.textContent = `на странице: ${pagePeople.size + 1} · на сайте: ${sitePeople.size + 1}`;
    els.badge.textContent = String(sitePeople.size + 1);
  }

  els.fab.addEventListener('click', () => {
    const willOpen = !els.panel.classList.contains('p2pov-open');
    els.panel.classList.toggle('p2pov-open', willOpen);
    if (willOpen) setTab(activeTab);
  });

  els.namepill.addEventListener('click', () => {
    const next = prompt('Ваше имя для чата:', myName);
    if (next && next.trim()) {
      myName = next.trim().slice(0, 30);
      setStoredName(myName);
      els.namepill.textContent = 'вы: ' + myName;
      if (window.__p2pov_announceRename) window.__p2pov_announceRename(myName);
    }
  });

  function sendChat() {
    const text = els.input.value.trim();
    if (!text) return;
    els.input.value = '';
    if (window.__p2pov_sendChat) window.__p2pov_sendChat(text);
  }
  els.send.addEventListener('click', sendChat);
  els.input.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  // ---------- 6. Курсоры/тачи поверх страницы ----------
  const cursorEls = new Map(); // peerId -> DOM element
  function ensureCursorEl(peerId, name) {
    let el = cursorEls.get(peerId);
    if (el) return el;
    el = document.createElement('div');
    el.className = 'p2pov-cursor';
    const color = colorForPeer(peerId);
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="${color}" stroke="#fff" stroke-width="1"><path d="M4 2l16 8-7 2-2 7z"/></svg><span class="p2pov-cursor-label" style="background:${color}">${escapeHtml(name || 'Гость')}</span>`;
    document.body.appendChild(el);
    cursorEls.set(peerId, el);
    return el;
  }
  function moveCursor(peerId, x, y, name) {
    const el = ensureCursorEl(peerId, name);
    el.style.transform = `translate(${x}px, ${y}px)`;
  }
  function removeCursor(peerId) {
    const el = cursorEls.get(peerId);
    if (el) { el.remove(); cursorEls.delete(peerId); }
  }

  // ---------- 7. Загрузка Trystero и сетевая логика ----------
  setTab('chat');
  pushLog('join', 'Подключение к сети…');

  import('https://cdn.jsdelivr.net/npm/@trystero-p2p/torrent@0.25.1/+esm')
    .then(({ joinRoom }) => {
      try {
      logLines.length = 0; // убираем технический "подключение…", дальше пойдут реальные события

      const myPath = location.pathname;
      const siteRoom = joinRoom({ appId: CONFIG.appId }, CONFIG.siteRoomId);
      const pageRoom = joinRoom({ appId: CONFIG.appId }, CONFIG.pageRoomId);

      const chatAction = siteRoom.makeAction('chat');
      const siteHelloAction = siteRoom.makeAction('hello'); // {name, path}
      const siteRenameAction = siteRoom.makeAction('rename');
      const siteNavAction = siteRoom.makeAction('nav'); // {path}
      const pageHelloAction = pageRoom.makeAction('hello');
      const pageRenameAction = pageRoom.makeAction('rename');
      const cursorAction = pageRoom.makeAction('cursor'); // {x, y, name, type}

      function broadcastHello() {
        siteHelloAction.send({ name: myName, path: myPath });
        pageHelloAction.send({ name: myName });
      }

      siteRoom.onPeerJoin = peerId => {
        sitePeople.set(peerId, { name: 'Гость', path: null });
        siteHelloAction.send({ name: myName, path: myPath }, peerId);
        updateCounts();
      };
      siteRoom.onPeerLeave = peerId => {
        const info = sitePeople.get(peerId);
        pushLog('leave', `${info ? info.name : 'Кто-то'} покинул сайт.`);
        sitePeople.delete(peerId);
        updateCounts();
        if (activeTab === 'site') renderBody();
      };
      siteHelloAction.onMessage = (data, { peerId }) => {
        const wasKnown = sitePeople.has(peerId) && sitePeople.get(peerId).name !== 'Гость';
        sitePeople.set(peerId, { name: data.name, path: data.path });
        if (!wasKnown) pushLog('join', `${data.name} зашёл(шла) на сайт.`);
        updateCounts();
        if (activeTab === 'site') renderBody();
      };
      siteRenameAction.onMessage = (data, { peerId }) => {
        const info = sitePeople.get(peerId);
        const oldName = info ? info.name : 'Кто-то';
        if (info) info.name = data.name;
        pushLog('nav', `${oldName} теперь называется «${data.name}».`);
        if (activeTab === 'site') renderBody();
      };
      siteNavAction.onMessage = (data, { peerId }) => {
        const info = sitePeople.get(peerId);
        if (info) info.path = data.path;
        pushLog('nav', `${info ? info.name : 'Кто-то'} перешёл(шла) на ${shortPath(data.path)}.`);
        if (activeTab === 'site') renderBody();
      };
      chatAction.onMessage = (data, { peerId }) => {
        const info = sitePeople.get(peerId);
        pushLog('chat', data.text, { name: info ? info.name : 'Гость', color: colorForPeer(peerId) });
      };

      pageRoom.onPeerJoin = peerId => {
        pagePeople.set(peerId, { name: 'Гость' });
        pageHelloAction.send({ name: myName }, peerId);
        updateCounts();
        if (activeTab === 'page') renderBody();
      };
      pageRoom.onPeerLeave = peerId => {
        pagePeople.delete(peerId);
        removeCursor(peerId);
        updateCounts();
        if (activeTab === 'page') renderBody();
      };
      pageHelloAction.onMessage = (data, { peerId }) => {
        pagePeople.set(peerId, { name: data.name });
        updateCounts();
        if (activeTab === 'page') renderBody();
      };
      pageRenameAction.onMessage = (data, { peerId }) => {
        const info = pagePeople.get(peerId);
        if (info) info.name = data.name;
        if (activeTab === 'page') renderBody();
      };
      cursorAction.onMessage = (data, { peerId }) => {
        if (data.type === 'leave') { removeCursor(peerId); return; }
        moveCursor(peerId, data.x, data.y, data.name);
      };

      updateCounts();

      // --- хуки для UI ---
      window.__p2pov_sendChat = text => {
        chatAction.send({ text });
        pushLog('chat', text, { name: myName, color: '#16181d' });
      };
      window.__p2pov_announceRename = name => {
        siteRenameAction.send({ name });
        pageRenameAction.send({ name });
      };

      // --- курсор мыши (ПК) ---
      let lastSent = 0;
      window.addEventListener('mousemove', e => {
        const now = performance.now();
        if (now - lastSent < 40) return; // лёгкий троттлинг ~25fps
        lastSent = now;
        cursorAction.send({ x: e.clientX, y: e.clientY, name: myName, type: 'move' });
      });

      // --- тачи (мобила) ---
      window.addEventListener('touchstart', handleTouch, { passive: true });
      window.addEventListener('touchmove', handleTouch, { passive: true });
      window.addEventListener('touchend', () => cursorAction.send({ type: 'leave', name: myName }));
      function handleTouch(e) {
        const t = e.touches[0];
        if (!t) return;
        cursorAction.send({ x: t.clientX, y: t.clientY, name: myName, type: 'move' });
      }

      // --- отслеживание перехода на другую страницу внутри сайта (SPA-роутинг) ---
      function announceNav(newPath) {
        siteNavAction.send({ path: newPath });
      }
      ['pushState', 'replaceState'].forEach(fn => {
        const orig = history[fn];
        history[fn] = function (...args) {
          const ret = orig.apply(this, args);
          setTimeout(() => { if (location.pathname !== myPath) announceNav(location.pathname); }, 0);
          return ret;
        };
      });
      window.addEventListener('popstate', () => announceNav(location.pathname));

      // --- уход со страницы/закрытие вкладки ---
      window.addEventListener('beforeunload', () => {
        cursorAction.send({ type: 'leave', name: myName });
      });

      // первое приветствие всем уже находящимся в комнатах
      broadcastHello();
      } catch (initErr) {
        console.error('[p2p-overlay] Ошибка инициализации:', initErr);
        const detail = (initErr && (initErr.message || String(initErr))) || 'неизвестная ошибка';
        pushLog('leave', 'Ошибка инициализации: ' + detail);
      }
    })
    .catch(err => {
      console.error('[p2p-overlay] Не удалось загрузить Trystero:', err);
      const detail = (err && (err.message || String(err))) || 'неизвестная ошибка';
      pushLog('leave', 'Ошибка подключения: ' + detail);
    });
})();
