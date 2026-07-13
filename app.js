(() => {
  'use strict';

  const STORAGE_KEY = 'enfoco-data-v1';
  const DAY = 86400000;
  const defaultState = () => ({
    version: 1,
    settings: { dailyGoal: 15, attentionLevel: 1 },
    cards: [],
    attentionSessions: [],
    focusSessions: [],
    recallEvents: []
  });

  let state = loadState();
  let currentRoute = 'inicio';
  let attention = null;
  let focus = null;
  let review = null;
  let toastTimer = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dayKey = (date = new Date()) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || parsed.version !== 1) return defaultState();
      return {
        ...defaultState(), ...parsed,
        settings: { ...defaultState().settings, ...(parsed.settings || {}) },
        cards: Array.isArray(parsed.cards) ? parsed.cards : [],
        attentionSessions: Array.isArray(parsed.attentionSessions) ? parsed.attentionSessions : [],
        focusSessions: Array.isArray(parsed.focusSessions) ? parsed.focusSessions : [],
        recallEvents: Array.isArray(parsed.recallEvents) ? parsed.recallEvents : []
      };
    } catch { return defaultState(); }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function routeTo(route) {
    if (!document.querySelector(`[data-view="${route}"]`)) return;
    currentRoute = route;
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === route));
    $$('.nav-item').forEach(btn => {
      const active = btn.dataset.route === route;
      btn.classList.toggle('active', active);
      if (active) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
    });
    history.replaceState(null, '', `#${route}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (route === 'inicio') renderHome();
    if (route === 'memoria') renderMemory();
    if (route === 'progreso') renderProgress();
    if (route === 'ajustes') renderSettings();
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function formatDateLabel(date) {
    const text = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function getDueCards() {
    const now = Date.now();
    return state.cards.filter(card => Number(card.dueAt || 0) <= now).sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
  }

  function activeDayKeys(periodDays = 30) {
    const cutoff = Date.now() - periodDays * DAY;
    const keys = new Set();
    state.attentionSessions.filter(s => s.at >= cutoff).forEach(s => keys.add(dayKey(s.at)));
    state.focusSessions.filter(s => s.at >= cutoff).forEach(s => keys.add(dayKey(s.at)));
    state.recallEvents.filter(s => s.at >= cutoff).forEach(s => keys.add(dayKey(s.at)));
    return keys;
  }

  function calculateStreak() {
    const days = activeDayKeys(400);
    let cursor = new Date();
    if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (days.has(dayKey(cursor))) { count += 1; cursor.setDate(cursor.getDate() - 1); }
    return count;
  }

  function renderHome() {
    $('#today-label').textContent = formatDateLabel(new Date());
    $('#streak-value').textContent = calculateStreak();
    const due = getDueCards().length;
    $('#due-title-home').textContent = due === 1 ? '1 recuerdo pendiente' : `${due} recuerdos pendientes`;
    $('[data-action="start-review-home"]').textContent = due ? 'Repasar ahora' : state.cards.length ? 'Todo al día' : 'Crear recuerdos';
    const since = Date.now() - 7 * DAY;
    const focusMinutes = Math.round(state.focusSessions.filter(s => s.at >= since).reduce((sum, s) => sum + s.durationSec, 0) / 60);
    $('#home-focus-min').textContent = focusMinutes;
    const lastAttention = state.attentionSessions.at(-1);
    $('#home-attention-accuracy').textContent = lastAttention ? `${Math.round(lastAttention.accuracy * 100)}%` : '—';
    $('#home-memory-recalls').textContent = state.recallEvents.filter(e => e.at >= since).length;
    $('#plan-time').textContent = `≈ ${state.settings.dailyGoal} min`;
    const today = startOfToday();
    $('#plan-attention').classList.toggle('done', state.attentionSessions.some(s => s.at >= today));
    $('#plan-focus').classList.toggle('done', state.focusSessions.some(s => s.at >= today));
    $('#plan-memory').classList.toggle('done', state.recallEvents.some(s => s.at >= today) || (state.cards.length > 0 && due === 0));
  }

  function resetAttentionUI() {
    $('#attention-setup').classList.remove('hidden');
    $('#attention-game').classList.add('hidden');
    $('#attention-result').classList.add('hidden');
    $('#attention-level-label').textContent = state.settings.attentionLevel;
  }

  function startAttention() {
    const duration = Number($('input[name="attention-duration"]:checked').value);
    const level = clamp(Number(state.settings.attentionLevel) || 1, 1, 10);
    attention = {
      duration, level, startAt: Date.now(), endAt: Date.now() + duration * 1000,
      hits: 0, misses: 0, falseAlarms: 0, correctRejects: 0, rts: [],
      trialTarget: false, responded: false, trialStartedAt: 0, timerId: null, trialId: null, active: true
    };
    $('#attention-setup').classList.add('hidden');
    $('#attention-result').classList.add('hidden');
    $('#attention-game').classList.remove('hidden');
    $('#stimulus').textContent = '+';
    $('#stimulus').className = 'stimulus muted';
    attention.timerId = setInterval(updateAttentionClock, 200);
    updateAttentionClock();
    attention.trialId = setTimeout(nextAttentionTrial, 700);
    $('#stimulus-stage').focus();
  }

  function attentionTiming() {
    const level = attention.level;
    return { visible: Math.round(1120 - (level - 1) * 62), gap: Math.round(360 - (level - 1) * 15) };
  }

  function nextAttentionTrial() {
    if (!attention?.active || Date.now() >= attention.endAt) return finishAttention(false);
    const shapes = ['◆', '▲', '■', '★', '✚'];
    attention.trialTarget = Math.random() < 0.3;
    attention.responded = false;
    attention.trialStartedAt = performance.now();
    const stimulus = $('#stimulus');
    stimulus.textContent = attention.trialTarget ? '●' : shapes[Math.floor(Math.random() * shapes.length)];
    stimulus.className = 'stimulus';
    const timing = attentionTiming();
    attention.trialId = setTimeout(() => {
      if (!attention?.active) return;
      if (attention.trialTarget && !attention.responded) attention.misses += 1;
      if (!attention.trialTarget && !attention.responded) attention.correctRejects += 1;
      stimulus.textContent = '+';
      stimulus.className = 'stimulus muted';
      renderAttentionLive();
      attention.trialId = setTimeout(nextAttentionTrial, timing.gap);
    }, timing.visible);
  }

  function respondAttention(event) {
    if (!attention?.active || attention.responded || $('#stimulus').textContent === '+') return;
    if (event) event.preventDefault();
    attention.responded = true;
    if (attention.trialTarget) {
      attention.hits += 1;
      attention.rts.push(Math.round(performance.now() - attention.trialStartedAt));
      $('#stimulus').classList.add('correct');
    } else {
      attention.falseAlarms += 1;
    }
    renderAttentionLive();
  }

  function attentionAccuracy(a = attention) {
    const targets = a.hits + a.misses;
    const distractors = a.falseAlarms + a.correctRejects;
    const hitRate = targets ? a.hits / targets : null;
    const rejectionRate = distractors ? a.correctRejects / distractors : null;
    if (hitRate !== null && rejectionRate !== null) return (hitRate + rejectionRate) / 2;
    return hitRate ?? rejectionRate ?? 0;
  }

  function renderAttentionLive() {
    const completed = attention.hits + attention.misses + attention.falseAlarms + attention.correctRejects;
    $('#attention-live-accuracy').textContent = completed ? `${Math.round(attentionAccuracy() * 100)}%` : '—';
  }

  function updateAttentionClock() {
    if (!attention?.active) return;
    const left = Math.max(0, Math.ceil((attention.endAt - Date.now()) / 1000));
    $('#attention-time').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (left <= 0) finishAttention(false);
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  function finishAttention(early) {
    if (!attention?.active) return;
    attention.active = false;
    clearInterval(attention.timerId);
    clearTimeout(attention.trialId);
    const completed = attention.hits + attention.misses + attention.falseAlarms + attention.correctRejects;
    if (completed < 5) { attention = null; resetAttentionUI(); toast('Sesión demasiado corta para guardarla'); return; }
    const accuracy = attentionAccuracy();
    const med = median(attention.rts);
    let nextLevel = attention.level;
    if (accuracy >= .9 && attention.falseAlarms <= Math.max(1, completed * .04)) nextLevel += 1;
    if (accuracy < .75 || attention.falseAlarms > completed * .15) nextLevel -= 1;
    nextLevel = clamp(nextLevel, 1, 10);
    state.settings.attentionLevel = nextLevel;
    state.attentionSessions.push({
      id: uid(), at: Date.now(), durationSec: Math.max(1, Math.round((Date.now() - attention.startAt) / 1000)),
      level: attention.level, accuracy, medianRt: med, hits: attention.hits, misses: attention.misses,
      falseAlarms: attention.falseAlarms, correctRejects: attention.correctRejects, early
    });
    state.attentionSessions = state.attentionSessions.slice(-300);
    saveState();
    $('#attention-game').classList.add('hidden');
    $('#attention-result').classList.remove('hidden');
    $('#result-accuracy').textContent = `${Math.round(accuracy * 100)}%`;
    $('#result-rt').textContent = med ? `${med} ms` : '—';
    $('#result-false').textContent = attention.falseAlarms;
    $('#attention-result-title').textContent = accuracy >= .9 ? 'Precisión sólida' : accuracy >= .75 ? 'Buen entrenamiento' : 'Hoy convenía ir más despacio';
    let note = accuracy >= .9 ? 'Has distinguido bien la señal y las distracciones.' : 'Prioriza esperar a reconocer el círculo antes de responder.';
    if (nextLevel > attention.level) note += ` La próxima sesión subirá al nivel ${nextLevel}.`;
    if (nextLevel < attention.level) note += ` La próxima sesión bajará al nivel ${nextLevel} para recuperar precisión.`;
    $('#attention-result-note').textContent = note;
  }

  function startFocus() {
    const task = $('#focus-task').value.trim();
    if (!task) { $('#focus-error').classList.remove('hidden'); $('#focus-task').focus(); return; }
    $('#focus-error').classList.add('hidden');
    const minutes = Number($('#focus-duration').value);
    focus = { task, plannedSec: minutes * 60, startAt: Date.now(), endAt: Date.now() + minutes * 60000, distractions: [], timerId: null, active: true };
    $('#focus-current-task').textContent = task;
    $('#focus-distractions').textContent = '0';
    $('#focus-setup').classList.add('hidden');
    $('#focus-result').classList.add('hidden');
    $('#focus-running').classList.remove('hidden');
    updateFocusClock();
    focus.timerId = setInterval(updateFocusClock, 250);
  }

  function updateFocusClock() {
    if (!focus?.active) return;
    const left = Math.max(0, Math.ceil((focus.endAt - Date.now()) / 1000));
    $('#focus-clock').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const elapsed = clamp(focus.plannedSec - left, 0, focus.plannedSec);
    $('#focus-progress').style.width = `${(elapsed / focus.plannedSec) * 100}%`;
    if (left <= 0) finishFocus(true);
  }

  function logDistraction(type) {
    if (!focus?.active) return;
    focus.distractions.push({ type, atSec: Math.round((Date.now() - focus.startAt) / 1000) });
    $('#focus-distractions').textContent = focus.distractions.length;
    toast('Registrado. Vuelve a tu tarea.');
  }

  function finishFocus(completed) {
    if (!focus?.active) return;
    focus.active = false;
    clearInterval(focus.timerId);
    const durationSec = Math.min(focus.plannedSec, Math.max(1, Math.round((Date.now() - focus.startAt) / 1000)));
    if (durationSec < 15) {
      $('#focus-running').classList.add('hidden'); $('#focus-setup').classList.remove('hidden'); focus = null;
      toast('Bloque demasiado corto para guardarlo'); return;
    }
    state.focusSessions.push({ id: uid(), at: Date.now(), task: focus.task, plannedSec: focus.plannedSec, durationSec, completed, distractions: focus.distractions });
    state.focusSessions = state.focusSessions.slice(-300);
    saveState();
    $('#focus-running').classList.add('hidden');
    $('#focus-result').classList.remove('hidden');
    $('#focus-result-title').textContent = completed ? 'Bloque completado' : 'Progreso guardado';
    const durationLabel = durationSec < 60 ? `${durationSec} s` : `${Math.round(durationSec / 60)} min`;
    $('#focus-result-copy').textContent = `${durationLabel} en “${focus.task}” con ${focus.distractions.length} ${focus.distractions.length === 1 ? 'distracción registrada' : 'distracciones registradas'}.`;
  }

  function resetFocusUI() {
    if (focus?.active) { clearInterval(focus.timerId); focus.active = false; }
    focus = null;
    $('#focus-setup').classList.remove('hidden');
    $('#focus-running').classList.add('hidden');
    $('#focus-result').classList.add('hidden');
    $('#focus-task').value = '';
  }

  function showAddCard(show = true) {
    $('#add-card-form').classList.toggle('hidden', !show);
    if (show) { $('#card-front').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  function addCard(event) {
    event.preventDefault();
    const front = $('#card-front').value.trim();
    const back = $('#card-back').value.trim();
    if (!front || !back) { $('#card-error').classList.remove('hidden'); return; }
    state.cards.push({ id: uid(), front, back, createdAt: Date.now(), dueAt: Date.now(), intervalDays: 0, reviews: 0, successes: 0 });
    saveState();
    event.target.reset();
    $('#card-error').classList.add('hidden');
    showAddCard(false);
    renderMemory();
    toast('Recuerdo añadido');
  }

  function formatDue(card) {
    const due = Number(card.dueAt || 0);
    const today = startOfToday();
    if (due <= Date.now()) return 'Pendiente ahora';
    if (due < today + DAY) return 'Más tarde hoy';
    const days = Math.ceil((due - today) / DAY);
    return days === 1 ? 'Mañana' : `En ${days} días`;
  }

  function renderMemory() {
    $('#memory-overview').classList.remove('hidden');
    $('#review-panel').classList.add('hidden');
    $('#review-result').classList.add('hidden');
    const due = getDueCards().length;
    $('#due-count-memory').textContent = due;
    $('#due-label-memory').textContent = due === 1 ? 'recuerdo para hoy' : 'recuerdos para hoy';
    $('#total-cards').textContent = state.cards.length;
    $('#start-review').disabled = !due;
    $('#start-review').textContent = due ? 'Empezar repaso' : state.cards.length ? 'Todo al día' : 'Añade un recuerdo';
    $('#memory-empty').classList.toggle('hidden', state.cards.length > 0);
    $('#card-library').classList.toggle('hidden', state.cards.length === 0);
    const list = $('#card-list');
    list.replaceChildren();
    [...state.cards].sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0)).forEach(card => {
      const item = document.createElement('article');
      item.className = 'memory-item';
      const content = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = card.front;
      const dueText = document.createElement('p');
      dueText.className = Number(card.dueAt || 0) <= Date.now() ? 'due' : '';
      dueText.textContent = `${formatDue(card)} · ${card.reviews || 0} repasos`;
      content.append(title, dueText);
      const del = document.createElement('button');
      del.className = 'icon-button'; del.type = 'button'; del.textContent = '×'; del.setAttribute('aria-label', `Eliminar: ${card.front}`);
      del.addEventListener('click', () => deleteCard(card.id));
      item.append(content, del); list.append(item);
    });
  }

  async function deleteCard(id) {
    const card = state.cards.find(c => c.id === id);
    const confirmed = await confirmAction('Eliminar recuerdo', `Se eliminará “${card?.front || ''}”. Esta acción no se puede deshacer.`);
    if (!confirmed) return;
    state.cards = state.cards.filter(c => c.id !== id);
    saveState(); renderMemory(); toast('Recuerdo eliminado');
  }

  function startReview() {
    const queue = getDueCards().map(c => c.id);
    if (!queue.length) { routeTo('memoria'); toast(state.cards.length ? 'No hay recuerdos pendientes' : 'Añade primero un recuerdo'); return; }
    routeTo('memoria');
    review = { queue, index: 0, completed: 0 };
    $('#memory-overview').classList.add('hidden');
    $('#add-card-form').classList.add('hidden');
    $('#review-result').classList.add('hidden');
    $('#review-panel').classList.remove('hidden');
    renderReviewCard();
  }

  function renderReviewCard() {
    const card = state.cards.find(c => c.id === review.queue[review.index]);
    if (!card) return advanceReview();
    $('#review-progress-label').textContent = `${review.index + 1} de ${review.queue.length}`;
    $('#review-progress-bar').style.width = `${(review.index / review.queue.length) * 100}%`;
    $('#review-front').textContent = card.front;
    $('#review-back').textContent = card.back;
    $('#review-answer').classList.add('hidden');
    $('#rating-panel').classList.add('hidden');
    $('#reveal-answer').classList.remove('hidden');
    $('#reveal-answer').focus();
  }

  function revealAnswer() {
    $('#review-answer').classList.remove('hidden');
    $('#rating-panel').classList.remove('hidden');
    $('#reveal-answer').classList.add('hidden');
    $('.rating-button.good').focus();
  }

  function rateReview(rating) {
    const card = state.cards.find(c => c.id === review.queue[review.index]);
    if (!card) return advanceReview();
    const previous = Number(card.intervalDays || 0);
    let nextDays = 0;
    if (rating === 'again') {
      card.intervalDays = 0;
      card.dueAt = Date.now() + 10 * 60000;
    } else if (rating === 'hard') {
      nextDays = previous < 1 ? 1 : Math.max(1, Math.round(previous * 1.45));
      card.intervalDays = nextDays;
      card.dueAt = startOfToday() + nextDays * DAY + 9 * 3600000;
      card.successes = (card.successes || 0) + 1;
    } else {
      nextDays = previous < 1 ? 2 : Math.max(previous + 1, Math.round(previous * 2.35));
      card.intervalDays = nextDays;
      card.dueAt = startOfToday() + nextDays * DAY + 9 * 3600000;
      card.successes = (card.successes || 0) + 1;
    }
    card.reviews = (card.reviews || 0) + 1;
    card.lastReviewedAt = Date.now();
    state.recallEvents.push({ id: uid(), at: Date.now(), cardId: card.id, rating });
    state.recallEvents = state.recallEvents.slice(-1000);
    review.completed += 1;
    saveState();
    advanceReview();
  }

  function advanceReview() {
    review.index += 1;
    if (review.index >= review.queue.length) return finishReview();
    renderReviewCard();
  }

  function finishReview() {
    $('#review-panel').classList.add('hidden');
    $('#review-result').classList.remove('hidden');
    $('#review-result-title').textContent = review.completed === 1 ? 'Has recuperado 1 recuerdo' : `Has recuperado ${review.completed} recuerdos`;
    $('#review-progress-bar').style.width = '100%';
  }

  function exitReview() {
    review = null;
    renderMemory();
  }

  function renderProgress() {
    const now = Date.now();
    $('#progress-active-days').textContent = activeDayKeys(30).size;
    const focus7 = state.focusSessions.filter(s => s.at >= now - 7 * DAY).reduce((sum, s) => sum + s.durationSec, 0);
    $('#progress-focus-time').textContent = `${Math.round(focus7 / 60)} min`;
    const recentRecalls = state.recallEvents.slice(-30);
    const successes = recentRecalls.filter(e => e.rating !== 'again').length;
    $('#progress-retention').textContent = recentRecalls.length ? `${Math.round(successes / recentRecalls.length * 100)}%` : '—';
    renderActivityChart(); renderAttentionTrend(); renderFocusBreakdown();
  }

  function lastDays(count) {
    return Array.from({ length: count }, (_, i) => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - (count - 1 - i)); return d; });
  }

  function renderActivityChart() {
    const days = lastDays(7);
    const values = days.map(d => {
      const key = dayKey(d);
      const attentionSec = state.attentionSessions.filter(s => dayKey(s.at) === key).reduce((a, s) => a + s.durationSec, 0);
      const focusSec = state.focusSessions.filter(s => dayKey(s.at) === key).reduce((a, s) => a + s.durationSec, 0);
      const recallMins = state.recallEvents.filter(e => dayKey(e.at) === key).length * .3;
      return Math.round((attentionSec + focusSec) / 60 + recallMins);
    });
    const max = Math.max(10, ...values);
    const chart = $('#activity-chart'); chart.replaceChildren();
    days.forEach((d, i) => {
      const col = document.createElement('div'); col.className = 'bar-column';
      const bar = document.createElement('div'); bar.className = 'bar-visual'; bar.style.height = `${Math.max(3, values[i] / max * 190)}px`;
      const value = document.createElement('span'); value.textContent = values[i];
      const label = document.createElement('small'); label.textContent = new Intl.DateTimeFormat('es-ES', { weekday: 'short' }).format(d).replace('.', '');
      bar.append(value); col.append(bar, label); chart.append(col);
    });
    chart.setAttribute('aria-label', `Minutos de práctica, del más antiguo al más reciente: ${values.join(', ')}`);
  }

  function renderAttentionTrend() {
    const sessions = state.attentionSessions.slice(-10);
    const container = $('#attention-sparkline'); container.replaceChildren();
    if (!sessions.length) { $('#attention-trend-text').textContent = 'Completa dos ejercicios para ver una tendencia.'; return; }
    const first = sessions.slice(0, Math.ceil(sessions.length / 2)).reduce((a,s) => a+s.accuracy,0) / Math.ceil(sessions.length/2);
    const secondSlice = sessions.slice(Math.floor(sessions.length / 2));
    const second = secondSlice.reduce((a,s) => a+s.accuracy,0) / secondSlice.length;
    const diff = Math.round((second - first) * 100);
    $('#attention-trend-text').textContent = sessions.length < 2 ? 'Primera medición guardada. Sigue priorizando precisión.' : diff > 2 ? `La precisión reciente es ${diff} puntos mayor.` : diff < -2 ? `La precisión reciente es ${Math.abs(diff)} puntos menor; prueba más descansado.` : 'La precisión se mantiene estable.';
    const w = 360, h = 82, pad = 6;
    const points = sessions.map((s, i) => `${pad + i * ((w-pad*2)/Math.max(1,sessions.length-1))},${pad + (1-s.accuracy)*(h-pad*2)}`).join(' ');
    container.innerHTML = `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><line x1="${pad}" y1="${h/2}" x2="${w-pad}" y2="${h/2}" stroke="var(--border)"/><polyline points="${points}" fill="none" stroke="var(--primary)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    container.setAttribute('aria-label', `Precisión en las últimas sesiones: ${sessions.map(s => Math.round(s.accuracy*100)+'%').join(', ')}`);
  }

  function renderFocusBreakdown() {
    const recent = state.focusSessions.filter(s => s.at >= Date.now() - 30 * DAY);
    const counts = { móvil: 0, pensamiento: 0, entorno: 0, otra: 0 };
    recent.forEach(s => (s.distractions || []).forEach(d => { counts[d.type] = (counts[d.type] || 0) + 1; }));
    const total = Object.values(counts).reduce((a,b)=>a+b,0);
    const mins = Math.round(recent.reduce((a,s)=>a+s.durationSec,0)/60);
    const distractionCopy = total === 1 ? '1 distracción registrada' : `${total} distracciones registradas`;
    $('#focus-trend-text').textContent = recent.length ? `${mins} min de concentración y ${distractionCopy} en 30 días.` : 'Completa un bloque para empezar a medir.';
    const box = $('#focus-breakdown'); box.replaceChildren();
    const max = Math.max(1, ...Object.values(counts));
    Object.entries(counts).forEach(([name, count]) => {
      const row = document.createElement('div'); row.className = 'breakdown-row';
      const label = document.createElement('span'); label.textContent = name.charAt(0).toUpperCase()+name.slice(1);
      const track = document.createElement('div'); track.className = 'breakdown-track';
      const fill = document.createElement('span'); fill.style.width = `${count/max*100}%`; track.append(fill);
      const value = document.createElement('strong'); value.textContent = count;
      row.append(label, track, value); box.append(row);
    });
  }

  function renderSettings() {
    $('#daily-goal').value = String(state.settings.dailyGoal);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `enfoco-copia-${dayKey()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Copia de seguridad creada');
  }

  async function importData(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.cards)) throw new Error('Formato no válido');
      const confirmed = await confirmAction('Importar copia', 'La copia sustituirá todos los datos actuales de EnFoco en este navegador.');
      if (!confirmed) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)); state = loadState();
      renderAll(); routeTo('inicio'); toast('Copia importada');
    } catch { toast('No se pudo importar ese archivo'); }
    finally { $('#import-data').value = ''; }
  }

  function confirmAction(title, copy) {
    const dialog = $('#confirm-dialog');
    $('#dialog-title').textContent = title; $('#dialog-copy').textContent = copy;
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
  }

  async function resetData() {
    const confirmed = await confirmAction('Borrar todos los datos', 'Se eliminarán de forma permanente tus recuerdos, sesiones y preferencias.');
    if (!confirmed) return;
    localStorage.removeItem(STORAGE_KEY); state = defaultState(); renderAll(); routeTo('inicio'); toast('Datos borrados');
  }

  function setupInstallExperience() {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const tip = $('#ios-install-tip');
    if (tip && isIos && !isStandalone && localStorage.getItem('enfoco-install-tip-dismissed') !== 'yes') {
      tip.hidden = false;
    }

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {
          // La aplicación continúa funcionando aunque el navegador bloquee el modo sin conexión.
        });
      });
    }
  }

  function renderAll() { renderHome(); renderMemory(); renderProgress(); renderSettings(); $('#attention-level-label').textContent = state.settings.attentionLevel; }

  function bindEvents() {
    $$('[data-route]').forEach(el => el.addEventListener('click', event => { event.preventDefault(); routeTo(el.dataset.route); }));
    $('[data-action="start-review-home"]').addEventListener('click', () => { if (getDueCards().length) startReview(); else { routeTo('memoria'); if (!state.cards.length) showAddCard(true); } });
    $('#attention-start').addEventListener('click', startAttention);
    $('#stimulus-stage').addEventListener('click', respondAttention);
    document.addEventListener('keydown', event => { if (event.code === 'Space' && attention?.active) respondAttention(event); });
    $('#attention-stop').addEventListener('click', () => finishAttention(true));
    $('#attention-again').addEventListener('click', resetAttentionUI);
    $('#focus-start').addEventListener('click', startFocus);
    $('#focus-task').addEventListener('input', () => $('#focus-error').classList.add('hidden'));
    $$('.distraction-button').forEach(btn => btn.addEventListener('click', () => logDistraction(btn.dataset.distraction)));
    $('#focus-finish').addEventListener('click', () => finishFocus(false));
    $('#focus-another').addEventListener('click', resetFocusUI);
    $('#show-add-card').addEventListener('click', () => showAddCard(true));
    $('#empty-add-card').addEventListener('click', () => showAddCard(true));
    $('#cancel-add-card').addEventListener('click', () => showAddCard(false));
    $('#add-card-form').addEventListener('submit', addCard);
    $('#start-review').addEventListener('click', startReview);
    $('#reveal-answer').addEventListener('click', revealAnswer);
    $$('.rating-button').forEach(btn => btn.addEventListener('click', () => rateReview(btn.dataset.rating)));
    $('#exit-review').addEventListener('click', exitReview);
    $('#review-back-library').addEventListener('click', exitReview);
    $('#daily-goal').addEventListener('change', event => { state.settings.dailyGoal = Number(event.target.value); saveState(); renderHome(); toast('Objetivo actualizado'); });
    $('#export-data').addEventListener('click', exportData);
    $('#import-data').addEventListener('change', event => importData(event.target.files[0]));
    $('#reset-data').addEventListener('click', resetData);
    $('#dismiss-install-tip').addEventListener('click', () => {
      $('#ios-install-tip').hidden = true;
      localStorage.setItem('enfoco-install-tip-dismissed', 'yes');
    });
    window.addEventListener('hashchange', () => routeTo(location.hash.slice(1) || 'inicio'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (attention?.active) updateAttentionClock(); if (focus?.active) updateFocusClock(); } });
  }

  bindEvents();
  setupInstallExperience();
  renderAll();
  resetAttentionUI();
  routeTo(location.hash.slice(1) || 'inicio');
})();
