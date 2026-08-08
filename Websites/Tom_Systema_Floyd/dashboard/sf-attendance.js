/*  Systema Floyd - shared attendance engine
    ------------------------------------------------------------------
    ONE implementation of the attendance data model, Supabase RPCs, the
    resilient save queue, and the by-person checklist UI. Used by BOTH
    the dashboard modal (index.html) and the standalone Attendance tab
    (attendance.html) so the marking/saving logic lives in exactly one
    place. Operates on a host page's `state` object (passed to init) so
    the dashboard's chart/roster code keeps reading state.attendanceByWeek
    / state.peopleByWeek unchanged.

    Usage:
      SFAtt.init({ state, SUPABASE_URL, SUPABASE_ANON, getToken, claimSecret,
                   getMarkedBy, onAttendanceLoaded, onPeopleLoaded });
      // data + RPCs: SFAtt.expectedPeopleFor(w,d), SFAtt.loadAttendance(), ...
      // interactive checklist:
      const ctl = SFAtt.createChecklist({ peopleListEl, getContext, onStatus, onChange, confirm });
      ctl.wire(); ctl.render();
*/
window.SFAtt = (function () {
  let cfg = null;
  const DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  let currentPeopleFilter = 'all';   // session-only, shared across checklist instances on a page
  let unloadWired = false;           // beforeunload guard is wired once per page

  // ── Optimistic-edit registry (prevents "marks disappear / have to re-tap") ──
  // Every per-person tap updates local state instantly, then saves in the
  // background. Between the tap and the confirmed save, a force-reload of the
  // day (e.g. re-opening the modal, which always refetches) used to overwrite
  // local state wholesale and wipe the just-made mark. We now record each
  // unconfirmed edit here and OVERLAY it on top of any freshly-loaded server
  // snapshot, so a refetch can never drop an in-flight mark. Cleared the instant
  // the write for that person confirms. `cell === null` is a pending delete.
  const pending = new Map();
  let pendSeq = 0;
  const _pkey = (w, d, k) => w + '\n' + d + '\n' + k;   // newline can't appear in week/day/personKey
  // markPending stamps each edit with a monotonic seq and RETURNS it. The
  // matching save clears its entry only if the seq still matches (compare-and-
  // clear) — so an older save confirming late can't wipe a NEWER re-tap's
  // pending guard and let a force-reload revert it.
  function markPending(week, day, pk, cell) { const seq = ++pendSeq; pending.set(_pkey(week, day, pk), { week, day, pk, cell, seq }); return seq; }
  function clearPendingIf(week, day, pk, seq) { const k = _pkey(week, day, pk); const e = pending.get(k); if (e && e.seq === seq) pending.delete(k); }
  function overlayPending(map) {
    pending.forEach(({ week, day, pk, cell }) => {
      if (cell === null) { if (map[week] && map[week][day]) delete map[week][day][pk]; return; }
      if (!map[week]) map[week] = {};
      if (!map[week][day]) map[week][day] = {};
      map[week][day][pk] = cell;
    });
  }
  function hasUnsaved() { return pending.size > 0; }
  // 4xx that a retry can never satisfy (permission/validation) — vs 401 (token
  // refresh, handled in sbFetch) and 408/429/5xx/network (transient, keep trying).
  function isTerminalErr(e) { const s = e && e.status; return s && s >= 400 && s < 500 && s !== 401 && s !== 408 && s !== 429; }

  function init(c) {
    cfg = Object.assign({
      claimSecret: '',
      photoBucket: 'attendance-photos',
      getToken: () => cfg.SUPABASE_ANON,
      getMarkedBy: () => null,
      onAttendanceLoaded: () => {},
      onPeopleLoaded: () => {},
      onPhotosLoaded: () => {},
      onQueueDrained: null,   // fired once the save queue empties (e.g. refresh KPIs)
    }, c);
    const s = cfg.state;
    if (s.attendanceByWeek === undefined) s.attendanceByWeek = null;
    if (s.peopleByWeek === undefined)     s.peopleByWeek = null;
    if (s.attendanceLoading === undefined) s.attendanceLoading = false;
    if (s.peopleLoading === undefined)     s.peopleLoading = false;
    return SFAtt;
  }

  const st = () => cfg.state;
  // Resolve a token at call time. Prefer SF_AUTH's on-demand refresh (handles
  // iOS Safari's throttled background auto-refresh); fall back to the sync
  // getToken for pages/tests that don't wire SF_AUTH.
  async function authToken(force) {
    const a = window.SF_AUTH;
    if (a) {
      if (force && a.refreshToken) return await a.refreshToken();
      if (a.freshToken) return await a.freshToken();
    }
    return cfg.getToken();
  }
  async function headers(force) {
    return { 'apikey': cfg.SUPABASE_ANON, 'Authorization': 'Bearer ' + (await authToken(force)), 'Content-Type': 'application/json' };
  }
  // Fetch that survives an expired JWT: if the token lapsed while the modal sat
  // open (long attendance sessions), a 401/PGRST301 forces a refresh + one retry
  // so queued writes don't pile up as "unsaved changes (connection issue)".
  async function sbFetch(url, opts) {
    let resp = await fetch(url, Object.assign({}, opts, { headers: await headers(false) }));
    if (resp.status === 401) {
      const body = await resp.clone().text().catch(() => '');
      if (/PGRST301|JWT expired|JWS|token is expired/i.test(body)) {
        resp = await fetch(url, Object.assign({}, opts, { headers: await headers(true) }));
      }
    }
    return resp;
  }
  // Paginated RPC read. PostgREST caps a single response at 1000 rows, so a
  // SETOF-returning RPC that spans every week silently truncates once the table
  // passes 1000 rows — the report + modal then render whole days as empty
  // ("Tuesday's times are missing", "it's subtracting days"). Page through with
  // limit/offset and an explicit stable order so we always get EVERY row.
  const RPC_PAGE = 1000;
  async function sbFetchAllRpc(fn, body, order) {
    let all = [], offset = 0;
    for (;;) {
      const q = '?limit=' + RPC_PAGE + '&offset=' + offset + (order ? '&order=' + order : '');
      const resp = await sbFetch(cfg.SUPABASE_URL + '/rest/v1/rpc/' + fn + q,
        { method: 'POST', body: JSON.stringify(body) });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const rows = await resp.json();
      if (!Array.isArray(rows)) return rows;                 // defensive: non-array payload
      all = all.concat(rows);
      if (rows.length < RPC_PAGE) break;                     // last page
      offset += RPC_PAGE;
      // Runaway guard. FAIL LOUD, never a silent break: a silent truncation here
      // would be the exact bug this pagination was written to kill (report/grant
      // under-counting). At ~1439 rows growing a few hundred/week this never fires.
      if (offset > 500000) throw new Error('attendance pagination exceeded safety limit; data may be incomplete');
    }
    return all;
  }
  function nowHHMM() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function personKey(r) { return `${r.name || ''}|${r.email || ''}`.toLowerCase(); }

  // ── local state model (operates on cfg.state.peopleByWeek) ──────────
  function loadPeoplePicks(week, day) {
    const cell = (st().peopleByWeek && st().peopleByWeek[week] && st().peopleByWeek[week][day]) || {};
    const out = {};
    Object.keys(cell).forEach(k => { if (cell[k] && cell[k].status) out[k] = cell[k].status; });
    return out;
  }
  function loadPeopleTimes(week, day) {
    const cell = (st().peopleByWeek && st().peopleByWeek[week] && st().peopleByWeek[week][day]) || {};
    const out = {};
    Object.keys(cell).forEach(k => { if (cell[k]) out[k] = { timeIn: cell[k].timeIn || '', timeOut: cell[k].timeOut || '' }; });
    return out;
  }
  function ensurePeopleCell(week, day) {
    const s = st();
    if (!s.peopleByWeek) s.peopleByWeek = {};
    if (!s.peopleByWeek[week]) s.peopleByWeek[week] = {};
    if (!s.peopleByWeek[week][day]) s.peopleByWeek[week][day] = {};
    return s.peopleByWeek[week][day];
  }
  function setPersonLocal(week, day, person, status, timeIn, timeOut) {
    const cell = ensurePeopleCell(week, day);
    const k = personKey(person);
    if (!status) delete cell[k];
    else {
      const prev = cell[k] || {};
      cell[k] = {
        status, name: person.name, bucket: person.bucket, markedAt: new Date().toISOString(),
        timeIn:  timeIn  !== undefined ? timeIn  : (prev.timeIn  || ''),
        timeOut: timeOut !== undefined ? timeOut : (prev.timeOut || ''),
      };
    }
  }
  function setBulkLocal(week, day, people, status) {
    const cell = ensurePeopleCell(week, day);
    if (!status) {
      people.forEach(p => { delete cell[personKey(p)]; });
    } else {
      const now = new Date().toISOString();
      const timeNow = status === 'present' ? nowHHMM() : '';
      people.forEach(p => {
        const k = personKey(p);
        const prev = cell[k] || {};
        cell[k] = { status, name: p.name, bucket: p.bucket, markedAt: now,
                    timeIn: prev.timeIn || timeNow, timeOut: prev.timeOut || '' };
      });
    }
  }

  // ── roster expansion (operates on cfg.state.snapshot.roster) ────────
  function expectedPeopleFor(week, day) {
    const wk = (st().snapshot && st().snapshot.roster && st().snapshot.roster[week]) || {};
    const dayIdx = DAY_KEYS.indexOf(day);
    const all = [];
    ['upper', 'lower', 'free'].forEach(b => {
      (wk[b] || []).forEach(r => {
        const days = Array.isArray(r.days) ? r.days : [true, true, true, true, true];
        if (!days[dayIdx]) return;
        const bucket = r.type === 'free' ? 'f' : r.campus === 'Lower Campus' ? 'l' : 'u';
        const isLower = r.campus === 'Lower Campus';
        const filterKey = r.type === 'free' ? (isLower ? 'lf' : 'uf') : (isLower ? 'lp' : 'up');
        all.push({ name: r.name || '(name missing)', email: r.email || null, bucket, filterKey });
      });
    });
    all.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return all;
  }
  function countPicks(picks, people) {
    let u = 0, l = 0, f = 0;
    people.forEach(p => {
      if (picks[personKey(p)] !== 'present') return;
      if (p.bucket === 'u') u++; else if (p.bucket === 'l') l++; else if (p.bucket === 'f') f++;
    });
    return { u, l, f };
  }
  function visiblePeopleFor(week, day) {
    const all = expectedPeopleFor(week, day);
    return currentPeopleFilter === 'all' ? all : all.filter(p => p.filterKey === currentPeopleFilter);
  }

  // ── Supabase RPCs ───────────────────────────────────────────────────
  async function loadAttendance(force) {
    const s = st();
    if (s.attendanceLoading) return;
    if (s.attendanceByWeek && !force) return;
    s.attendanceLoading = true;
    try {
      const rows = await sbFetchAllRpc('sf_get_daily_attendance', { p_week_label: null }, 'week_label,day_of_week');
      const map = {};
      rows.forEach(r => {
        if (!map[r.week_label]) map[r.week_label] = {};
        map[r.week_label][r.day_of_week] = { u: r.count_upper || 0, l: r.count_lower || 0, f: r.count_free || 0, markedAt: r.marked_at, markedBy: r.marked_by };
      });
      s.attendanceByWeek = map;
    } catch (e) {
      console.warn('[attendance] load failed:', e);
      s.attendanceByWeek = {};
    } finally {
      s.attendanceLoading = false;
      cfg.onAttendanceLoaded();
    }
  }
  async function saveAttendanceCell(week, day, upper, lower, free) {
    const resp = await sbFetch(cfg.SUPABASE_URL + '/rest/v1/rpc/sf_set_daily_attendance', {
      method: 'POST',
      body: JSON.stringify({
        claim_secret: cfg.claimSecret, p_week_label: week, p_day_of_week: day,
        p_count_upper: Math.max(0, parseInt(upper, 10) || 0),
        p_count_lower: Math.max(0, parseInt(lower, 10) || 0),
        p_count_free:  Math.max(0, parseInt(free, 10)  || 0),
        p_marked_by: cfg.getMarkedBy(),
      }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + (await resp.text()));
    const row = await resp.json();
    const s = st();
    if (!s.attendanceByWeek) s.attendanceByWeek = {};
    if (!s.attendanceByWeek[week]) s.attendanceByWeek[week] = {};
    s.attendanceByWeek[week][day] = { u: row.count_upper || 0, l: row.count_lower || 0, f: row.count_free || 0, markedAt: row.marked_at, markedBy: row.marked_by };
    return row;
  }
  async function loadPeopleAttendance(force) {
    const s = st();
    if (s.peopleLoading) return;
    if (s.peopleByWeek && !force) return;
    s.peopleLoading = true;
    try {
      const rows = await sbFetchAllRpc('sf_get_daily_attendance_people', { p_week_label: null }, 'week_label,day_of_week,person_key');
      const map = {};
      rows.forEach(r => {
        if (!map[r.week_label]) map[r.week_label] = {};
        if (!map[r.week_label][r.day_of_week]) map[r.week_label][r.day_of_week] = {};
        map[r.week_label][r.day_of_week][r.person_key] = {
          status: r.status, name: r.person_name, bucket: r.bucket, markedAt: r.marked_at,
          markedBy: r.marked_by, timeIn: r.time_in || '', timeOut: r.time_out || '',
        };
      });
      // Overlay any still-unconfirmed local edits so a refetch (modal re-open
      // force-loads every time) can't wipe a mark whose save is still in flight.
      overlayPending(map);
      s.peopleByWeek = map;
    } catch (e) {
      console.warn('[people-attendance] load failed:', e);
      s.peopleByWeek = s.peopleByWeek || {};
    } finally {
      s.peopleLoading = false;
      cfg.onPeopleLoaded();
    }
  }
  async function setPersonPickRpc(week, day, person, status, timeIn, timeOut) {
    const resp = await sbFetch(cfg.SUPABASE_URL + '/rest/v1/rpc/sf_set_daily_attendance_person', {
      method: 'POST',
      body: JSON.stringify({
        claim_secret: cfg.claimSecret, p_week_label: week, p_day_of_week: day,
        p_person_key: personKey(person), p_person_name: person.name, p_bucket: person.bucket,
        p_status: status, p_marked_by: cfg.getMarkedBy(), p_time_in: timeIn || null, p_time_out: timeOut || null,
      }),
    });
    if (!resp.ok) { const err = new Error('HTTP ' + resp.status + ': ' + (await resp.text())); err.status = resp.status; throw err; }
  }
  async function bulkSetPeoplePicksRpc(week, day, status, people) {
    const resp = await sbFetch(cfg.SUPABASE_URL + '/rest/v1/rpc/sf_bulk_set_daily_attendance_people', {
      method: 'POST',
      body: JSON.stringify({
        claim_secret: cfg.claimSecret, p_week_label: week, p_day_of_week: day, p_status: status,
        p_persons: people.map(p => {
          const cell = (st().peopleByWeek && st().peopleByWeek[week] && st().peopleByWeek[week][day] && st().peopleByWeek[week][day][personKey(p)]) || {};
          return { key: personKey(p), name: p.name, bucket: p.bucket, time_in: cell.timeIn || null, time_out: cell.timeOut || null };
        }),
        p_marked_by: cfg.getMarkedBy(),
      }),
    });
    if (!resp.ok) { const err = new Error('HTTP ' + resp.status + ': ' + (await resp.text())); err.status = resp.status; throw err; }
  }
  function attendanceTotalsForWeek(week) {
    const wk = (st().attendanceByWeek && st().attendanceByWeek[week]) || {};
    let upper = 0, lower = 0, free = 0;
    DAY_KEYS.forEach(d => { const c = wk[d]; if (!c) return; upper += c.u || 0; lower += c.l || 0; free += c.f || 0; });
    return { 'Upper Campus': upper, 'Lower Campus': lower, 'Unknown': 0, 'Free': free };
  }

  // ── checklist rendering ─────────────────────────────────────────────
  function renderPeopleList(week, day, container) {
    container = container || document.getElementById('att-people');
    if (!container) return;
    const all    = expectedPeopleFor(week, day);
    const people = currentPeopleFilter === 'all' ? all : all.filter(p => p.filterKey === currentPeopleFilter);
    const picks  = loadPeoplePicks(week, day);

    const counts = { up: 0, lp: 0, uf: 0, lf: 0 };
    all.forEach(p => { counts[p.filterKey] = (counts[p.filterKey] || 0) + 1; });
    const chip = (key, label, n) =>
      `<button type="button" data-att-filter="${key}" class="${currentPeopleFilter === key ? 'active' : ''}">${label} (${n})</button>`;
    const filters = `<div class="att-filter">
        ${chip('all', 'All', all.length)}
        ${chip('up', 'Upper Paid', counts.up)}
        ${chip('lp', 'Lower Paid', counts.lp)}
        ${chip('uf', 'Upper Free', counts.uf)}
        ${chip('lf', 'Lower Free', counts.lf)}
      </div>`;

    if (all.length === 0) {
      container.innerHTML = filters + `<div class="att-empty">No expected students for this day.</div>`;
      return;
    }
    const bulk = `<div class="att-bulk">
        <button type="button" data-att-bulk="all-present">All ✓ present</button>
        <button type="button" data-att-bulk="all-absent">All ✗ absent</button>
        <button type="button" data-att-bulk="clear">Clear marks</button>
      </div>`;
    if (people.length === 0) {
      container.innerHTML = filters + bulk + `<div class="att-empty">No students in this filter.</div>`;
      return;
    }
    const times = loadPeopleTimes(week, day);
    const rows = people.map(p => {
      const key = personKey(p);
      const st2 = picks[key] || '';
      const cls = st2 === 'present' ? 'present' : st2 === 'absent' ? 'absent' : '';
      const dotCls = p.bucket === 'u' ? 'u' : p.bucket === 'l' ? 'l' : 'f';
      const safeName = String(p.name).replace(/</g, '&lt;');
      const safeKey  = key.replace(/"/g, '&quot;');
      const t = times[key] || { timeIn: '', timeOut: '' };
      return `<div class="att-person ${cls}" data-pk="${safeKey}">
          <span class="dot ${dotCls}" title="${p.bucket === 'u' ? 'Upper' : p.bucket === 'l' ? 'Lower' : 'Free'}"></span>
          <span class="nm">${safeName}</span>
          <span class="att-times">
            <span class="att-tlbl">In</span><input type="time" class="att-time-in" value="${t.timeIn}" data-field="time_in">
            <span class="att-tlbl">Out</span><input type="time" class="att-time-out" value="${t.timeOut}" data-field="time_out">
          </span>
          <span class="att-marks">
            <button type="button" class="att-mark yes" data-att-pick="present" aria-label="Mark present">✓</button>
            <button type="button" class="att-mark no"  data-att-pick="absent"  aria-label="Mark absent">✗</button>
          </span>
        </div>`;
    }).join('');
    container.innerHTML = filters + bulk + rows;
  }

  // ── interactive checklist controller (marks + save queue) ───────────
  // opts: { peopleListEl, getContext()->{week,day}, onStatus(text,kind),
  //         onChange(), confirm(msg)->bool }
  function createChecklist(opts) {
    const peopleEl = opts.peopleListEl;
    const getCtx   = opts.getContext;
    const onStatus = opts.onStatus || (() => {});
    const onChange = opts.onChange || (() => {});
    const confirmFn = opts.confirm || ((m) => window.confirm(m));

    // Resilient save queue: keyed (newest edit per target wins; writes are
    // idempotent upserts), auto-retries failed writes every 4s, persistent
    // status so a flaky connection can't silently drop a mark.
    const queue = new Map();
    let flushTimer = null, flushing = false, terminalMsg = null;
    function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 4000); }
    async function flush() {
      if (flushing) return;
      clearTimeout(flushTimer);
      flushing = true;
      terminalMsg = null;   // reset per cycle; a run sets it on a non-retryable failure
      if (queue.size) onStatus('Saving…', '');
      for (const [key, run] of Array.from(queue.entries())) {
        // Compare-and-delete: only clear the slot if the run we just awaited is
        // still the one queued. A rapid re-tap of the same person during the
        // await replaces it with a newer intent; deleting blindly would drop
        // that newer edit (a mark that silently never saves).
        try { await run(); if (queue.get(key) === run) queue.delete(key); }
        catch (e) { /* keep queued, retry */ }
      }
      flushing = false;
      const n = queue.size;
      if (n) { onStatus('⚠ ' + n + ' change' + (n === 1 ? '' : 's') + ' not saved — retrying…', 'error'); scheduleFlush(); }
      else if (terminalMsg) { onStatus(terminalMsg, 'error'); if (cfg.onQueueDrained) cfg.onQueueDrained(); }
      else   { onStatus('✓ Saved', 'success'); if (cfg.onQueueDrained) cfg.onQueueDrained(); }
    }
    function queueSave(key, run) { queue.set(key, run); onStatus('Saving…', ''); flush(); }
    // A write that can never succeed (403 permission, 400 validation) must not
    // retry forever — that pins hasUnsaved()/the beforeunload nag on. Drop it,
    // clear its pending guard, and surface a distinct message.
    function onTerminal(e, clearFns) {
      clearFns.forEach(fn => fn());
      terminalMsg = (e && e.status === 403)
        ? '⚠ Not saved — you do not have permission to edit this.'
        : '⚠ Not saved — the change was rejected (' + ((e && e.status) || 'error') + ').';
    }

    // Queue a per-person save that (a) registers the optimistic value as
    // "pending" (seq-stamped) so a concurrent force-reload can't wipe it, and
    // (b) clears that guard only once THIS write confirms (compare-and-clear —
    // a newer re-tap's guard is never wiped by an older save landing late).
    // Reads the freshly-updated local cell (callers mutate state first).
    function savePersonQueued(week, day, person) {
      const pk = personKey(person);
      const cell = (((st().peopleByWeek || {})[week] || {})[day] || {})[pk] || null;
      const seq = markPending(week, day, pk, cell ? Object.assign({}, cell) : null);
      const status = cell ? cell.status : null;
      const timeIn = cell ? cell.timeIn : '';
      const timeOut = cell ? cell.timeOut : '';
      queueSave('p:' + pk, async () => {
        try {
          await setPersonPickRpc(week, day, person, status, timeIn, timeOut);
          clearPendingIf(week, day, pk, seq);
        } catch (e) {
          if (isTerminalErr(e)) { onTerminal(e, [() => clearPendingIf(week, day, pk, seq)]); return; }
          throw e;   // transient: keep queued, retry
        }
      });
    }
    function saveBulkQueued(week, day, status, people) {
      const marks = people.map(p => {
        const pk = personKey(p);
        const cell = (((st().peopleByWeek || {})[week] || {})[day] || {})[pk] || null;
        return { pk, seq: markPending(week, day, pk, cell ? Object.assign({}, cell) : null) };
      });
      queueSave('bulk', async () => {
        try {
          await bulkSetPeoplePicksRpc(week, day, status, people);
          marks.forEach(m => clearPendingIf(week, day, m.pk, m.seq));
        } catch (e) {
          if (isTerminalErr(e)) { onTerminal(e, [() => marks.forEach(m => clearPendingIf(week, day, m.pk, m.seq))]); return; }
          throw e;
        }
      });
    }

    function render() {
      const { week, day } = getCtx();
      if (week && day) renderPeopleList(week, day, peopleEl);
    }

    let wired = false;
    function wire() {
      if (wired) return; wired = true;

      // Warn before leaving with unconfirmed marks still in the save queue
      // (tab close, back button, reload). Wired once per page.
      if (!unloadWired) {
        unloadWired = true;
        window.addEventListener('beforeunload', (e) => {
          if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; return ''; }
        });
      }

      peopleEl.addEventListener('click', e => {
        const { week, day } = getCtx();
        if (!week || !day) return;
        const filterBtn = e.target.closest('[data-att-filter]');
        if (filterBtn) { currentPeopleFilter = filterBtn.dataset.attFilter; render(); return; }

        const bulk = e.target.closest('[data-att-bulk]');
        if (bulk) {
          const mode = bulk.dataset.attBulk;
          const people = visiblePeopleFor(week, day);
          if (people.length === 0) return;
          const status = mode === 'all-present' ? 'present' : mode === 'all-absent' ? 'absent' : null;
          if (status === null) {
            const picks  = loadPeoplePicks(week, day);
            const marked = people.filter(p => picks[personKey(p)]).length;
            if (marked > 0 && !confirmFn(
              `Clear attendance for ${marked} student${marked === 1 ? '' : 's'} on ${day}?\n\n` +
              `This removes their present/absent marks and time in/out. It cannot be undone from the dashboard.`)) return;
          }
          setBulkLocal(week, day, people, status);
          render(); onChange();
          saveBulkQueued(week, day, status, people);
          return;
        }

        const mark = e.target.closest('[data-att-pick]');
        if (!mark) return;
        const row = mark.closest('.att-person');
        if (!row) return;
        const pk = row.getAttribute('data-pk');
        const want = mark.dataset.attPick;
        const people = expectedPeopleFor(week, day);
        const person = people.find(p => personKey(p) === pk);
        if (!person) return;
        const picks = loadPeoplePicks(week, day);
        const next  = picks[pk] === want ? null : want;
        const prevTimes = loadPeopleTimes(week, day)[pk] || { timeIn: '', timeOut: '' };
        let timeIn = prevTimes.timeIn, timeOut = prevTimes.timeOut;
        if (next === 'present' && !timeIn) timeIn = nowHHMM();
        if (next === 'absent' || next === null) { timeIn = ''; timeOut = ''; }
        setPersonLocal(week, day, person, next, timeIn, timeOut);
        render(); onChange();
        savePersonQueued(week, day, person);
      });

      peopleEl.addEventListener('change', e => {
        const inp = e.target.closest('.att-time-in, .att-time-out');
        if (!inp) return;
        const { week, day } = getCtx();
        if (!week || !day) return;
        const row = inp.closest('.att-person');
        if (!row) return;
        const pk = row.getAttribute('data-pk');
        const people = expectedPeopleFor(week, day);
        const person = people.find(p => personKey(p) === pk);
        if (!person) return;
        const cell = ensurePeopleCell(week, day);
        const rec  = cell[pk];
        if (!rec) return;
        const isIn = inp.classList.contains('att-time-in');
        if (isIn) rec.timeIn = inp.value || ''; else rec.timeOut = inp.value || '';
        savePersonQueued(week, day, person);
      });
    }

    // "Clear the whole day" (every expected student), confirm-guarded.
    function clearAll() {
      const { week, day } = getCtx();
      if (!week || !day) return;
      const people = expectedPeopleFor(week, day);
      const picks  = loadPeoplePicks(week, day);
      const marked = people.filter(p => picks[personKey(p)]).length;
      if (marked > 0 && !confirmFn(
        `Clear ALL attendance for ${day}?\n\nThis deletes present/absent marks and time in/out for ${marked} student${marked === 1 ? '' : 's'}. It cannot be undone from the dashboard.`)) return;
      setBulkLocal(week, day, people, null);
      render(); onChange();
      saveBulkQueued(week, day, null, people);
    }

    return {
      wire, render, clearAll, queueSave, flush,
      queueSize: () => queue.size,
    };
  }

  // ── Session photos (backup attendance proof) ────────────────────────
  // Group photo per (week, day) in Supabase Storage bucket `attendance-photos`
  // (public-read) + metadata via the claim_secret-gated sf_add_attendance_photo
  // RPC. Shared by the dashboard photo modal and the Attendance tab.
  const _photos = { map: {}, loaded: false };
  let _sb = null;
  function sbStorage() { if (!_sb) _sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON); return _sb.storage; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  const phSlug = s => String(s || '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'wk';
  const phUuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id' + Date.now() + Math.round(Math.random() * 1e9);
  const isHeic = (f) => { const t = (f.type || '').toLowerCase(), n = (f.name || '').toLowerCase(); return t.includes('heic') || t.includes('heif') || /\.(heic|heif)$/.test(n); };
  const HEIC_HELP = 'This looks like an iPhone HEIC photo this browser could not convert. On the iPhone, open Settings, Camera, Formats and choose "Most Compatible" (it then saves JPEGs), or pick the photo again so iOS converts it. Most iPhones upload fine; this only affects certain HEIC files.';
  function downscaleToJpeg(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight;
        if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read image')); };
      img.src = url;
    });
  }
  async function phRpc(fn, body) {
    const r = await sbFetch(cfg.SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + (await r.text()));
    return r.json();
  }
  const photos = {
    map: () => _photos.map,
    isHeic,
    async load(force) {
      if (_photos.loaded && !force) return _photos.map;
      const rows = await phRpc('sf_get_attendance_photos', { p_week_label: null });
      const map = {};
      rows.forEach(r => { (map[r.week_label] = map[r.week_label] || {}); (map[r.week_label][r.day_of_week] = map[r.week_label][r.day_of_week] || []).push(r); });
      _photos.map = map; _photos.loaded = true;
      cfg.onPhotosLoaded(map);
      return map;
    },
    for: (week, day) => (_photos.map[week] && _photos.map[week][day]) || [],
    count() { let n = 0; Object.values(_photos.map).forEach(d => Object.values(d).forEach(a => { n += a.length; })); return n; },
    thumbsHtml(week, day) {
      const list = photos.for(week, day);
      if (!list.length) return '<div class="ph-empty">No photos for this session yet.</div>';
      return list.map(p => `<div class="ph-thumb"><img src="${esc(p.public_url)}" alt="Session photo" loading="lazy" />${p.caption ? `<span class="ph-cap" title="${esc(p.caption)}">${esc(p.caption)}</span>` : ''}<button type="button" class="ph-del" data-id="${esc(p.id)}" data-path="${esc(p.storage_path)}" title="Delete photo">&times;</button></div>`).join('');
    },
    async upload(files, opts) {
      opts = opts || {};
      const week = opts.week, day = opts.day, onStatus = opts.onStatus || (() => {});
      const caption = (opts.caption || '').trim() || null;
      if (!files || !files.length || !week) return 0;
      const storage = sbStorage();
      let done = 0;
      for (const f of files) {
        const heic = isHeic(f);
        onStatus(`Uploading ${done + 1} of ${files.length}…` + (heic ? ' (converting iPhone photo…)' : ''), '');
        let blob;
        try { blob = await downscaleToJpeg(f, 1400, 0.82); }
        catch (err) { throw new Error(heic ? HEIC_HELP : (err.message || String(err))); }
        const path = phSlug(week) + '/' + day + '/' + phUuid() + '.jpg';
        const up = await storage.from(cfg.photoBucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (up.error) throw up.error;
        const pub = storage.from(cfg.photoBucket).getPublicUrl(path).data.publicUrl;
        await phRpc('sf_add_attendance_photo', {
          claim_secret: cfg.claimSecret, p_week_label: week, p_day_of_week: day,
          p_storage_path: path, p_public_url: pub, p_caption: caption, p_campus: null,
          p_uploaded_by: cfg.getMarkedBy(),
        });
        done++;
      }
      await photos.load(true);
      return done;
    },
    async remove(id, path) {
      try { await sbStorage().from(cfg.photoBucket).remove([path]); } catch (_) { /* metadata delete is source of truth */ }
      await phRpc('sf_delete_attendance_photo', { claim_secret: cfg.claimSecret, p_id: id });
      await photos.load(true);
    },
  };

  return {
    init, get cfg() { return cfg; },
    DAY_KEYS,
    getFilter: () => currentPeopleFilter,
    setFilter: (f) => { currentPeopleFilter = f; },
    nowHHMM, personKey, loadPeoplePicks, loadPeopleTimes, ensurePeopleCell,
    setPersonLocal, setBulkLocal, expectedPeopleFor, countPicks, visiblePeopleFor,
    loadAttendance, saveAttendanceCell, loadPeopleAttendance, setPersonPickRpc,
    bulkSetPeoplePicksRpc, attendanceTotalsForWeek, renderPeopleList, createChecklist,
    photos, hasUnsaved,
  };
})();
