/* sf-grant-view.js — the Related Ross Foundation grant-monitoring feature, as a
   mountable module so it can live as a tab inside free-camp.html (and anywhere
   else). Owns its own DOM, styles, data loading and editing. Depends on
   sf-grant-compute.js (window.SFGrant). All classes are namespaced `sfgv-` and
   scoped under `.sfgv` so they never collide with the host page's styles.
   Visual language: refined, institutional, on the Systema Floyd token system
   (blue + gold, Oswald display / Inter body), built to read as a credible
   grant-report a foundation would trust. */
(function () {
  'use strict';
  if (window.SFGrantView) return;

  const CSS = `
.sfgv{--sfgv-gap:16px;color:var(--sf-ink)}
.sfgv *{box-sizing:border-box}

/* ---- section header with gold accent ---- */
.sfgv .sfgv-section{margin-bottom:30px}
.sfgv .sfgv-head{display:flex;align-items:center;gap:14px;margin:2px 0 16px}
.sfgv .sfgv-accent{width:4px;align-self:stretch;min-height:34px;border-radius:99px;background:var(--grad-gold);flex-shrink:0}
.sfgv .sfgv-head-txt{display:flex;flex-direction:column;gap:2px}
.sfgv .sfgv-head h2{font-family:'Oswald','Inter',sans-serif;font-size:18px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin:0;color:var(--sf-ink);line-height:1}
.sfgv .sfgv-head .sfgv-sub{font-family:'Space Grotesk','Inter',sans-serif;font-size:12.5px;font-weight:500;color:var(--sf-ink-50)}

/* ---- Edit grant terms button (prominent, gold) ---- */
.sfgv .sfgv-edit-btn{margin-left:auto;display:inline-flex;align-items:center;gap:8px;font-family:'Oswald',sans-serif;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--sf-amber-deep);background:var(--sf-white);border:1.6px solid var(--sf-gold);border-radius:9px;padding:10px 16px;cursor:pointer;box-shadow:0 2px 8px -2px rgba(201,122,22,.25);transition:background .2s var(--ease-out),color .2s,box-shadow .2s,transform .2s}
.sfgv .sfgv-edit-btn svg{width:15px;height:15px;stroke-width:2.3}
.sfgv .sfgv-edit-btn:hover{background:var(--grad-gold);color:#fff;box-shadow:0 8px 20px -6px rgba(201,122,22,.5);transform:translateY(-1px)}
.sfgv .sfgv-edit-btn.open{background:var(--grad-gold);color:#fff;box-shadow:inset 0 2px 6px rgba(120,70,10,.35)}
.sfgv .sfgv-edit-btn .sfgv-caret{transition:transform .25s var(--ease-out)}
.sfgv .sfgv-edit-btn.open .sfgv-caret{transform:rotate(180deg)}

/* ---- terms editor panel (expands without clipping via grid rows) ---- */
.sfgv .sfgv-terms-wrap{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows .34s var(--ease-out),opacity .3s,margin .34s}
.sfgv .sfgv-terms-wrap.open{grid-template-rows:1fr;opacity:1;margin:0 0 22px}
.sfgv .sfgv-terms-inner{overflow:hidden;min-height:0}
.sfgv .sfgv-terms{background:linear-gradient(180deg,#fffdf6,#fff);border:1.5px solid var(--sf-gold);border-radius:16px;padding:22px 24px;box-shadow:0 16px 40px -22px rgba(201,122,22,.4)}
.sfgv .sfgv-terms-h{display:flex;align-items:flex-start;gap:12px;margin-bottom:6px}
.sfgv .sfgv-terms-h .ico{width:34px;height:34px;border-radius:9px;background:var(--sf-gold-soft);color:var(--sf-amber-deep);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sfgv .sfgv-terms-h h3{font-family:'Oswald',sans-serif;font-size:15px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin:0 0 2px}
.sfgv .sfgv-terms-h p{margin:0;font-size:12.5px;color:var(--sf-ink-50);line-height:1.45;max-width:560px}
.sfgv .sfgv-terms-grp{margin-top:16px}
.sfgv .sfgv-terms-grp .lbl{font-family:'Oswald',sans-serif;font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--sf-ink-40);margin-bottom:10px}
.sfgv .sfgv-terms-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}
.sfgv .sfgv-field{display:flex;flex-direction:column;gap:5px}
.sfgv .sfgv-field label{font-size:12px;font-weight:600;color:var(--sf-ink-60)}
.sfgv .sfgv-field .hint{font-size:11px;color:var(--sf-ink-40);line-height:1.35}
.sfgv .sfgv-field input{border:1.5px solid var(--sf-border-strong);border-radius:8px;padding:10px 12px;min-height:44px;font-size:15px;font-family:inherit;font-variant-numeric:tabular-nums;background:var(--sf-white);transition:border-color .15s,box-shadow .15s}
.sfgv .sfgv-field input:focus{outline:none;border-color:var(--sf-amber);box-shadow:0 0 0 3px rgba(243,168,71,.2)}
.sfgv .sfgv-terms-foot{display:flex;align-items:center;gap:12px;margin-top:20px;padding-top:18px;border-top:1px solid var(--sf-border)}
.sfgv .sfgv-save{display:inline-flex;align-items:center;gap:8px;font-family:'Oswald',sans-serif;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#fff;background:var(--grad-gold);border:0;border-radius:9px;padding:11px 22px;cursor:pointer;box-shadow:0 8px 20px -8px rgba(201,122,22,.55);transition:transform .2s,box-shadow .2s,opacity .2s}
.sfgv .sfgv-save:hover{transform:translateY(-1px);box-shadow:0 12px 26px -8px rgba(201,122,22,.6)}
.sfgv .sfgv-save:disabled{opacity:.7;cursor:wait;transform:none}
.sfgv .sfgv-cancel{font-family:'Oswald',sans-serif;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--sf-ink-50);background:none;border:0;cursor:pointer;padding:8px 6px}
.sfgv .sfgv-cancel:hover{color:var(--sf-ink)}

/* ---- summary KPI cards ---- */
.sfgv .sfgv-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--sfgv-gap)}
@media (max-width:900px){.sfgv .sfgv-kpis{grid-template-columns:repeat(2,1fr)}}
.sfgv .sfgv-kpi{position:relative;background:var(--sf-white);border:1px solid var(--sf-border);border-radius:16px;padding:20px;box-shadow:var(--shadow-sm);overflow:hidden;transition:transform .35s var(--ease-out),box-shadow .35s,border-color .35s}
.sfgv .sfgv-kpi:hover{transform:translateY(-3px);box-shadow:var(--shadow-md);border-color:var(--sf-border-strong)}
.sfgv .sfgv-kpi::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:var(--grad-blue)}
.sfgv .sfgv-kpi.sfgv-gold::before{background:var(--grad-gold)}
.sfgv .sfgv-kpi-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.sfgv .sfgv-kpi .ico{width:38px;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--sf-blue-50);color:var(--sf-blue-600)}
.sfgv .sfgv-kpi.sfgv-gold .ico{background:var(--sf-gold-soft);color:var(--sf-amber-deep)}
.sfgv .sfgv-kpi .ico svg{width:19px;height:19px;stroke-width:2.1}
.sfgv .sfgv-chip{font-family:'Space Grotesk','Inter',sans-serif;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:99px;letter-spacing:.02em}
.sfgv .sfgv-chip.ok{background:rgba(45,163,117,.16);color:#1f8a5f}
.sfgv .sfgv-chip.mid{background:var(--sf-blue-50);color:var(--sf-blue-700)}
.sfgv .sfgv-chip.ref{background:var(--sf-cream-2);color:var(--sf-ink-50)}
.sfgv .sfgv-kpi h3{font-family:'Oswald',sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--sf-ink-50);margin:0 0 7px;text-transform:uppercase}
.sfgv .sfgv-kpi .sfgv-num{font-family:'Oswald',sans-serif;font-size:40px;font-weight:700;line-height:.95;color:var(--sf-blue-700);font-variant-numeric:tabular-nums}
.sfgv .sfgv-kpi.sfgv-gold .sfgv-num{color:var(--sf-amber-deep)}
.sfgv .sfgv-kpi .sfgv-num .sfgv-target{font-size:16px;color:var(--sf-ink-50);font-weight:600;letter-spacing:.01em}
.sfgv .sfgv-kpi .sfgv-kpisub{font-size:12px;color:var(--sf-ink-50);margin-top:8px;min-height:16px}
.sfgv .sfgv-kpi .sfgv-kpisub strong{color:var(--sf-ink-60);font-weight:600}
.sfgv .sfgv-kpi .sfgv-bar{height:8px;border-radius:99px;background:var(--sf-cream-2);overflow:hidden;margin-top:14px}
.sfgv .sfgv-kpi .sfgv-bar>span{display:block;height:100%;border-radius:99px;background:var(--grad-blue);width:0;transition:width .8s var(--ease-out)}
.sfgv .sfgv-kpi.sfgv-gold .sfgv-bar>span{background:var(--grad-gold)}
/* no-target cards get a neutral baseline so all four cards are the same height */
.sfgv .sfgv-kpi .sfgv-baseline{height:8px;margin-top:14px;display:flex;align-items:center}
.sfgv .sfgv-kpi .sfgv-baseline::before{content:"";flex:1;border-top:1.5px dashed var(--sf-border-strong)}

/* ---- week-by-week table ---- */
.sfgv .sfgv-card{background:var(--sf-white);border:1px solid var(--sf-border);border-radius:16px;padding:22px;box-shadow:var(--shadow-sm)}
.sfgv .sfgv-legend{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin:-2px 0 8px;font-family:'Space Grotesk','Inter',sans-serif;font-size:11.5px;color:var(--sf-ink-60)}
.sfgv .sfgv-legend span{display:inline-flex;align-items:center;gap:6px}
.sfgv .sfgv-legend .dot{width:9px;height:9px;border-radius:3px}
.sfgv .sfgv-legend .dot.auto{background:var(--sf-blue-500)}
.sfgv .sfgv-legend .dot.edit{background:var(--sf-gold)}
.sfgv .sfgv-legend .pen{width:13px;height:13px;color:var(--sf-amber-deep)}
.sfgv .sfgv-legend .sv{width:9px;height:9px;border-radius:50%;background:var(--sf-green)}
.sfgv .sfgv-defn{font-family:'Space Grotesk','Inter',sans-serif;font-size:11.5px;color:var(--sf-ink-50);margin:0 0 16px;line-height:1.5}
.sfgv .sfgv-defn b{color:var(--sf-ink-60);font-weight:600}
.sfgv .sfgv-note{font-family:'Space Grotesk','Inter',sans-serif;font-size:12px;margin:-2px 0 14px;display:flex;align-items:center;gap:8px;padding:9px 12px;border-radius:9px;background:var(--sf-gold-soft);color:#8a5410;border:1px solid var(--sf-gold)}
.sfgv .sfgv-note.info{background:var(--sf-blue-50);color:var(--sf-blue-700);border-color:var(--sf-blue-100)}
.sfgv .sfgv-note svg{width:16px;height:16px;flex-shrink:0;stroke-width:2.1}
.sfgv .sfgv-terms-h .ico svg{width:18px;height:18px;stroke-width:2.1}
.sfgv .sfgv-twrap{overflow-x:auto;border-radius:10px;scrollbar-width:thin;background:linear-gradient(to right,transparent 80%,rgba(13,21,52,.05)) right center/22px 100% no-repeat}
.sfgv .sfgv-twrap::-webkit-scrollbar{height:8px}
.sfgv .sfgv-twrap::-webkit-scrollbar-thumb{background:var(--sf-border-strong);border-radius:4px}
.sfgv table.sfgv-wk{width:100%;min-width:760px;border-collapse:separate;border-spacing:0;font-size:13.5px;background:var(--sf-white)}
.sfgv table.sfgv-wk th,.sfgv table.sfgv-wk td{padding:11px 12px;text-align:center}
.sfgv table.sfgv-wk thead th{font-family:'Oswald',sans-serif;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--sf-ink-60);text-transform:uppercase;white-space:nowrap;background:var(--sf-blue-50);border-bottom:2px solid var(--sf-border-strong)}
.sfgv table.sfgv-wk thead th.sfgv-edh{color:#7d4a0f;background:var(--sf-gold-soft)}
.sfgv table.sfgv-wk thead th.sfgv-edh svg{width:11px;height:11px;vertical-align:-1px;margin-left:3px;stroke-width:2.4}
.sfgv table.sfgv-wk tbody td{border-bottom:1px solid var(--sf-border)}
.sfgv table.sfgv-wk td:first-child,.sfgv table.sfgv-wk th:first-child{text-align:left;white-space:nowrap}
.sfgv table.sfgv-wk tbody td:first-child{font-family:'Oswald',sans-serif;font-weight:600;letter-spacing:.02em;color:var(--sf-ink)}
.sfgv table.sfgv-wk td.sfgv-notes{text-align:left;min-width:210px;color:var(--sf-ink-60)}
.sfgv table.sfgv-wk tbody tr:nth-child(even) td{background:var(--sf-blue-50)}
.sfgv table.sfgv-wk tbody tr:nth-child(even) td.sfgv-ed{background:#fffbf0}
.sfgv table.sfgv-wk td.sfgv-ed{background:#fffdf7}
.sfgv table.sfgv-wk tbody tr:hover td{background:#eef4fb}
.sfgv table.sfgv-wk tbody tr:hover td.sfgv-ed{background:#fff6e6}
.sfgv table.sfgv-wk tfoot td{font-family:'Oswald',sans-serif;font-weight:700;color:var(--sf-ink);border-top:2px solid var(--sf-border-strong);background:var(--sf-cream)}
.sfgv .sfgv-strong{font-variant-numeric:tabular-nums;font-weight:700;color:var(--sf-blue-700)}
.sfgv .sfgv-met{font-variant-numeric:tabular-nums;font-weight:700;color:var(--sf-green)}
.sfgv .sfgv-muted{color:var(--sf-ink-40)}
.sfgv .sfgv-pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700;font-family:'Space Grotesk','Inter',sans-serif}
.sfgv .sfgv-pill.yes{background:rgba(45,163,117,.16);color:var(--sf-green)}
.sfgv .sfgv-pill.no{background:rgba(216,69,61,.13);color:var(--sf-red)}
.sfgv .sfgv-pill.none{background:var(--sf-cream-2);color:var(--sf-ink-40)}

/* editable inputs read as "fill me in" (soft gold) */
.sfgv .sfgv-cell{display:flex;align-items:center;gap:7px;justify-content:center}
.sfgv .sfgv-cell input[type=number]{width:64px;text-align:center;border:1.5px solid var(--sf-gold);border-radius:7px;padding:7px 4px;min-height:40px;font-size:14px;font-family:inherit;font-variant-numeric:tabular-nums;background:var(--sf-white);transition:box-shadow .15s,border-color .15s}
.sfgv .sfgv-cell select{-webkit-appearance:none;appearance:none;border:1.5px solid var(--sf-gold);border-radius:7px;padding:7px 28px 7px 11px;min-height:40px;font-size:13.5px;font-family:inherit;cursor:pointer;background:var(--sf-white) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23c97a16' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") no-repeat right 9px center}
.sfgv td.sfgv-notes textarea{width:100%;min-height:40px;border:1.5px solid var(--sf-gold);border-radius:7px;padding:9px 11px;font-size:13px;resize:none;line-height:1.45;overflow:hidden;font-family:inherit;background:var(--sf-white)}
.sfgv td.sfgv-notes textarea::placeholder{color:var(--sf-ink-40)}
.sfgv .sfgv-cell input:focus,.sfgv .sfgv-cell select:focus,.sfgv td.sfgv-notes textarea:focus{outline:none;border-color:var(--sf-amber-deep);box-shadow:0 0 0 3px rgba(243,168,71,.22)}
.sfgv .sfgv-cell input[disabled],.sfgv .sfgv-cell select[disabled],.sfgv td.sfgv-notes textarea[disabled]{border-color:var(--sf-border);background:var(--sf-cream);opacity:.85}
.sfgv .sfgv-pip{width:8px;height:8px;border-radius:50%;background:transparent;flex-shrink:0;transition:background .2s}
.sfgv .sfgv-pip.saving{background:var(--sf-amber)}
.sfgv .sfgv-pip.saved{background:var(--sf-green)}
.sfgv .sfgv-pip.error{background:var(--sf-red)}

/* hover-to-see-names affordance on the Registered / No-Show / Attended cells */
.sfgv .sfgv-hov{cursor:help}
.sfgv .sfgv-hov .sfgv-strong,.sfgv .sfgv-hov .sfgv-met{border-bottom:1.5px dashed currentColor;padding-bottom:1px;transition:opacity .15s}
.sfgv .sfgv-hov:hover .sfgv-strong,.sfgv .sfgv-hov:hover .sfgv-met{opacity:.78}

/* roster tooltip (appended to <body>, so its rule is intentionally unscoped) */
.sfgv-tip{position:fixed;z-index:9999;display:none;max-width:min(340px,calc(100vw - 16px));background:#fff;border:1px solid var(--sf-border,#e2e8f2);border-radius:12px;box-shadow:0 18px 50px -16px rgba(13,21,52,.42);padding:12px 14px;font-family:'Inter',system-ui,sans-serif;pointer-events:auto}
.sfgv-tip-h{display:flex;align-items:center;gap:8px;font-family:'Oswald','Inter',sans-serif;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sf-ink-60,#475067);margin-bottom:9px;padding-bottom:8px;border-bottom:1px solid var(--sf-border,#e2e8f2)}
.sfgv-tip-h b{margin-left:auto;font-family:'Oswald',sans-serif;font-size:14px;color:var(--sf-blue-700,#1b2f6e)}
.sfgv-tip-names{display:flex;flex-wrap:wrap;gap:5px;max-height:260px;overflow-y:auto;overscroll-behavior:contain;padding-right:2px}
.sfgv-tip-names::-webkit-scrollbar{width:7px}
.sfgv-tip-names::-webkit-scrollbar-thumb{background:var(--sf-border-strong,#c6d1e4);border-radius:4px}
.sfgv-tip-names span{font-size:11.5px;font-weight:500;color:var(--sf-ink,#0d1534);background:var(--sf-blue-50,#f4f8fd);border:1px solid var(--sf-border,#e2e8f2);border-radius:6px;padding:3px 8px;white-space:nowrap}
.sfgv-tip-empty{font-size:12px;color:var(--sf-ink-50,#6b7490)}

/* ---- school breakdown ---- */
.sfgv .sfgv-schools{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}
.sfgv .sfgv-schools li{position:relative;display:flex;align-items:center;gap:12px;padding:13px 16px;background:var(--sf-cream);border:1px solid var(--sf-border);border-radius:10px;overflow:hidden}
.sfgv .sfgv-schools li .sfgv-fill{position:absolute;inset:0;background:linear-gradient(90deg,var(--sf-blue-100),rgba(74,163,224,.22));border-radius:10px;z-index:0;width:0;transition:width .8s var(--ease-out)}
.sfgv .sfgv-schools li>*{position:relative;z-index:1}
.sfgv .sfgv-schools li .sfgv-rank{font-family:'Oswald',sans-serif;font-size:12px;font-weight:700;color:var(--sf-ink-40);width:20px;text-align:center;flex-shrink:0}
.sfgv .sfgv-schools li .sfgv-name{font-weight:600;color:var(--sf-ink)}
.sfgv .sfgv-schools li .sfgv-pct{margin-left:auto;font-family:'Space Grotesk','Inter',sans-serif;font-size:11.5px;font-weight:600;color:var(--sf-ink-50)}
.sfgv .sfgv-schools li .sfgv-val{font-family:'Oswald',sans-serif;font-weight:700;font-size:18px;color:var(--sf-blue-700);font-variant-numeric:tabular-nums;min-width:30px;text-align:right}
.sfgv .sfgv-stotal{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:14px;border-top:2px solid var(--sf-border-strong);font-family:'Oswald',sans-serif;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:13px}
.sfgv .sfgv-stotal span:last-child{font-size:20px;color:var(--sf-blue-700);font-variant-numeric:tabular-nums}

.sfgv .sfgv-empty{background:var(--sf-white);border:1px solid var(--sf-border);border-radius:16px;padding:44px;text-align:center;color:var(--sf-ink-50);font-family:'Space Grotesk','Inter',sans-serif}

/* ---- staggered reveal ---- */
.sfgv .sfgv-rise{opacity:0;transform:translateY(12px);animation:sfgvRise .55s var(--ease-out) forwards}
@keyframes sfgvRise{to{opacity:1;transform:none}}

/* ---- mobile: table -> stacked cards ---- */
@media (max-width:640px){
  .sfgv .sfgv-kpis{grid-template-columns:1fr}
  .sfgv .sfgv-head{flex-wrap:wrap}
  .sfgv .sfgv-edit-btn{margin-left:0;width:100%;justify-content:center}
  .sfgv table.sfgv-wk thead{display:none}
  .sfgv table.sfgv-wk{min-width:0}
  .sfgv table.sfgv-wk,.sfgv table.sfgv-wk tbody,.sfgv table.sfgv-wk tr,.sfgv table.sfgv-wk td{display:block;width:100%}
  .sfgv table.sfgv-wk tbody tr{border:1px solid var(--sf-border);border-radius:14px;margin-bottom:14px;padding:4px 6px 8px;background:var(--sf-white);box-shadow:var(--shadow-sm)}
  .sfgv table.sfgv-wk tbody tr:nth-child(even) td,.sfgv table.sfgv-wk tbody tr:hover td{background:transparent}
  .sfgv table.sfgv-wk tbody tr td:first-child{font-size:15px;padding:12px 14px 8px;border-bottom:2px solid var(--sf-border)}
  .sfgv table.sfgv-wk td{text-align:left !important;border-bottom:1px solid var(--sf-border);display:flex;justify-content:space-between;align-items:center;gap:14px;padding:10px 14px}
  .sfgv table.sfgv-wk tbody tr:nth-child(even) td.sfgv-ed,.sfgv table.sfgv-wk td.sfgv-ed{background:#fffbf0}
  .sfgv table.sfgv-wk td:last-child{border-bottom:0}
  .sfgv table.sfgv-wk td::before{content:attr(data-label);font-family:'Oswald',sans-serif;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sf-ink-50);flex-shrink:0}
  .sfgv table.sfgv-wk td.sfgv-notes{flex-direction:column;align-items:stretch;gap:6px}
  /* keep the Totals row on mobile, styled as a distinct summary card */
  .sfgv table.sfgv-wk tfoot{display:block}
  .sfgv table.sfgv-wk tfoot tr{display:block;border:1.5px solid var(--sf-border-strong);border-radius:14px;margin-top:4px;background:var(--sf-cream);padding:4px 6px 8px}
  .sfgv table.sfgv-wk tfoot td{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:10px 14px;border-bottom:1px solid var(--sf-border);text-align:left;background:transparent}
  .sfgv table.sfgv-wk tfoot td:first-child{font-size:14px;padding:12px 14px 8px;border-bottom:2px solid var(--sf-border-strong)}
  .sfgv table.sfgv-wk tfoot td:last-child{border-bottom:0}
  .sfgv table.sfgv-wk tfoot td:empty{display:none}
  .sfgv table.sfgv-wk tfoot td::before{content:attr(data-label);font-family:'Oswald',sans-serif;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--sf-ink-50);flex-shrink:0}
  .sfgv .sfgv-cell{justify-content:flex-end}
}

/* respect reduced-motion */
@media (prefers-reduced-motion:reduce){
  .sfgv .sfgv-rise{animation:none;opacity:1;transform:none}
  .sfgv .sfgv-bar>span,.sfgv .sfgv-fill,.sfgv .sfgv-kpi,.sfgv .sfgv-terms-wrap,.sfgv .sfgv-edit-btn,.sfgv .sfgv-caret{transition:none}
}
/* keyboard focus ring on the hover/roster cells + forced-colors fallback */
.sfgv .sfgv-hov:focus-visible{outline:2px solid var(--sf-blue-500);outline-offset:2px;border-radius:4px}
@media (forced-colors:active){
  .sfgv .sfgv-cell input,.sfgv .sfgv-cell select,.sfgv td.sfgv-notes textarea,.sfgv .sfgv-field input{border:1px solid CanvasText}
  .sfgv .sfgv-cell input:focus,.sfgv .sfgv-cell select:focus,.sfgv td.sfgv-notes textarea:focus,.sfgv .sfgv-field input:focus,.sfgv .sfgv-hov:focus-visible{outline:2px solid Highlight;outline-offset:1px}
}
`;

  const IC = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    caret: '<svg class="sfgv-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
  };

  function injectCSS() {
    if (document.getElementById('sfgv-css')) return;
    const s = document.createElement('style');
    s.id = 'sfgv-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const DEFAULT_CONFIG = { total_weeks:350, total_students:35, waitlist_total:0, waitlist_moved:0, withdrawn_weeks:0, withdrawn_students:0 };
  const SEP = String.fromCharCode(31);   // unit-separator (US): a name can never contain it, unlike '|'
  const esc = (s) => (s==null?'':String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v, d=0) => { const n = parseInt(v,10); return Number.isFinite(n) ? n : d; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function skeleton(canEdit) {
    const editBtn = canEdit
      ? `<button type="button" class="sfgv-edit-btn" data-act="toggle-terms" aria-expanded="false">${IC.pencil}<span data-el="editlabel">Edit grant terms</span>${IC.caret}</button>`
      : '';
    return `
    <div class="sfgv-section">
      <div class="sfgv-head">
        <span class="sfgv-accent"></span>
        <div class="sfgv-head-txt"><h2>Summary vs Grant Terms</h2><span class="sfgv-sub">Progress against the Related Ross Foundation grant</span></div>
        ${editBtn}
      </div>
      <div class="sfgv-terms-wrap" data-el="termswrap"><div class="sfgv-terms-inner"><div class="sfgv-terms" data-el="terms"></div></div></div>
      <section class="sfgv-kpis" data-el="sum"></section>
    </div>

    <div class="sfgv-section">
      <div class="sfgv-head">
        <span class="sfgv-accent"></span>
        <div class="sfgv-head-txt"><h2>Week by Week</h2><span class="sfgv-sub">Weeks 1&ndash;10 of the summer program</span></div>
      </div>
      <div class="sfgv-card">
        <div class="sfgv-legend">
          <span><span class="dot auto"></span> Auto from attendance</span>
          <span><svg class="pen" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> ${canEdit ? 'Your team fills in' : 'Logged by the Floyd team'}</span>
          ${canEdit ? '<span><span class="sv"></span> Saves automatically</span>' : ''}
        </div>
        <p class="sfgv-defn"><b>Met Req.</b> counts students present at least one day that week. The gold columns (<b>Did Not Meet</b>, <b>Excused</b>, <b>Family Comm</b>, <b>Action Notes</b>) are ${canEdit ? 'entered by your team' : 'logged by the Floyd team'}.</p>
        ${canEdit ? '' : `<div class="sfgv-note info">${IC.info} Read-only view. Sign in with edit access to update the gold columns.</div>`}
        <div class="sfgv-note" data-el="attnote" hidden>${IC.info} Live attendance is not loaded yet: showing registration and logged notes only.</div>
        <div class="sfgv-twrap"><table class="sfgv-wk">
          <thead><tr>
            <th>Week</th><th>Registered</th><th>No-Show</th><th>Attended</th><th>Met Req.</th>
            <th class="sfgv-edh">Did Not Meet${IC.pencil}</th><th class="sfgv-edh">Excused${IC.pencil}</th><th class="sfgv-edh">Family Comm${IC.pencil}</th><th class="sfgv-edh">Action Notes${IC.pencil}</th>
          </tr></thead>
          <tbody data-el="weeks"></tbody>
          <tfoot data-el="totals"></tfoot>
        </table></div>
        <div class="sfgv-srlive" data-el="srlive" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap"></div>
      </div>
    </div>

    <div class="sfgv-section">
      <div class="sfgv-head">
        <span class="sfgv-accent"></span>
        <div class="sfgv-head-txt"><h2>Unique Students by School</h2><span class="sfgv-sub">Distinct students across all weeks</span></div>
      </div>
      <div class="sfgv-card">
        <ul class="sfgv-schools" data-el="schools"></ul>
        <div class="sfgv-stotal"><span>Total unique students</span><span data-el="stotal">–</span></div>
      </div>
    </div>`;
  }

  function mount(opts) {
    injectCSS();
    const root = opts.container;
    const supaUrl = opts.supabaseUrl;
    const anon = opts.anonKey;
    const tokenFn = typeof opts.token === 'function' ? opts.token : () => (opts.token || anon);
    const getSnapshot = opts.getSnapshot || (() => null);
    const canEdit = !!opts.canEdit;

    if (!window.SFGrant) { root.innerHTML = '<div class="sfgv-empty">Grant compute module not loaded.</div>'; return { refresh(){} }; }

    root.classList.add('sfgv');
    root.innerHTML = skeleton(canEdit);
    const el = (n) => root.querySelector('[data-el="' + n + '"]');
    const state = { att: {}, attOk: true, grant: { config: { ...DEFAULT_CONFIG }, weeks: [] } };
    const prevWeek = {};

    function headers() { return { 'apikey': anon, 'Authorization': 'Bearer ' + tokenFn(), 'Content-Type': 'application/json' }; }
    async function rpc(fn, body) {
      const r = await fetch(supaUrl + '/rest/v1/rpc/' + fn, { method:'POST', headers: headers(), body: JSON.stringify(body || {}) });
      if (!r.ok) { let m = 'HTTP ' + r.status; try { const j = await r.json(); if (j && j.message) m = j.message; } catch(_){} throw new Error(m); }
      return r.json();
    }
    // Paginated read: PostgREST caps one response at 1000 rows, so loading every
    // week's per-person attendance in a single call silently truncates once the
    // table passes 1000 rows -> the grant no-show/attended numbers under-count.
    // Page with limit/offset + a stable order so we always get every row.
    async function rpcAll(fn, body, order) {
      const PAGE = 1000; let all = [], offset = 0;
      for (;;) {
        const q = '?limit=' + PAGE + '&offset=' + offset + (order ? '&order=' + order : '');
        const r = await fetch(supaUrl + '/rest/v1/rpc/' + fn + q, { method:'POST', headers: headers(), body: JSON.stringify(body || {}) });
        if (!r.ok) { let m = 'HTTP ' + r.status; try { const j = await r.json(); if (j && j.message) m = j.message; } catch(_){} throw new Error(m); }
        const rows = await r.json();
        if (!Array.isArray(rows)) return rows;
        all = all.concat(rows);
        if (rows.length < PAGE) break;
        offset += PAGE;
        if (offset > 500000) throw new Error('grant attendance pagination exceeded safety limit; data may be incomplete');
      }
      return all;
    }

    async function loadAttendance() {
      try {
        const rows = await rpcAll('sf_get_daily_attendance_people', { p_week_label: null }, 'week_label,day_of_week,person_key');
        const map = {};
        rows.forEach(x => {
          (map[x.week_label] = map[x.week_label] || {});
          (map[x.week_label][x.day_of_week] = map[x.week_label][x.day_of_week] || {});
          map[x.week_label][x.day_of_week][x.person_key] = { status: x.status };
        });
        state.att = map; state.attOk = true;
      } catch (e) { state.att = {}; state.attOk = false; }
    }
    async function loadGrant() {
      try {
        const data = await rpc('sf_grant_get', {});
        state.grant = { config: { ...DEFAULT_CONFIG, ...(data.config || {}) }, weeks: Array.isArray(data.weeks) ? data.weeks : [] };
      } catch (e) { /* keep defaults */ }
    }

    const weekByNum = (n) => state.grant.weeks.find(w => w.week_number === n) || { week_number:n, did_not_meet:0, excused_absences:0, family_comm:'', action_notes:'' };
    const disAttr = canEdit ? '' : ' disabled title="Sign in with free-camp edit access to edit"';

    function kpiCard(opts) {
      const { title, value, target, sub, gold, icon, idx } = opts;
      const pct = target ? Math.round(value / target * 100) : 0;
      // target cards: percent chip + progress bar. no-target cards: a "Reference"
      // chip + a neutral baseline, so all four cards stay the same height.
      const chip = target ? `<span class="sfgv-chip ${pct >= 100 ? 'ok' : 'mid'}">${pct}%</span>` : `<span class="sfgv-chip ref">Reference</span>`;
      const t = target ? ` <span class="sfgv-target">of ${target}</span>` : '';
      const bottom = target ? `<div class="sfgv-bar"><span data-pct="${Math.min(100, pct)}"></span></div>` : `<div class="sfgv-baseline" title="Tracked, no grant cap"></div>`;
      return `<div class="sfgv-kpi${gold ? ' sfgv-gold' : ''} sfgv-rise" style="animation-delay:${idx * 70}ms">
        <div class="sfgv-kpi-top"><span class="ico">${icon}</span>${chip}</div>
        <h3>${esc(title)}</h3>
        <div class="sfgv-num">${value}${t}</div>
        <div class="sfgv-kpisub">${sub}</div>${bottom}</div>`;
    }
    function renderSummary() {
      const s = window.SFGrant.summaryRollup(getSnapshot(), state.grant.config);
      const c = state.grant.config;
      el('sum').innerHTML = [
        kpiCard({ title:'Total Weeks Registered', value:s.totalWeeks, target:c.total_weeks, icon:IC.cal, idx:0,
          sub:`<strong>${s.runningWeeks}</strong> active + <strong>${c.withdrawn_weeks||0}</strong> withdrawn` }),
        kpiCard({ title:'Running Total Weeks', value:s.runningWeeks, target:0, icon:IC.repeat, idx:1,
          sub:'currently-registered student-weeks' }),
        kpiCard({ title:'Unique Students', value:s.totalUniqueStudents, target:c.total_students, gold:true, icon:IC.users, idx:2,
          sub:`<strong>${s.uniqueStudents}</strong> active + <strong>${c.withdrawn_students||0}</strong> withdrawn` }),
        kpiCard({ title:'Waitlist', value:s.waitlistTotal, target:0, gold:true, icon:IC.clock, idx:3,
          sub:`<strong>${s.waitlistMoved}</strong> moved off waitlist` }),
      ].join('');
      // animate bars after paint
      requestAnimationFrame(() => root.querySelectorAll('.sfgv-bar > span').forEach(b => { b.style.width = (b.dataset.pct || 0) + '%'; }));
    }

    const fieldLabel = { did_not_meet: 'did not meet', excused_absences: 'excused absences' };
    function editNum(wk, field, val) {
      if (!canEdit) return `<span class="sfgv-strong">${num(val)}</span>`;
      return `<div class="sfgv-cell"><input type="number" inputmode="numeric" min="0" value="${num(val)}" data-wk="${wk}" data-f="${field}" aria-label="${fieldLabel[field] || field} week ${wk}"${disAttr}><span class="sfgv-pip" data-pip="${wk}" aria-hidden="true"></span></div>`;
    }
    function editFam(wk, val) {
      if (!canEdit) return val === 'Yes' ? '<span class="sfgv-pill yes">Yes</span>' : val === 'No' ? '<span class="sfgv-pill no">No</span>' : '<span class="sfgv-pill none">&ndash;</span>';
      const opt = (v, l) => `<option value="${v}"${val === v ? ' selected' : ''}>${l}</option>`;
      return `<div class="sfgv-cell"><select data-wk="${wk}" data-f="family_comm" aria-label="family communication week ${wk}"${disAttr}>${opt('', '—')}${opt('Yes','Yes')}${opt('No','No')}</select><span class="sfgv-pip" data-pip="${wk}"></span></div>`;
    }
    function editNotes(wk, val) {
      if (!canEdit) return esc(val) || '<span class="sfgv-muted">&ndash;</span>';
      return `<textarea rows="1" data-wk="${wk}" data-f="action_notes" placeholder="Log any action taken…"${disAttr}>${esc(val)}</textarea>`;
    }
    function autoGrow(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
    function autoGrowAll() { root.querySelectorAll('td.sfgv-notes textarea').forEach(autoGrow); }

    function renderWeeks() {
      const rolls = window.SFGrant.weekRollups(getSnapshot(), state.att);
      el('attnote').hidden = state.attOk;
      const anyAtt = rolls.some(r => r.hasAtt);
      // Per-row: a week with no attendance yet shows a dash, not a fake 0/no-show.
      const cR = (has, v) => has ? `<span class="sfgv-strong">${v}</span>` : '<span class="sfgv-muted">&ndash;</span>';
      const mR = (has, v) => has ? `<span class="sfgv-met">${v}</span>` : '<span class="sfgv-muted">&ndash;</span>';
      // hoverable count cell: reveals the student names in that bucket
      const hov = (dataLabel, tipLabel, wk, inner, names, enabled) => {
        const a = (enabled && names && names.length)
          ? ` class="sfgv-hov" tabindex="0" aria-label="${esc(tipLabel)} week ${wk}: ${names.length} students, press Enter for names" data-tip="${esc(tipLabel)} · Week ${wk}" data-names="${esc(names.join(SEP))}"` : '';
        return `<td data-label="${dataLabel}"${a}>${inner}</td>`;
      };
      el('weeks').innerHTML = rolls.map(r => {
        const m = weekByNum(r.weekNumber);
        return `<tr data-wk="${r.weekNumber}">
          <td data-label="Week">Week ${r.weekNumber}</td>
          ${hov('Registered', 'Registered', r.weekNumber, `<span class="sfgv-strong">${r.registered}</span>`, r.registeredNames, true)}
          ${hov('No-Show', 'No-show', r.weekNumber, cR(r.hasAtt, r.noShow), r.noShowNames, r.hasAtt)}
          ${hov('Attended', 'Attended', r.weekNumber, cR(r.hasAtt, r.attended), r.attendedNames, r.hasAtt)}
          <td data-label="Met Req.">${mR(r.hasAtt, r.metReq)}</td>
          <td class="sfgv-ed" data-label="Did Not Meet">${editNum(r.weekNumber,'did_not_meet',m.did_not_meet)}</td>
          <td class="sfgv-ed" data-label="Excused">${editNum(r.weekNumber,'excused_absences',m.excused_absences)}</td>
          <td class="sfgv-ed" data-label="Family Comm">${editFam(r.weekNumber,m.family_comm)}</td>
          <td class="sfgv-ed sfgv-notes" data-label="Action Notes">${editNotes(r.weekNumber,m.action_notes)}</td>
        </tr>`;
      }).join('');
      const sumKey = (k) => rolls.reduce((a, r) => a + (r[k] || 0), 0);
      const sumWk = (k) => rolls.reduce((a, r) => a + num(weekByNum(r.weekNumber)[k]), 0);
      const tc = (v) => anyAtt ? `<span class="sfgv-strong">${v}</span>` : '<span class="sfgv-muted">&ndash;</span>';
      const tm = (v) => anyAtt ? `<span class="sfgv-met">${v}</span>` : '<span class="sfgv-muted">&ndash;</span>';
      el('totals').innerHTML = `<tr>
        <td data-label="">Totals</td>
        <td data-label="Registered"><span class="sfgv-strong">${sumKey('registered')}</span></td>
        <td data-label="No-Show">${tc(sumKey('noShow'))}</td>
        <td data-label="Attended">${tc(sumKey('attended'))}</td>
        <td data-label="Met Req.">${tm(sumKey('metReq'))}</td>
        <td class="sfgv-ed" data-label="Did Not Meet"><span class="sfgv-strong">${sumWk('did_not_meet')}</span></td>
        <td class="sfgv-ed" data-label="Excused"><span class="sfgv-strong">${sumWk('excused_absences')}</span></td>
        <td class="sfgv-ed"></td><td class="sfgv-ed"></td></tr>`;
      autoGrowAll();
    }

    function renderSchools() {
      const sb = window.SFGrant.schoolBreakdown(getSnapshot());
      const total = sb.reduce((a, r) => a + r.count, 0) || 1;
      const max = sb.reduce((m, r) => Math.max(m, r.count), 0) || 1;
      el('schools').innerHTML = sb.map((r, i) => `<li class="sfgv-rise" style="animation-delay:${i * 55}ms">
        <span class="sfgv-fill" data-w="${Math.round(r.count / max * 100)}"></span>
        <span class="sfgv-rank">${i + 1}</span>
        <span class="sfgv-name">${esc(r.school)}</span>
        <span class="sfgv-pct">${Math.round(r.count / total * 100)}%</span>
        <span class="sfgv-val">${r.count}</span></li>`).join('');
      el('stotal').textContent = total;
      requestAnimationFrame(() => root.querySelectorAll('.sfgv-fill').forEach(f => { f.style.width = (f.dataset.w || 0) + '%'; }));
    }

    // ---- editing ----
    function announce(msg) { const n = el('srlive'); if (n) { n.textContent = ''; setTimeout(() => { n.textContent = msg; }, 30); } }
    function setPip(wk, cls) { root.querySelectorAll('.sfgv-pip[data-pip="' + wk + '"]').forEach(p => { p.className = 'sfgv-pip' + (cls ? ' ' + cls : ''); }); }
    function readWeekRow(wk) {
      const sel = (f) => root.querySelector('[data-wk="' + wk + '"][data-f="' + f + '"]');
      return { p_week_number: wk, p_did_not_meet: num((sel('did_not_meet')||{}).value), p_excused: num((sel('excused_absences')||{}).value),
        p_family_comm: (sel('family_comm')||{}).value || '', p_action_notes: (sel('action_notes')||{}).value || '' };
    }
    async function saveWeek(wk) {
      if (!canEdit) return;
      setPip(wk, 'saving');
      try {
        const rows = await rpc('sf_grant_save_week', readWeekRow(wk));
        const row = Array.isArray(rows) ? rows[0] : rows;
        const i = state.grant.weeks.findIndex(w => w.week_number === wk);
        if (i >= 0) state.grant.weeks[i] = row; else state.grant.weeks.push(row);
        prevWeek[wk] = { did_not_meet: row.did_not_meet, excused_absences: row.excused_absences, family_comm: row.family_comm, action_notes: row.action_notes };
        setPip(wk, 'saved'); announce('Week ' + wk + ' saved'); setTimeout(() => setPip(wk, ''), 1600);
      } catch (e) {
        setPip(wk, 'error'); announce('Week ' + wk + ' failed to save: ' + (e && e.message || 'error'));
        root.querySelectorAll('.sfgv-pip[data-pip="' + wk + '"]').forEach(p => p.setAttribute('title', (e && e.message) || 'Save failed'));
        const p = prevWeek[wk];
        if (p) { const set = (f, v) => { const x = root.querySelector('[data-wk="' + wk + '"][data-f="' + f + '"]'); if (x) x.value = v; };
          set('did_not_meet', p.did_not_meet); set('excused_absences', p.excused_absences); set('family_comm', p.family_comm); set('action_notes', p.action_notes); autoGrowAll(); }
      }
    }
    const saveWeekDeb = {};
    // Delegated on root so it survives any re-render of the table body. Only
    // week cells carry data-wk; terms inputs (data-t) are ignored here.
    function wireEditing() {
      root.addEventListener('change', (e) => { const x = e.target; if (x.dataset && x.dataset.wk && x.tagName !== 'TEXTAREA') saveWeek(+x.dataset.wk); });
      root.addEventListener('input', (e) => { const x = e.target; if (!x.dataset || !x.dataset.wk) return;
        if (x.tagName === 'TEXTAREA') { autoGrow(x); const wk = +x.dataset.wk; (saveWeekDeb[wk] = saveWeekDeb[wk] || debounce(() => saveWeek(wk), 600))(); } });
    }

    function field(id, label, hint, v) {
      return `<div class="sfgv-field"><label for="sfgv-t-${id}">${label}</label>
        <input type="number" min="0" id="sfgv-t-${id}" data-t="${id}" value="${num(v)}"${disAttr}>
        <span class="hint">${hint}</span></div>`;
    }
    function renderTerms() {
      const c = state.grant.config;
      el('terms').innerHTML = `
        <div class="sfgv-terms-h">
          <span class="ico">${IC.sliders}</span>
          <div><h3>Adjust grant terms</h3><p>These targets and reconciliation figures drive the Summary cards above. Update them as the grant agreement or roster changes.</p></div>
        </div>
        <div class="sfgv-terms-grp">
          <div class="lbl">Grant targets</div>
          <div class="sfgv-terms-fields">
            ${field('total_weeks','Total weeks (target)','The grant&rsquo;s agreed total student-weeks.',c.total_weeks)}
            ${field('total_students','Total students (target)','The grant&rsquo;s agreed unique-student count.',c.total_students)}
          </div>
        </div>
        <div class="sfgv-terms-grp">
          <div class="lbl">Reconciliation</div>
          <div class="sfgv-terms-fields">
            ${field('waitlist_total','Waitlist total','Families currently on the waitlist.',c.waitlist_total)}
            ${field('waitlist_moved','Moved off waitlist','Waitlisted families since enrolled.',c.waitlist_moved)}
            ${field('withdrawn_weeks','Withdrawn weeks','Student-weeks from kids who later withdrew (added to Total).',c.withdrawn_weeks)}
            ${field('withdrawn_students','Withdrawn students','Unique students who withdrew (added to Total).',c.withdrawn_students)}
          </div>
        </div>
        ${canEdit ? `<div class="sfgv-terms-foot">
          <button type="button" class="sfgv-save" data-act="save-terms">Save changes</button>
          <button type="button" class="sfgv-cancel" data-act="cancel-terms">Cancel</button>
        </div>` : ''}`;
    }
    function toggleTerms(open) {
      const wrap = el('termswrap'); const btn = root.querySelector('[data-act="toggle-terms"]'); const lbl = el('editlabel');
      const isOpen = open == null ? !wrap.classList.contains('open') : open;
      wrap.classList.toggle('open', isOpen);
      if (btn) { btn.classList.toggle('open', isOpen); btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false'); }
      if (lbl) lbl.textContent = isOpen ? 'Close' : 'Edit grant terms';
      if (isOpen) { const first = root.querySelector('[data-t]'); if (first) setTimeout(() => first.focus(), 200); }
    }
    async function saveConfig() {
      if (!canEdit) return;
      const btn = root.querySelector('[data-act="save-terms"]'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      const g = (id) => num((root.querySelector('[data-t="' + id + '"]')||{}).value);
      try {
        const rows = await rpc('sf_grant_save_config', { p_total_weeks:g('total_weeks'), p_total_students:g('total_students'),
          p_waitlist_total:g('waitlist_total'), p_waitlist_moved:g('waitlist_moved'), p_withdrawn_weeks:g('withdrawn_weeks'), p_withdrawn_students:g('withdrawn_students') });
        const row = Array.isArray(rows) ? rows[0] : rows;
        state.grant.config = { ...DEFAULT_CONFIG, ...row };
        renderSummary();
        if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save changes'; btn.disabled = false; toggleTerms(false); }, 900); }
      } catch (e) { if (btn) { btn.textContent = 'Error, retry'; setTimeout(() => { btn.textContent = 'Save changes'; btn.disabled = false; }, 1800); } }
    }

    root.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest('[data-act]'); if (!t) return;
      const act = t.getAttribute('data-act');
      if (act === 'toggle-terms') toggleTerms();
      else if (act === 'save-terms') saveConfig();
      else if (act === 'cancel-terms') { renderTerms(); toggleTerms(false); }
    });

    // ---- roster tooltip: hover/focus/tap a count cell to see who's in that bucket.
    //   The tooltip is itself hoverable and a short grace delay keeps it open while
    //   you move your cursor from the number onto it, so reading (and scrolling) a
    //   long list is comfortable instead of the popup vanishing the moment you move. ----
    let tipEl = null, hideTimer = null;
    function ensureTip() {
      if (tipEl) return tipEl;
      tipEl = document.getElementById('sfgv-tip');
      if (!tipEl) { tipEl = document.createElement('div'); tipEl.id = 'sfgv-tip'; tipEl.className = 'sfgv-tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
      tipEl.addEventListener('mouseenter', cancelHide);   // moving onto the popup keeps it open
      tipEl.addEventListener('mouseleave', scheduleHide); // leaving the popup closes it (after grace)
      return tipEl;
    }
    function cancelHide() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }
    let tipCell = null;
    function hideNow() { cancelHide(); if (tipEl) tipEl.style.display = 'none'; if (tipCell) { tipCell.removeAttribute('aria-describedby'); tipCell = null; } }
    function scheduleHide() { cancelHide(); hideTimer = setTimeout(hideNow, 260); }
    function showTip(cell) {
      cancelHide();
      const names = (cell.getAttribute('data-names') || '').split(SEP).filter(Boolean);
      const label = cell.getAttribute('data-tip') || '';
      const t = ensureTip();
      t.innerHTML = `<div class="sfgv-tip-h">${esc(label)} <b>${names.length}</b></div>` +
        (names.length ? `<div class="sfgv-tip-names">${names.map(n => `<span>${esc(n)}</span>`).join('')}</div>` : `<div class="sfgv-tip-empty">No students</div>`);
      t.style.display = 'block';
      if (tipCell && tipCell !== cell) tipCell.removeAttribute('aria-describedby');
      tipCell = cell; cell.setAttribute('aria-describedby', 'sfgv-tip');
      const r = cell.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left + r.width / 2 - tr.width / 2, window.innerWidth - tr.width - 8));
      // Overlap the cell by a few px (no gap) so the cursor can travel straight
      // from the number onto the popup. A gap would sit over the row above and
      // make that row's number steal the tooltip, so it would "run away" upward.
      let top = r.top - tr.height + 4;
      if (top < 8) top = r.bottom - 4;
      // never let a tall list run off the bottom of the viewport (its own
      // overflow-y:auto then scrolls the names)
      top = Math.max(8, Math.min(top, window.innerHeight - tr.height - 8));
      t.style.left = Math.round(left) + 'px';
      t.style.top = Math.round(top) + 'px';
    }
    const coarsePointer = window.matchMedia && window.matchMedia('(hover: none)').matches;
    root.addEventListener('mouseover', (e) => { const c = e.target.closest && e.target.closest('.sfgv-hov'); if (c) showTip(c); });
    root.addEventListener('mouseout', (e) => { const c = e.target.closest && e.target.closest('.sfgv-hov'); if (c && !c.contains(e.relatedTarget)) scheduleHide(); });
    root.addEventListener('focusin', (e) => { const c = e.target.closest && e.target.closest('.sfgv-hov'); if (c) showTip(c); });
    root.addEventListener('focusout', (e) => { const c = e.target.closest && e.target.closest('.sfgv-hov'); if (c) scheduleHide(); });
    // tap toggles on touch only; on desktop, hover already shows it (a click here
    // would otherwise immediately hide the just-shown popup).
    root.addEventListener('click', (e) => { if (!coarsePointer) return; const c = e.target.closest && e.target.closest('.sfgv-hov'); if (!c) return;
      (tipEl && tipEl.style.display === 'block') ? hideNow() : showTip(c); });
    // keyboard: Enter/Space toggles, Escape closes
    root.addEventListener('keydown', (e) => { const c = e.target.closest && e.target.closest('.sfgv-hov'); if (!c) { if (e.key === 'Escape') hideNow(); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (tipEl && tipEl.style.display === 'block') ? hideNow() : showTip(c); }
      else if (e.key === 'Escape') { hideNow(); c.focus(); } });
    // hide on page scroll, but not when scrolling inside the (now scrollable) tooltip
    window.addEventListener('scroll', (e) => { if (tipEl && tipEl.contains(e.target)) return; hideNow(); }, true);
    document.addEventListener('mousedown', (e) => { if (tipEl && !tipEl.contains(e.target) && !(e.target.closest && e.target.closest('.sfgv-hov'))) hideNow(); });

    function renderAll() {
      const snap = getSnapshot();
      if (!snap) { root.innerHTML = '<div class="sfgv-empty">Loading camp data…</div>'; return; }
      if (!el('sum')) root.innerHTML = skeleton(canEdit);
      // Don't clobber an in-progress edit: if the user is typing in a table/terms
      // field when a background refresh fires, leave those sections untouched.
      const ae = document.activeElement;
      const editing = ae && root.contains(ae) && ae.matches && ae.matches('[data-wk],[data-t]');
      renderSummary(); renderSchools();
      if (!editing) { renderTerms(); renderWeeks();
        state.grant.weeks.forEach(w => { prevWeek[w.week_number] = { did_not_meet:w.did_not_meet, excused_absences:w.excused_absences, family_comm:w.family_comm, action_notes:w.action_notes }; });
      }
    }

    if (canEdit) wireEditing();   // delegated on root, bind once
    async function refresh() {
      renderAll();
      await Promise.all([loadAttendance(), loadGrant()]);
      renderAll();
    }

    refresh();
    return { refresh };
  }

  window.SFGrantView = { mount };
})();
