(() => {
  'use strict';

  // ---------- Хранилище ----------
  const KEY = 'physio-app-v1';
  const empty = () => ({ clients: [], appts: [], customEx: [] });
  let db;
  try { db = Object.assign(empty(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch (e) { db = empty(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Не удалось сохранить данные'); } };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl = s => esc(s).replace(/\n/g, '<br>');
  const $ = (s, el = document) => el.querySelector(s);

  // ---------- Даты ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => ymd(new Date());
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const human = s => { const d = parse(s); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`; };
  const humanShort = s => { const d = parse(s); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}, ${WD[d.getDay()].toLowerCase()}`; };
  const age = s => { if (!s) return ''; const b = parse(s), n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a >= 0 ? a : ''; };
  const yearsWord = n => { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return 'год'; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'года'; return 'лет'; };
  const endTime = (t, dur) => { const [h, m] = t.split(':').map(Number); const x = h * 60 + m + Number(dur || 0); return `${pad(Math.floor(x / 60) % 24)}:${pad(x % 60)}`; };

  // ---------- Каталог ----------
  const zones = () => window.CATALOG;
  const zoneById = id => zones().find(z => z.id === id);
  const allExercises = () => {
    const list = [];
    zones().forEach(z => z.exercises.forEach(e => list.push({ ...e, zone: z.id })));
    db.customEx.forEach(e => list.push({ ...e, custom: true }));
    return list;
  };
  const exById = id => allExercises().find(e => e.id === id);
  const zoneExercises = zid => allExercises().filter(e => e.zone === zid);

  const STATUS = { planned: 'Запланирован', done: 'Проведён', cancelled: 'Отменён', noshow: 'Не пришёл' };
  const clientById = id => db.clients.find(c => c.id === id);

  // ---------- Состояние интерфейса ----------
  const ui = {
    tab: 'calendar',
    stacks: { calendar: [], clients: [], catalog: [], more: [] },
    month: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
    day: today(),
    search: ''
  };
  const top = () => { const s = ui.stacks[ui.tab]; return s[s.length - 1]; };
  const push = r => { ui.stacks[ui.tab].push(r); render(true); };
  const pop = () => { ui.stacks[ui.tab].pop(); render(true); };

  // ---------- Рендер ----------
  const view = $('#view'), title = $('#title'), back = $('#back'), action = $('#action');

  function render(scrollTop) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
    const r = top();
    let out;
    if (!r) out = ROOTS[ui.tab]();
    else out = PAGES[r.page](r);
    if (!out) { ui.stacks[ui.tab].pop(); return render(scrollTop); }
    title.textContent = out.title;
    back.hidden = !r;
    action.hidden = !out.action;
    action.textContent = out.action ? out.action.label : '';
    action.classList.toggle('plus', !!out.action && out.action.label === '+');
    action.onclick = out.action ? out.action.fn : null;
    view.innerHTML = out.html;
    if (out.after) out.after();
    if (scrollTop) window.scrollTo(0, 0);
  }

  back.onclick = pop;
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    if (ui.tab === b.dataset.tab) ui.stacks[ui.tab] = [];
    ui.tab = b.dataset.tab; render(true);
  });

  // Делегирование кликов: data-go="page:id" и data-act="name"
  view.addEventListener('click', e => {
    const el = e.target.closest('[data-go],[data-act]');
    if (!el) return;
    if (el.dataset.go) { const [page, id] = el.dataset.go.split(':'); push({ page, id }); return; }
    const fn = ACTIONS[el.dataset.act];
    if (fn) fn(el.dataset, el, e);
  });

  const ROOTS = {
    calendar: renderCalendar,
    clients: renderClients,
    catalog: renderCatalog,
    more: renderMore
  };

  // ---------- Календарь ----------
  function renderCalendar() {
    const m = ui.month;
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    const shift = (first.getDay() + 6) % 7; // понедельник первый
    const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const counts = {};
    db.appts.forEach(a => { if (a.status !== 'cancelled') counts[a.date] = (counts[a.date] || 0) + 1; });
    let cells = '';
    for (let i = 0; i < shift; i++) cells += '<div></div>';
    for (let d = 1; d <= daysIn; d++) {
      const s = ymd(new Date(m.getFullYear(), m.getMonth(), d));
      const cls = ['day', s === today() ? 'today' : '', s === ui.day ? 'sel' : ''].join(' ');
      const n = counts[s] || 0;
      cells += `<button class="${cls}" data-act="pickDay" data-d="${s}"><span>${d}</span>${n ? `<i>${n > 3 ? '•••' : '•'.repeat(n)}</i>` : '<i></i>'}</button>`;
    }
    const list = db.appts.filter(a => a.date === ui.day).sort((a, b) => a.time.localeCompare(b.time));
    const dd = parse(ui.day);
    return {
      title: 'Календарь',
      action: { label: '+', fn: () => apptSheet({ date: ui.day }) },
      html: `
        <div class="card cal">
          <div class="cal-head">
            <button class="icon-btn" data-act="month" data-d="-1" aria-label="Предыдущий месяц">‹</button>
            <b>${MONTHS[m.getMonth()]} ${m.getFullYear()}</b>
            <button class="icon-btn" data-act="month" data-d="1" aria-label="Следующий месяц">›</button>
          </div>
          <div class="wd">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(w => `<span>${w}</span>`).join('')}</div>
          <div class="grid">${cells}</div>
          <button class="link small" data-act="goToday">Сегодня</button>
        </div>
        <h3 class="sec">${dd.getDate()} ${MONTHS_GEN[dd.getMonth()]}, ${WD_FULL[dd.getDay()]}</h3>
        ${list.length ? `<div class="list">${list.map(apptRow).join('')}</div>`
          : `<div class="empty">На этот день записей нет.<br><button class="btn" data-act="newAppt">Записать клиента</button></div>`}
      `
    };
  }

  function apptRow(a, withDate) {
    const c = clientById(a.clientId);
    return `<button class="row appt st-${a.status}" data-act="editAppt" data-id="${a.id}">
      <div class="time"><b>${esc(a.time)}</b><small>${endTime(a.time, a.dur)}</small></div>
      <div class="grow"><div class="name">${c ? esc(c.name) : 'Клиент удалён'}</div>
      <small>${withDate ? humanShort(a.date) + ' · ' : ''}${STATUS[a.status]}${a.note ? ' · ' + esc(a.note) : ''}</small></div>
      <span class="chev">›</span></button>`;
  }

  // ---------- Клиенты ----------
  function nextAppt(cid) {
    const t = today();
    return db.appts.filter(a => a.clientId === cid && a.date >= t && a.status === 'planned')
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  }

  function renderClients() {
    const q = ui.search.trim().toLowerCase();
    const list = db.clients
      .filter(c => !q || [c.name, c.phone, c.diagnosis].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return {
      title: 'Клиенты',
      action: { label: '+', fn: () => clientSheet() },
      html: `
        <input class="search" type="search" placeholder="Поиск по имени, телефону, диагнозу" value="${esc(ui.search)}" id="search">
        ${db.clients.length === 0 ? `<div class="empty">Пока нет ни одного клиента.<br><button class="btn" data-act="newClient">Добавить клиента</button></div>` :
          list.length ? `<div class="list">${list.map(c => {
            const n = nextAppt(c.id);
            return `<button class="row" data-go="client:${c.id}">
              <div class="avatar">${esc(initials(c.name))}</div>
              <div class="grow"><div class="name">${esc(c.name)}</div>
              <small>${esc(c.diagnosis || 'Без диагноза')}${n ? ' · след. визит ' + humanShort(n.date) : ''}</small></div>
              <span class="chev">›</span></button>`;
          }).join('')}</div>` : '<div class="empty">Никого не нашли.</div>'}
      `,
      after: () => {
        const s = $('#search');
        s.oninput = () => { ui.search = s.value; const pos = s.selectionStart; render(); const n = $('#search'); n.focus(); n.setSelectionRange(pos, pos); };
      }
    };
  }
  const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

  function renderClient(r) {
    const c = clientById(r.id);
    if (!c) return null;
    const a = age(c.birth);
    const visits = [...(c.visits || [])].sort((x, y) => y.date.localeCompare(x.date));
    const appts = db.appts.filter(x => x.clientId === c.id).sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time));
    const upcoming = appts.filter(x => x.date >= today() && x.status === 'planned').reverse();
    const past = appts.filter(x => !upcoming.includes(x)).slice(0, 5);
    const plan = (c.plan || []).map(p => ({ ...p, ex: exById(p.exId) })).filter(p => p.ex);
    const field = (label, val) => val ? `<div class="field"><span>${label}</span><div>${nl(val)}</div></div>` : '';
    const painChart = visits.filter(v => v.pain !== '' && v.pain != null).slice(0, 12).reverse();

    return {
      title: c.name,
      action: { label: 'Изм.', fn: () => clientSheet(c) },
      html: `
        <div class="card hero">
          <div class="avatar big">${esc(initials(c.name))}</div>
          <div><h2>${esc(c.name)}</h2>
          <small>${a !== '' ? `${a} ${yearsWord(a)}` : ''}${a !== '' && c.phone ? ' · ' : ''}${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}</small>
          ${(c.zones || []).length ? `<div class="chips">${c.zones.map(z => zoneById(z)).filter(Boolean).map(z => `<span class="chip">${z.icon} ${z.name}</span>`).join('')}</div>` : ''}</div>
        </div>
        <div class="quick">
          <button class="btn" data-act="newApptFor" data-id="${c.id}">📅 Записать</button>
          <button class="btn" data-act="newVisit" data-id="${c.id}">📝 Визит</button>
          <button class="btn" data-act="addEx" data-id="${c.id}">🏋️ ЛФК</button>
        </div>

        <h3 class="sec">Медицинская карта</h3>
        <div class="card">
          ${field('Жалобы', c.complaints)}${field('Диагноз', c.diagnosis)}${field('Анамнез', c.anamnesis)}
          ${field('Противопоказания', c.contra)}${field('Цели лечения', c.goals)}${field('Заметки', c.notes)}
          ${!c.complaints && !c.diagnosis && !c.anamnesis && !c.contra && !c.goals && !c.notes ? '<div class="muted">Карта пока пустая. Нажми «Изм.», чтобы заполнить.</div>' : ''}
        </div>

        ${painChart.length > 1 ? `<h3 class="sec">Динамика боли</h3><div class="card">${painSvg(painChart)}</div>` : ''}

        <h3 class="sec">Записи</h3>
        ${upcoming.length || past.length ? `<div class="list">${upcoming.map(x => apptRow(x, true)).join('')}${past.map(x => apptRow(x, true)).join('')}</div>` : '<div class="empty small">Записей нет.</div>'}

        <h3 class="sec">Журнал визитов</h3>
        ${visits.length ? `<div class="list">${visits.map(v => `
          <button class="row visit" data-act="editVisit" data-cid="${c.id}" data-id="${v.id}">
            <div class="grow"><div class="name">${human(v.date)}${v.pain !== '' && v.pain != null ? ` <span class="pain p${painLevel(v.pain)}">боль ${esc(v.pain)}/10</span>` : ''}</div>
            <div class="txt">${nl(v.text) || '<span class="muted">Без описания</span>'}</div></div></button>`).join('')}</div>`
          : '<div class="empty small">Визитов пока нет.</div>'}

        <h3 class="sec">Домашняя программа</h3>
        ${plan.length ? `<div class="list">${plan.map(p => `
          <div class="row">
            <button class="grow plain" data-act="showEx" data-id="${p.ex.id}" data-cid="${c.id}">
              <div class="name">${esc(p.ex.name)}</div>
              <small>${zoneById(p.ex.zone)?.name || ''} · ${esc(p.dose || p.ex.dose)}</small></button>
            <button class="icon-btn danger" data-act="unassign" data-cid="${c.id}" data-id="${p.exId}" aria-label="Убрать">✕</button>
          </div>`).join('')}</div>
          <button class="btn wide" data-act="sharePlan" data-id="${c.id}">📤 Отправить программу клиенту</button>`
          : '<div class="empty small">Упражнения не назначены.</div>'}

        <button class="btn wide danger-btn" data-act="delClient" data-id="${c.id}">Удалить клиента</button>
      `
    };
  }
  const painLevel = p => (p >= 7 ? 3 : p >= 4 ? 2 : 1);

  function painSvg(list) {
    const W = 320, H = 120, P = 24;
    const x = i => P + (i * (W - P * 2)) / (list.length - 1);
    const y = v => H - P - (v / 10) * (H - P * 2);
    const pts = list.map((v, i) => `${x(i).toFixed(1)},${y(Number(v.pain)).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="График боли">
      ${[0, 5, 10].map(v => `<line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="4" y="${y(v) + 4}" class="tl">${v}</text>`).join('')}
      <polyline points="${pts}" class="pl"/>
      ${list.map((v, i) => `<circle cx="${x(i)}" cy="${y(Number(v.pain))}" r="4" class="pt"/>`).join('')}
      <text x="${P}" y="${H - 4}" class="tl">${human(list[0].date)}</text>
      <text x="${W - P}" y="${H - 4}" class="tl" text-anchor="end">${human(list[list.length - 1].date)}</text>
    </svg>`;
  }

  // ---------- Каталог ----------
  function renderCatalog() {
    return {
      title: 'Каталог',
      action: { label: '+', fn: () => exerciseSheet() },
      html: `
        <p class="lead">Рекомендации и упражнения по основным проблемным зонам. Нажми на зону, чтобы открыть.</p>
        <div class="zones">${zones().map(z => `
          <button class="zone" data-go="zone:${z.id}">
            <span class="zi">${z.icon}</span><b>${z.name}</b>
            <small>${zoneExercises(z.id).length} упр.</small></button>`).join('')}
        </div>`
    };
  }

  function renderZone(r) {
    const z = zoneById(r.id);
    if (!z) return null;
    const ex = zoneExercises(z.id);
    return {
      title: z.name,
      action: { label: '+', fn: () => exerciseSheet({ zone: z.id }) },
      html: `
        <div class="card"><p>${esc(z.about)}</p></div>
        <h3 class="sec">Рекомендации</h3>
        <div class="card"><ul class="tips">${z.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
        <div class="card warn"><b>⚠️ Красные флаги</b><p>${esc(z.redFlags)}</p></div>
        <h3 class="sec">Упражнения</h3>
        <div class="list">${ex.map(e => `
          <button class="row" data-act="showEx" data-id="${e.id}">
            <div class="grow"><div class="name">${esc(e.name)}${e.custom ? ' <span class="tag">своё</span>' : ''}</div>
            <small>${esc(e.level || '')}${e.level && e.dose ? ' · ' : ''}${esc(e.dose || '')}</small></div>
            <span class="chev">›</span></button>`).join('')}</div>`
    };
  }

  // ---------- Ещё ----------
  function renderMore() {
    const visits = db.clients.reduce((s, c) => s + (c.visits || []).length, 0);
    return {
      title: 'Ещё',
      html: `
        <div class="stats">
          <div class="card"><b>${db.clients.length}</b><small>клиентов</small></div>
          <div class="card"><b>${db.appts.filter(a => a.date >= today() && a.status === 'planned').length}</b><small>предстоящих записей</small></div>
          <div class="card"><b>${visits}</b><small>визитов в журнале</small></div>
        </div>
        <h3 class="sec">Резервная копия</h3>
        <div class="card">
          <p class="muted">Все данные хранятся только на этом телефоне. Время от времени сохраняй копию в «Файлы» или iCloud, чтобы ничего не потерять.</p>
          <button class="btn wide" data-act="export">💾 Сохранить копию</button>
          <label class="btn wide file">📂 Восстановить из файла<input type="file" accept="application/json,.json" id="importFile" hidden></label>
        </div>
        <h3 class="sec">Как установить на iPhone</h3>
        <div class="card"><ol class="tips">
          <li>Открой эту страницу в Safari.</li>
          <li>Нажми кнопку «Поделиться» внизу экрана.</li>
          <li>Выбери «На экран “Домой”».</li>
          <li>Готово - приложение появится рядом с остальными и будет работать без интернета.</li>
        </ol></div>
        <h3 class="sec">Опасная зона</h3>
        <div class="card"><button class="btn wide danger-btn" data-act="wipe">Удалить все данные</button></div>
        <p class="foot">Каталог упражнений - справочный. Подбор и дозировка остаются на решении специалиста.</p>
      `,
      after: () => { $('#importFile').onchange = e => importFile(e.target.files[0]); }
    };
  }

  const PAGES = { client: renderClient, zone: renderZone };

  // ---------- Шторки (формы) ----------
  const sheet = $('#sheet'), sheetBody = $('#sheetBody');
  function openSheet(html, onReady) {
    sheetBody.innerHTML = html;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
    document.body.classList.add('locked');
    if (onReady) onReady(sheetBody);
  }
  function closeSheet() {
    sheet.classList.remove('open');
    document.body.classList.remove('locked');
    setTimeout(() => { sheet.hidden = true; sheetBody.innerHTML = ''; }, 250);
  }
  sheet.addEventListener('click', e => { if (e.target === sheet || e.target.closest('[data-close]')) closeSheet(); });

  const formHead = (t, saveLabel = 'Готово') => `<div class="sheet-head"><button class="link" data-close type="button">Отмена</button><b>${t}</b><button class="link strong" type="submit">${saveLabel}</button></div>`;
  const formData = f => Object.fromEntries(new FormData(f).entries());

  function clientSheet(c) {
    const isNew = !c;
    c = c || {};
    const zs = c.zones || [];
    openSheet(`<form id="f">
      ${formHead(isNew ? 'Новый клиент' : 'Карта клиента')}
      <div class="form">
        <label>ФИО<input name="name" required value="${esc(c.name)}" autocomplete="off"></label>
        <label>Телефон<input name="phone" type="tel" value="${esc(c.phone)}"></label>
        <label>Дата рождения<input name="birth" type="date" value="${esc(c.birth)}"></label>
        <div class="lbl">Проблемные зоны</div>
        <div class="chips pick">${zones().map(z => `<label class="chip"><input type="checkbox" name="zone" value="${z.id}" ${zs.includes(z.id) ? 'checked' : ''}><span>${z.icon} ${z.name}</span></label>`).join('')}</div>
        <label>Жалобы<textarea name="complaints" rows="3">${esc(c.complaints)}</textarea></label>
        <label>Диагноз<textarea name="diagnosis" rows="2">${esc(c.diagnosis)}</textarea></label>
        <label>Анамнез<textarea name="anamnesis" rows="4" placeholder="Травмы, операции, сопутствующие заболевания, образ жизни">${esc(c.anamnesis)}</textarea></label>
        <label>Противопоказания<textarea name="contra" rows="2">${esc(c.contra)}</textarea></label>
        <label>Цели лечения<textarea name="goals" rows="2">${esc(c.goals)}</textarea></label>
        <label>Заметки<textarea name="notes" rows="3">${esc(c.notes)}</textarea></label>
      </div></form>`, b => {
      $('#f', b).onsubmit = e => {
        e.preventDefault();
        const d = formData(e.target);
        d.zones = [...e.target.querySelectorAll('input[name=zone]:checked')].map(i => i.value);
        delete d.zone;
        d.name = d.name.trim();
        if (!d.name) return;
        if (isNew) {
          const nc = { id: uid(), createdAt: Date.now(), visits: [], plan: [], ...d };
          db.clients.push(nc); save(); closeSheet();
          ui.tab = 'clients'; ui.stacks.clients = [{ page: 'client', id: nc.id }]; render(true);
        } else { Object.assign(c, d); save(); closeSheet(); render(); }
        toast('Сохранено');
      };
    });
  }

  function apptSheet(a) {
    const isNew = !a.id;
    if (!db.clients.length) {
      toast('Сначала добавь клиента');
      return clientSheet();
    }
    const clients = [...db.clients].sort((x, y) => x.name.localeCompare(y.name, 'ru'));
    openSheet(`<form id="f">
      ${formHead(isNew ? 'Новая запись' : 'Запись')}
      <div class="form">
        <label>Клиент<select name="clientId" required>
          ${isNew && !a.clientId ? '<option value="">Выбери клиента</option>' : ''}
          ${clients.map(c => `<option value="${c.id}" ${c.id === a.clientId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></label>
        <div class="two">
          <label>Дата<input type="date" name="date" required value="${esc(a.date || today())}"></label>
          <label>Время<input type="time" name="time" required value="${esc(a.time || '10:00')}"></label>
        </div>
        <label>Длительность<select name="dur">${[30, 45, 60, 90, 120].map(m => `<option value="${m}" ${(a.dur || 60) == m ? 'selected' : ''}>${m} мин</option>`).join('')}</select></label>
        <label>Статус<select name="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${(a.status || 'planned') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Комментарий<textarea name="note" rows="2" placeholder="Например: массаж ШВЗ, ЛФК">${esc(a.note)}</textarea></label>
        ${!isNew ? `<button type="button" class="btn wide" id="toCard">Открыть карту клиента</button>
        <button type="button" class="btn wide" id="toVisit">📝 Записать визит в журнал</button>
        <button type="button" class="btn wide danger-btn" id="del">Удалить запись</button>` : ''}
      </div></form>`, b => {
      $('#f', b).onsubmit = e => {
        e.preventDefault();
        const d = formData(e.target);
        if (!d.clientId) return toast('Выбери клиента');
        d.dur = Number(d.dur);
        const clash = db.appts.find(x => x.id !== a.id && x.date === d.date && x.status !== 'cancelled' &&
          d.status !== 'cancelled' && overlap(x.time, x.dur, d.time, d.dur));
        if (isNew) db.appts.push({ id: uid(), ...d }); else Object.assign(db.appts.find(x => x.id === a.id), d);
        save(); closeSheet();
        ui.day = d.date; ui.month = new Date(parse(d.date).getFullYear(), parse(d.date).getMonth(), 1);
        render();
        toast(clash ? `Сохранено. Пересекается с записью в ${clash.time}` : 'Сохранено');
      };
      if (!isNew) {
        $('#del', b).onclick = () => { if (confirm('Удалить запись?')) { db.appts = db.appts.filter(x => x.id !== a.id); save(); closeSheet(); render(); } };
        $('#toCard', b).onclick = () => { closeSheet(); ui.tab = 'clients'; ui.stacks.clients = [{ page: 'client', id: a.clientId }]; render(true); };
        $('#toVisit', b).onclick = () => {
          const appt = db.appts.find(x => x.id === a.id);
          if (appt.status === 'planned') { appt.status = 'done'; save(); }
          closeSheet(); setTimeout(() => visitSheet(a.clientId, null, { date: a.date, text: a.note || '' }), 260);
        };
      }
    });
  }
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const overlap = (t1, d1, t2, d2) => toMin(t1) < toMin(t2) + Number(d2) && toMin(t2) < toMin(t1) + Number(d1);

  function visitSheet(cid, vid, preset) {
    const c = clientById(cid);
    const v = vid ? c.visits.find(x => x.id === vid) : { date: today(), pain: '', text: '', ...preset };
    openSheet(`<form id="f">
      ${formHead(vid ? 'Визит' : 'Новый визит')}
      <div class="form">
        <label>Дата<input type="date" name="date" required value="${esc(v.date)}"></label>
        <div class="lbl">Боль по шкале 0-10: <b id="pv">${v.pain === '' ? 'не указана' : esc(v.pain)}</b></div>
        <input type="range" min="0" max="10" step="1" name="pain" value="${v.pain === '' ? 0 : esc(v.pain)}" id="pain" class="${v.pain === '' ? 'unset' : ''}">
        <label>Что сделано и результат<textarea name="text" rows="6" placeholder="Осмотр, тесты, процедуры, реакция клиента, рекомендации">${esc(v.text)}</textarea></label>
        ${vid ? '<button type="button" class="btn wide danger-btn" id="del">Удалить визит</button>' : ''}
      </div></form>`, b => {
      let painSet = v.pain !== '';
      const r = $('#pain', b);
      r.oninput = () => { painSet = true; r.classList.remove('unset'); $('#pv', b).textContent = r.value; };
      $('#f', b).onsubmit = e => {
        e.preventDefault();
        const d = formData(e.target);
        d.pain = painSet ? Number(d.pain) : '';
        if (vid) Object.assign(v, d); else (c.visits = c.visits || []).push({ id: uid(), ...d });
        save(); closeSheet();
        ui.tab = 'clients';
        const s = ui.stacks.clients;
        if (!(s.length && s[s.length - 1].id === cid)) ui.stacks.clients = [{ page: 'client', id: cid }];
        render(); toast('Визит сохранён');
      };
      if (vid) $('#del', b).onclick = () => { if (confirm('Удалить визит?')) { c.visits = c.visits.filter(x => x.id !== vid); save(); closeSheet(); render(); } };
    });
  }

  function exDetail(id, cid) {
    const e = exById(id);
    if (!e) return;
    const z = zoneById(e.zone);
    const c = cid && clientById(cid);
    const assigned = c && (c.plan || []).find(p => p.exId === id);
    openSheet(`
      <div class="sheet-head"><span></span><b>${z ? z.icon + ' ' + z.name : ''}</b><button class="link strong" data-close type="button">Закрыть</button></div>
      <div class="form">
        <h2>${esc(e.name)}</h2>
        <div class="chips"><span class="chip">${esc(e.level || '')}</span><span class="chip">${esc(assigned?.dose || e.dose || '')}</span></div>
        <div class="lbl">Как выполнять</div>
        <ol class="tips">${(e.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
        ${e.caution ? `<div class="card warn"><b>Важно</b><p>${esc(e.caution)}</p></div>` : ''}
        ${assigned?.note ? `<div class="card"><b>Комментарий для клиента</b><p>${nl(assigned.note)}</p></div>` : ''}
        <button class="btn wide primary" id="assign" type="button">Назначить клиенту</button>
        ${e.custom ? `<button class="btn wide" id="editEx" type="button">Редактировать</button>
          <button class="btn wide danger-btn" id="delEx" type="button">Удалить упражнение</button>` : ''}
      </div>`, b => {
      $('#assign', b).onclick = () => { closeSheet(); setTimeout(() => assignSheet(id, cid), 260); };
      if (e.custom) {
        $('#editEx', b).onclick = () => { closeSheet(); setTimeout(() => exerciseSheet(db.customEx.find(x => x.id === id)), 260); };
        $('#delEx', b).onclick = () => {
          if (!confirm('Удалить упражнение из каталога?')) return;
          db.customEx = db.customEx.filter(x => x.id !== id);
          db.clients.forEach(cl => cl.plan = (cl.plan || []).filter(p => p.exId !== id));
          save(); closeSheet(); render();
        };
      }
    });
  }

  function assignSheet(exId, cid) {
    if (!db.clients.length) return toast('Сначала добавь клиента');
    const e = exById(exId);
    const c = cid && clientById(cid);
    const cur = c && (c.plan || []).find(p => p.exId === exId);
    const clients = [...db.clients].sort((x, y) => x.name.localeCompare(y.name, 'ru'));
    openSheet(`<form id="f">
      ${formHead('Назначить', 'Назначить')}
      <div class="form">
        <h2>${esc(e.name)}</h2>
        <label>Клиент<select name="cid" required>
          ${!cid ? '<option value="">Выбери клиента</option>' : ''}
          ${clients.map(x => `<option value="${x.id}" ${x.id === cid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Дозировка<input name="dose" value="${esc(cur?.dose || e.dose)}"></label>
        <label>Комментарий для клиента<textarea name="note" rows="3" placeholder="Например: делать утром и вечером">${esc(cur?.note)}</textarea></label>
      </div></form>`, b => {
      $('#f', b).onsubmit = ev => {
        ev.preventDefault();
        const d = formData(ev.target);
        if (!d.cid) return toast('Выбери клиента');
        const cl = clientById(d.cid);
        cl.plan = (cl.plan || []).filter(p => p.exId !== exId);
        cl.plan.push({ exId, dose: d.dose, note: d.note });
        save(); closeSheet(); render(); toast(`Назначено: ${cl.name}`);
      };
    });
  }

  function pickExerciseSheet(cid) {
    const c = clientById(cid);
    const has = new Set((c.plan || []).map(p => p.exId));
    const order = [...(c.zones || []), ...zones().map(z => z.id).filter(z => !(c.zones || []).includes(z))];
    openSheet(`
      <div class="sheet-head"><span></span><b>Выбери упражнение</b><button class="link strong" data-close type="button">Закрыть</button></div>
      <div class="form">${order.map(zid => {
        const z = zoneById(zid);
        return `<div class="lbl">${z.icon} ${z.name}</div><div class="list">${zoneExercises(zid).map(e => `
          <button class="row" type="button" data-pick="${e.id}"><div class="grow"><div class="name">${esc(e.name)}</div><small>${esc(e.dose || '')}</small></div>
          <span class="chev">${has.has(e.id) ? '✓' : '+'}</span></button>`).join('')}</div>`;
      }).join('')}</div>`, b => {
      b.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => {
        closeSheet(); setTimeout(() => assignSheet(el.dataset.pick, cid), 260);
      });
    });
  }

  function exerciseSheet(e) {
    const isNew = !e || !e.id;
    e = e || {};
    openSheet(`<form id="f">
      ${formHead(isNew ? 'Новое упражнение' : 'Упражнение')}
      <div class="form">
        <label>Название<input name="name" required value="${esc(e.name)}"></label>
        <label>Зона<select name="zone">${zones().map(z => `<option value="${z.id}" ${e.zone === z.id ? 'selected' : ''}>${z.icon} ${z.name}</option>`).join('')}</select></label>
        <div class="two">
          <label>Уровень<select name="level">${['Лёгкий', 'Средний', 'Сложный'].map(l => `<option ${e.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Дозировка<input name="dose" value="${esc(e.dose)}" placeholder="10 × 3"></label>
        </div>
        <label>Шаги (каждый с новой строки)<textarea name="steps" rows="5">${esc((e.steps || []).join('\n'))}</textarea></label>
        <label>Важно / предостережения<textarea name="caution" rows="2">${esc(e.caution)}</textarea></label>
      </div></form>`, b => {
      $('#f', b).onsubmit = ev => {
        ev.preventDefault();
        const d = formData(ev.target);
        d.steps = d.steps.split('\n').map(s => s.trim()).filter(Boolean);
        if (isNew) db.customEx.push({ id: 'c-' + uid(), ...d });
        else Object.assign(db.customEx.find(x => x.id === e.id), d);
        save(); closeSheet(); render(); toast('Упражнение сохранено');
      };
    });
  }

  // ---------- Действия ----------
  const ACTIONS = {
    month: d => { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + Number(d.d), 1); render(); },
    pickDay: d => { ui.day = d.d; render(); },
    goToday: () => { ui.day = today(); const n = new Date(); ui.month = new Date(n.getFullYear(), n.getMonth(), 1); render(); },
    newAppt: () => apptSheet({ date: ui.day }),
    newApptFor: d => apptSheet({ clientId: d.id, date: today() }),
    editAppt: d => apptSheet(db.appts.find(a => a.id === d.id)),
    newClient: () => clientSheet(),
    newVisit: d => visitSheet(d.id),
    editVisit: d => visitSheet(d.cid, d.id),
    addEx: d => pickExerciseSheet(d.id),
    showEx: d => exDetail(d.id, d.cid),
    unassign: d => {
      const c = clientById(d.cid);
      c.plan = (c.plan || []).filter(p => p.exId !== d.id); save(); render();
    },
    delClient: d => {
      const c = clientById(d.id);
      if (!confirm(`Удалить клиента «${c.name}» вместе с записями и журналом?`)) return;
      db.clients = db.clients.filter(x => x.id !== d.id);
      db.appts = db.appts.filter(a => a.clientId !== d.id);
      save(); pop(); toast('Клиент удалён');
    },
    sharePlan: d => sharePlan(clientById(d.id)),
    export: exportData,
    wipe: () => {
      if (!confirm('Удалить всех клиентов, записи и свои упражнения? Это нельзя отменить.')) return;
      if (!confirm('Точно? Лучше сначала сохрани копию.')) return;
      db = empty(); save(); render(); toast('Данные удалены');
    }
  };

  function sharePlan(c) {
    const plan = (c.plan || []).map(p => ({ ...p, ex: exById(p.exId) })).filter(p => p.ex);
    const text = [`Домашняя программа упражнений`, `${c.name}`, '',
      ...plan.map((p, i) => [
        `${i + 1}. ${p.ex.name} (${p.dose || p.ex.dose})`,
        ...(p.ex.steps || []).map(s => `   - ${s}`),
        p.ex.caution ? `   Важно: ${p.ex.caution}` : '',
        p.note ? `   Комментарий: ${p.note}` : ''
      ].filter(Boolean).join('\n')),
      '', 'Если во время упражнения появляется острая боль - остановись и сообщи мне.'].join('\n');
    if (navigator.share) navigator.share({ title: 'Программа упражнений', text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Скопировано в буфер обмена'));
    else openSheet(`<div class="sheet-head"><span></span><b>Программа</b><button class="link strong" data-close>Закрыть</button></div><div class="form"><textarea rows="16">${esc(text)}</textarea></div>`);
  }

  async function exportData() {
    const json = JSON.stringify({ app: 'physio', version: 1, exportedAt: new Date().toISOString(), ...db }, null, 2);
    const name = `physio-backup-${today()}.json`;
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function importFile(f) {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!Array.isArray(d.clients) || !Array.isArray(d.appts)) throw new Error();
        if (!confirm(`В файле ${d.clients.length} клиентов и ${d.appts.length} записей. Заменить текущие данные?`)) return;
        db = { clients: d.clients, appts: d.appts, customEx: d.customEx || [] };
        save(); render(); toast('Данные восстановлены');
      } catch (e) { toast('Файл не подходит'); }
    };
    r.readAsText(f);
  }

  let tt;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2200);
  }

  render(true);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
