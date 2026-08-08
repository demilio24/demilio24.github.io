/* sf-grant-compute.js — pure rollups for the Grant Monitoring tab.
   Loadable in the browser (window.SFGrant) and in Node (module.exports).
   No DOM, no fetch: takes a snapshot + attendance map + grant config and
   returns the numbers the page renders. Keep it pure so it stays testable. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SFGrant = api;
})(this, function () {
  const SCHOOL_MAP = {
    'Northboro Elementary School': 'Northboro',
    'Roosevelt Elementary School': 'Roosevelt',
    'Pleasant City Elementary School': 'Pleasant City',
    'U.B. Kinsey Educational and Community Center': 'UB Kinsey',
    'Westward Elementary School': 'Westward',
  };
  const SCHOOL_ORDER = ['Northboro', 'Roosevelt', 'Pleasant City', 'UB Kinsey', 'Westward', 'Other'];

  function normalizeSchool(name) { return SCHOOL_MAP[(name || '').trim()] || 'Other'; }
  const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
  function personKey(s) { return (norm(s.name) + '|' + norm(s.email)); }

  function collectFreeRoster(snap) {
    if (!snap || !snap.roster) return { weeks: [], byWeek: {} };
    const weeks = (snap.free && Array.isArray(snap.free.weekOrder))
      ? snap.free.weekOrder.slice() : (snap.weekOrder || []).slice();
    const byWeek = {};
    weeks.forEach(w => {
      const b = snap.roster[w] || {};
      byWeek[w] = Array.isArray(b.free) ? b.free.slice() : [];
    });
    return { weeks, byWeek };
  }

  // attMap: { [week_label]: { [day]: { [person_key]: { status } } } }
  function presentDays(attMap, week, pkey) {
    const days = attMap[week] || {};
    let n = 0;
    Object.keys(days).forEach(d => { const rec = days[d][pkey]; if (rec && rec.status === 'present') n++; });
    return n;
  }
  // True only if this specific week actually has any attendance records. Without
  // this, a week that just hasn't been marked yet would report every registered
  // student as a no-show (attended 0 / met 0) — wrong on a foundation report.
  function weekHasAttendance(attMap, week) {
    const days = (attMap || {})[week];
    if (!days) return false;
    return Object.keys(days).some(d => days[d] && Object.keys(days[d]).length);
  }

  function weekRollups(snap, attMap) {
    const roster = collectFreeRoster(snap);
    const cmp = (a, b) => a.localeCompare(b);
    return roster.weeks.map((w, i) => {
      const list = roster.byWeek[w] || [];
      const hasAtt = weekHasAttendance(attMap, w);
      const registeredNames = [], attendedNames = [], noShowNames = [];
      list.forEach(s => {
        const nm = (s.name || '').trim();
        registeredNames.push(nm);
        if (hasAtt && presentDays(attMap || {}, w, personKey(s)) >= 1) attendedNames.push(nm);
        else if (hasAtt) noShowNames.push(nm);
      });
      registeredNames.sort(cmp); attendedNames.sort(cmp); noShowNames.sort(cmp);
      const registered = list.length, attended = attendedNames.length;
      return { week: w, weekNumber: i + 1, registered, hasAtt,
        noShow: hasAtt ? noShowNames.length : 0, attended, metReq: attended,
        registeredNames, attendedNames, noShowNames };
    });
  }

  function uniqueCount(snap) {
    const roster = collectFreeRoster(snap);
    const seen = new Set();
    Object.values(roster.byWeek).forEach(list => list.forEach(s => seen.add(personKey(s))));
    return seen.size;
  }

  function summaryRollup(snap, config) {
    const c = config || {};
    const running = Object.values((snap.free && snap.free.byWeek) || {}).reduce((a, b) => a + b, 0);
    const unique = (snap.free && typeof snap.free.total === 'number') ? snap.free.total : uniqueCount(snap);
    return {
      runningWeeks: running,
      totalWeeks: running + (c.withdrawn_weeks || 0),
      uniqueStudents: unique,
      totalUniqueStudents: unique + (c.withdrawn_students || 0),
      waitlistTotal: c.waitlist_total || 0,
      waitlistMoved: c.waitlist_moved || 0,
    };
  }

  function schoolBreakdown(snap) {
    const roster = collectFreeRoster(snap);
    const bySchool = {};   // label -> Set(personKey)
    Object.values(roster.byWeek).forEach(list => list.forEach(s => {
      const label = normalizeSchool(s.school);
      (bySchool[label] = bySchool[label] || new Set()).add(personKey(s));
    }));
    return SCHOOL_ORDER
      .map(label => ({ school: label, count: bySchool[label] ? bySchool[label].size : 0 }))
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  return { normalizeSchool, personKey, collectFreeRoster, weekRollups, summaryRollup, schoolBreakdown };
});
