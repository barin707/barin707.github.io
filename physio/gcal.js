// Синхронизация с Google Календарём через Google Calendar API.
// Вход - OAuth 2.0 (токен в браузере), без сервера.
window.createGCal = function (api) {
  'use strict';
  const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
  const API = 'https://www.googleapis.com/calendar/v3';
  const SCOPE = 'https://www.googleapis.com/auth/calendar';
  const TKEY = 'physio-gtoken', SKEY = 'physio-gstate';
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const cfg = () => { const db = api.db(); db.gcal = db.gcal || { calendarId: 'primary', calendarName: 'Основной' }; return db.gcal; };
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

  const getToken = () => {
    try { const t = JSON.parse(localStorage.getItem(TKEY) || 'null'); return t && t.exp > Date.now() + 60000 ? t.token : null; } catch (e) { return null; }
  };
  const setToken = (token, sec) => { try { localStorage.setItem(TKEY, JSON.stringify({ token, exp: Date.now() + sec * 1000 })); } catch (e) {} };
  const clearToken = () => { try { localStorage.removeItem(TKEY); } catch (e) {} };

  // Переход на страницу входа Google. После входа Google вернёт нас обратно с токеном в адресе.
  function login(next) {
    const c = cfg();
    if (!c.clientId) { api.toast('Сначала укажи Client ID'); return; }
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem(SKEY, JSON.stringify({ state, next: next || 'sync' })); } catch (e) {}
    const p = new URLSearchParams({
      client_id: c.clientId, redirect_uri: redirectUri(), response_type: 'token',
      scope: SCOPE, include_granted_scopes: 'true', state
    });
    if (c.email) p.set('login_hint', c.email);
    location.href = `${AUTH}?${p}`;
  }

  // Вызывается при загрузке: забираем токен из адреса после возврата от Google.
  function handleRedirect() {
    const h = location.hash.startsWith('#') ? new URLSearchParams(location.hash.slice(1)) : null;
    if (!h || !(h.has('access_token') || h.has('error'))) return null;
    history.replaceState(null, '', location.pathname + location.search);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SKEY) || 'null'); localStorage.removeItem(SKEY); } catch (e) {}
    if (h.has('error')) { api.toast('Google: вход отменён'); return null; }
    if (!saved || saved.state !== h.get('state')) { api.toast('Google: ошибка входа, попробуй ещё раз'); return null; }
    setToken(h.get('access_token'), Number(h.get('expires_in') || 3600));
    cfg().connected = true; api.save();
    return saved.next;
  }

  async function call(method, path, body) {
    const token = getToken();
    if (!token) throw Object.assign(new Error('auth'), { auth: true });
    const r = await fetch(API + path, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 401) { clearToken(); throw Object.assign(new Error('auth'), { auth: true }); }
    if (r.status === 204) return null;
    const data = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(data?.error?.message || `HTTP ${r.status}`), { status: r.status });
    return data;
  }

  const calPath = () => `/calendars/${encodeURIComponent(cfg().calendarId || 'primary')}/events`;

  // Отпечаток записи: если он изменился, запись надо отправить в Google заново.
  function sig(a) {
    const c = api.clientById(a.clientId);
    return [a.date, a.time, a.dur, a.status, a.note || '', c ? c.name : '', c ? c.phone || '' : ''].join('|');
  }

  function eventBody(a) {
    const c = api.clientById(a.clientId);
    const start = new Date(`${a.date}T${a.time}:00`);
    const end = new Date(start.getTime() + Number(a.dur || 60) * 60000);
    const status = { planned: '', done: '✓ ', noshow: '✗ ' }[a.status] || '';
    return {
      summary: `${status}${c ? c.name : 'Клиент'}${a.note ? ' - ' + a.note : ''}`,
      description: ['Физио Журнал', c?.phone ? `Телефон: ${c.phone}` : '', a.note ? `Комментарий: ${a.note}` : ''].filter(Boolean).join('\n'),
      start: { dateTime: `${a.date}T${a.time}:00`, timeZone: tz },
      end: { dateTime: `${ymd(end)}T${hm(end)}:00`, timeZone: tz },
      colorId: a.status === 'done' ? '10' : a.status === 'noshow' ? '8' : undefined,
      extendedProperties: { private: { physioId: a.id } }
    };
  }

  function parseEvent(ev) {
    if (ev.start?.date) return { date: ev.start.date, time: '', allDay: true };
    const s = new Date(ev.start.dateTime), e = new Date(ev.end.dateTime);
    return { date: ymd(s), time: hm(s), end: hm(e), dur: Math.max(5, Math.round((e - s) / 60000)) };
  }

  let busy = false;
  async function sync(opts = {}) {
    const c = cfg();
    if (!c.clientId || !c.connected) return;
    if (!getToken()) {
      c.dirty = true; api.save();
      if (opts.interactive) login('sync');
      return;
    }
    if (busy) { c.dirty = true; return; }
    busy = true; api.onSyncState(true);
    const db = api.db();
    let pulled = 0, pushed = 0;
    try {
      // 1. Забираем события из Google
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 9, 1);
      const events = [];
      let pageToken = '';
      do {
        const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', showDeleted: 'true', maxResults: '2500' });
        if (pageToken) q.set('pageToken', pageToken);
        const r = await call('GET', `${calPath()}?${q}`);
        events.push(...(r.items || []));
        pageToken = r.nextPageToken || '';
      } while (pageToken);

      const foreign = [];
      for (const ev of events) {
        const pid = ev.extendedProperties?.private?.physioId;
        if (pid) {
          const a = db.appts.find(x => x.id === pid);
          if (!a || a.gid !== ev.id) continue;
          const noLocalChanges = a.gsig === sig(a);
          if (ev.status === 'cancelled') {
            if (noLocalChanges) { a.status = 'cancelled'; delete a.gid; a.gsig = sig(a); pulled++; }
            continue;
          }
          const t = parseEvent(ev);
          if (noLocalChanges && !t.allDay && (t.date !== a.date || t.time !== a.time || t.dur !== Number(a.dur))) {
            Object.assign(a, { date: t.date, time: t.time, dur: t.dur });
            a.gsig = sig(a); pulled++;
          }
        } else if (ev.status !== 'cancelled') {
          foreign.push({ id: ev.id, title: ev.summary || '(без названия)', ...parseEvent(ev) });
        }
      }
      db.gEvents = foreign;

      // 2. Отправляем изменения из приложения
      for (const gid of db.gDeleted || []) {
        try { await call('DELETE', `${calPath()}/${encodeURIComponent(gid)}`); } catch (e) { if (e.auth) throw e; }
      }
      db.gDeleted = [];
      for (const a of db.appts) {
        const s = sig(a);
        if (a.status === 'cancelled') {
          if (a.gid) {
            try { await call('DELETE', `${calPath()}/${encodeURIComponent(a.gid)}`); } catch (e) { if (e.auth) throw e; }
            delete a.gid; pushed++;
          }
          a.gsig = s;
          continue;
        }
        if (a.gid && a.gsig === s) continue;
        if (a.gid) {
          try { await call('PATCH', `${calPath()}/${encodeURIComponent(a.gid)}`, eventBody(a)); }
          catch (e) {
            if (e.auth) throw e;
            if (e.status !== 404 && e.status !== 410) throw e;
            const r = await call('POST', calPath(), eventBody(a)); a.gid = r.id;
          }
        } else {
          const r = await call('POST', calPath(), eventBody(a)); a.gid = r.id;
        }
        a.gsig = s; pushed++;
        api.save();
      }
      c.lastSync = Date.now(); c.dirty = false; c.error = '';
      api.save();
      if (opts.interactive) api.toast(pushed || pulled ? `Синхронизировано: отправлено ${pushed}, получено ${pulled}` : 'Всё уже синхронизировано');
    } catch (e) {
      c.dirty = true; c.error = e.auth ? '' : e.message; api.save();
      if (e.auth && opts.interactive) { busy = false; api.onSyncState(false); return login('sync'); }
      if (opts.interactive || !e.auth) api.toast(e.auth ? 'Google: нужно войти заново' : `Google: ${e.message}`);
    } finally {
      busy = false; api.onSyncState(false); api.render();
      if (cfg().dirty && getToken() && !cfg().error) setTimeout(() => sync(), 500);
    }
  }

  let timer;
  // Вызывается после любого изменения записей
  function changed() {
    const c = cfg();
    if (!c.connected) return;
    c.dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => sync(), 800);
  }

  function removed(a) {
    if (!a.gid) return;
    const db = api.db();
    (db.gDeleted = db.gDeleted || []).push(a.gid);
    changed();
  }

  async function calendars() {
    const r = await call('GET', '/users/me/calendarList?minAccessRole=writer');
    return (r.items || []).map(x => ({ id: x.primary ? 'primary' : x.id, name: x.summaryOverride || x.summary, primary: !!x.primary }));
  }

  function setCalendar(id, name) {
    const c = cfg();
    if (c.calendarId === id) return;
    c.calendarId = id; c.calendarName = name;
    // В новом календаре события создадутся заново
    api.db().appts.forEach(a => { delete a.gid; delete a.gsig; });
    api.db().gDeleted = []; api.db().gEvents = [];
    api.save(); sync({ interactive: true });
  }

  function disconnect() {
    const t = getToken();
    if (t) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: 'POST' }).catch(() => {});
    clearToken();
    const c = cfg(); c.connected = false; c.dirty = false;
    api.db().gEvents = []; api.save();
  }

  // Ссылка «добавить событие» - работает без настройки
  function templateUrl(a) {
    const b = eventBody(a);
    const f = s => s.replace(/[-:]/g, '');
    const p = new URLSearchParams({ action: 'TEMPLATE', text: b.summary, details: b.description, dates: `${f(b.start.dateTime)}/${f(b.end.dateTime)}`, ctz: tz });
    return `https://calendar.google.com/calendar/render?${p}`;
  }

  // Файл .ics со всеми записями - для разового импорта в любой календарь
  function ics(appts) {
    const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
    const f = s => s.replace(/[-:]/g, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Physio Journal//RU', 'CALSCALE:GREGORIAN'];
    appts.filter(a => a.status !== 'cancelled').forEach(a => {
      const b = eventBody(a);
      lines.push('BEGIN:VEVENT', `UID:${a.id}@physio`, `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${tz}:${f(b.start.dateTime)}`, `DTEND;TZID=${tz}:${f(b.end.dateTime)}`,
        `SUMMARY:${esc(b.summary)}`, `DESCRIPTION:${esc(b.description)}`, 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  return {
    login, handleRedirect, sync, changed, removed, calendars, setCalendar, disconnect,
    templateUrl, ics, redirectUri, hasToken: () => !!getToken(), cfg, isBusy: () => busy
  };
};
