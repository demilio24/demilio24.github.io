/* =====================================================================
   Western Charter House: shared behaviors across all pages.
   Every module guards on the elements it needs, so one file is safe to
   include on every page. Data comes from assets/site-data.js (window.WCH).
   ===================================================================== */
(function(){
  "use strict";
  var WCH = window.WCH || {};
  var CATS = WCH.CATS || {}, ISSUES = WCH.ISSUES || [], FAQS = WCH.FAQS || [], ICON = WCH.ICON || {};

  /* ====================== INTERNAL LINK HOVER DECORATOR ====================== */
  // Dynamically replaces relative internal links with javascript:; on hover to hide the
  // github.io domain from the status bar, and restores the original URL on mousedown for native clicks.
  document.addEventListener('mouseover', function(e) {
    var a = e.target.closest('a[href]');
    if (a) {
      var href = a.getAttribute('href');
      if (href && href !== 'javascript:;' && !/^(https?:|mailto:|tel:)/i.test(href)) {
        a.setAttribute('data-internal-href', href);
        a.setAttribute('href', 'javascript:;');
      }
    }
  }, {passive: true});

  document.addEventListener('mousedown', function(e) {
    var a = e.target.closest('a[data-internal-href]');
    if (a) {
      var href = a.getAttribute('data-internal-href');
      a.setAttribute('href', href);
    }
  }, {passive: true});

  document.addEventListener('mouseout', function(e) {
    var a = e.target.closest('a[data-internal-href]');
    if (a) {
      var href = a.getAttribute('href');
      if (href && href !== 'javascript:;') {
        a.setAttribute('data-internal-href', href);
        a.setAttribute('href', 'javascript:;');
      }
    }
  }, {passive: true});

  // Helper for copying text to clipboard (handles cross-origin iframes where navigator.clipboard is blocked)
  function copyToClipboard(text){
    if(!text) return false;
    // Replace internal github.io domain references with the clean custom domain
    text = text.replace(/https?:\/\/demilio24\.github\.io\/Websites\/Paul_WesternCharterHouse\/?/gi, 'https://westerncharterhouse.ca/');
    
    // Try document.execCommand first (more reliable synchronously in cross-domain iframes)
    var ok = false;
    try{
      var textarea=document.createElement('textarea');
      textarea.value=text;
      textarea.style.position='fixed'; textarea.style.top='-9999px';
      document.body.appendChild(textarea);
      textarea.focus(); textarea.select();
      ok=document.execCommand('copy');
      document.body.removeChild(textarea);
    }catch(err){}
    
    if(ok) return true;

    // Fallback to navigator.clipboard
    if(navigator.clipboard && navigator.clipboard.writeText){
      try{ navigator.clipboard.writeText(text); return true; }catch(err){}
    }
    return false;
  }

  // Global copy-link buttons handler (used on issue page and riding page)
  document.addEventListener('click',function(e){
    var b=e.target.closest('[data-copy]'); if(!b) return;
    if(copyToClipboard(b.getAttribute('data-copy'))){
      var prev=b.innerHTML; b.innerHTML='Copied'; setTimeout(function(){b.innerHTML=prev;},1400);
    }
  });

  function esc(s){return String(s==null?'':s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function $(id){return document.getElementById(id);}
  function qp(name){try{return new URLSearchParams(window.location.search).get(name);}catch(e){return null;}}

  var ic = {
    problem:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
    alt:'<svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3Z"/><path d="M10 20h4"/></svg>',
    out:'<svg viewBox="0 0 24 24"><path d="M3 12l5 5L21 5"/></svg>',
    arrow:'<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    check:'<svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>'
  };

  /* ====================== YEAR ====================== */
  var yr = $('year'); if(yr) yr.textContent = (new Date()).getFullYear();

  /* ====================== BLENDED NAV (transparent over hero, solid on scroll) ====================== */
  (function(){
    var bh = document.querySelector('header.site.blend'); if(!bh) return;
    function onScroll(){
      // turn solid white as soon as the user scrolls down from the very top
      bh.classList.toggle('solid', (window.scrollY||window.pageYOffset) > 24);
    }
    window.addEventListener('scroll', onScroll, {passive:true});
    window.addEventListener('resize', onScroll, {passive:true});
    onScroll();
  })();

  /* ====================== COLLAPSIBLE FILTER (Policy/Research) ====================== */
  (function(){
    var btn = $('filterToggle'); var bar = document.querySelector('.explorer-bar'); if(!btn||!bar) return;
    btn.addEventListener('click', function(){
      var open = bar.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  })();

  /* ====================== SCROLL REVEAL ====================== */
  (function(){
    var anims = document.querySelectorAll('.anim');
    if(!anims.length) return;
    if('IntersectionObserver' in window){
      var io = new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target);}});},{threshold:0.12,rootMargin:"0px 0px -40px 0px"});
      anims.forEach(function(el){io.observe(el);});
    } else { anims.forEach(function(el){el.classList.add('in');}); }
  })();

  /* ====================== COUNT-UP ([data-countup] -> ISSUES length) ====================== */
  (function(){
    var up = document.querySelector('[data-countup]'); if(!up) return;
    var end = ISSUES.filter(function(i){return i.stage==='active';}).length || ISSUES.length;
    if('IntersectionObserver' in window){
      var io = new IntersectionObserver(function(en){en.forEach(function(e){if(e.isIntersecting){
        var cur=0, step=Math.max(1,Math.ceil(end/18));
        var t=setInterval(function(){cur+=step;if(cur>=end){cur=end;clearInterval(t);}up.textContent=cur;},40);
        io.unobserve(e.target);
      }});},{threshold:0.6});
      io.observe(up);
    } else { up.textContent = end; }
  })();

  /* ====================== FAQ ====================== */
  (function(){
    var faqList = $('faqList'); if(!faqList) return;
    faqList.innerHTML = FAQS.map(function(f,i){
      return '<div class="faq"><button class="faq-q" aria-expanded="false" aria-controls="fa-'+i+'">'+esc(f.q)+
        '<svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>'+
        '<div class="faq-a" id="fa-'+i+'"><div class="inner">'+esc(f.a)+'</div></div></div>';
    }).join('');
    faqList.addEventListener('click', function(e){
      var b=e.target.closest('.faq-q'); if(!b)return;
      var panel=$(b.getAttribute('aria-controls'));
      var open=b.getAttribute('aria-expanded')==='true';
      b.setAttribute('aria-expanded',open?'false':'true');
      if(open){panel.style.maxHeight=null;panel.classList.remove('open');}
      else{panel.classList.add('open');panel.style.maxHeight=panel.scrollHeight+'px';}
    });
  })();

  /* ====================== ISSUE OVERVIEW / POLICY LIBRARY (filterable grid -> issue pages) ====================== */
  (function(){
    var grid = $('issueGrid'); if(!grid) return;
    var DISPLAY = ISSUES.filter(function(it){return it.stage==='active';});
    function searchStr(it){ var c=CATS[it.cat]||{}; return (it.title+' '+it.summary+' '+(it.policy?it.policy.problem+' '+it.policy.alternative:'')+' '+(c.label||'')).toLowerCase(); }
    function card(it){
      var c = CATS[it.cat] || {label:it.cat,color:"#a88240"};
      var st = it.status || (it.stage === 'active' ? "Research in progress" : "Research Coming Soon");
      var stClass = "status-" + st.toLowerCase().replace(/ /g, '-');
      var stage = '<span class="ov-stage ' + stClass + '">' + esc(st) + '</span>';
      var isLink = it.stage === 'active' && st !== 'Research Coming Soon';
      
      var innerHtml = '<div class="ov-top"><span class="ov-tag"><span class="swatch" style="background:'+c.color+'"></span>'+esc(c.label)+'</span>'+stage+'</div>'+
        '<h3>'+esc(it.title)+'</h3><p>'+esc(it.summary)+'</p>';
        
      if(isLink){
        return '<a class="ov-card anim" href="issue.html?id='+esc(it.id)+'" data-cat="'+esc(it.cat)+'" data-search="'+esc(searchStr(it))+'">' + innerHtml + '</a>';
      } else {
        return '<div class="ov-card static anim" data-cat="'+esc(it.cat)+'" data-search="'+esc(searchStr(it))+'">' + innerHtml + '</div>';
      }
    }
    grid.innerHTML = DISPLAY.map(card).join('');
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.ov-card'));
    // these cards are created after the scroll-reveal observer ran, so reveal them now
    cards.forEach(function(c){c.classList.add('in');});

    // a single featured issue needs no filter/search chrome; hide it for a cleaner read
    if(DISPLAY.length<2){
      var ftr=document.querySelector('.filter-toggle-row'); if(ftr) ftr.style.display='none';
      var statEl=document.querySelector('.explorer-stat'); if(statEl) statEl.style.display='none';
    }

    // filter controls are optional
    var tabsEl=$('filterTabs'), searchInput=$('policySearch'), searchBox=$('searchBox'),
        clearBtn=$('searchClear'), countEl=$('resultCount'), emptyEl=$('emptyState');
    var state={q:"",cat:"all"};
    function apply(){
      var q=state.q.trim().toLowerCase(), shown=0;
      cards.forEach(function(card){
        var mc=state.cat==="all"||card.getAttribute('data-cat')===state.cat;
        var mq=!q||card.getAttribute('data-search').indexOf(q)!==-1;
        var show=mc&&mq; card.style.display=show?"":"none"; if(show)shown++;
      });
      if(countEl) countEl.innerHTML='Showing <b>'+shown+'</b> of '+DISPLAY.length;
      if(emptyEl) emptyEl.classList.toggle('show',shown===0);
      if(searchBox) searchBox.classList.toggle('has-val',state.q.length>0);
    }
    if(tabsEl){
      var used={}; DISPLAY.forEach(function(it){used[it.cat]=(used[it.cat]||0)+1;});
      var html='<button data-cat="all" class="active" aria-pressed="true">All <span class="cnt">'+DISPLAY.length+'</span></button>';
      Object.keys(used).forEach(function(k){var c=CATS[k]||{label:k};html+='<button data-cat="'+k+'" aria-pressed="false">'+esc(c.label)+' <span class="cnt">'+used[k]+'</span></button>';});
      tabsEl.innerHTML=html;
      tabsEl.addEventListener('click',function(e){var b=e.target.closest('button[data-cat]');if(!b)return;state.cat=b.getAttribute('data-cat');tabsEl.querySelectorAll('button').forEach(function(x){var on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-pressed',on?'true':'false');});apply();});
    }
    if(searchInput) searchInput.addEventListener('input',function(){state.q=this.value;apply();});
    if(clearBtn) clearBtn.addEventListener('click',function(){searchInput.value="";state.q="";apply();searchInput.focus();});
    var reset=$('resetFilters'); if(reset) reset.addEventListener('click',function(){state.q="";state.cat="all";if(searchInput)searchInput.value="";if(tabsEl)tabsEl.querySelectorAll('button').forEach(function(x){var on=x.getAttribute('data-cat')==="all";x.classList.toggle('active',on);x.setAttribute('aria-pressed',on?'true':'false');});apply();});
    apply();
  })();

  /* ====================== SINGLE ISSUE PAGE ([data-issue-page]) ====================== */
  (function(){
    var root = document.querySelector('[data-issue-page]'); if(!root) return;
    var id = qp('id') || (ISSUES[0]&&ISSUES[0].id);
    var it = null; ISSUES.forEach(function(x){if(x.id===id) it=x;});
    if(!it) it = ISSUES[0];
    var c = CATS[it.cat] || {label:it.cat,color:"#a88240"};
    document.title = it.title + ": Western Charter House";

    var setHTML=function(sel,html){var el=root.querySelector(sel)||document.querySelector(sel);if(el)el.innerHTML=html;};
    setHTML('[data-i-eyebrow]', '<span class="swatch" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+c.color+';margin-right:8px;vertical-align:middle"></span>'+esc(c.label));
    setHTML('[data-i-title]', esc(it.title));

    // researcher byline (gives the work a human face; can loop back to the Thought page)
    var lead = it.lead || {name:'Western Charter House Policy Team', role:'Research & Policy'};
    var li = lead.name.split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase();
    setHTML('[data-i-byline]', '<span class="av">'+esc(li)+'</span><span class="bl-meta"><span class="bl-name">Research led by '+esc(lead.name)+'</span><span class="bl-role">'+esc(lead.role)+'</span></span>');

    var stageHtml = it.stage==='active'
      ? '<span class="status-banner">'+ic.check+'<span>This is active Western Charter House research. We are documenting this issue in full before it moves into a policy position.</span></span>'
      : '<span class="status-banner draft">'+ic.problem+'<span>This is a living research page. The sections below are a working draft our team adds to as findings come in.</span></span>';
    setHTML('[data-i-status]', stageHtml);
    var statusEl = root.querySelector('[data-i-status]');
    if(statusEl) statusEl.classList.add('in');

    /* ---- build the memo (Summary -> Problem -> Evidence -> Solution -> Pay -> What Must Be Done -> People -> Q&A -> Conclusion) ---- */
    var p=it.policy, r=it.research, sec=[], n=0, navItems=[];
    // each section gets a stable id + number so the on-this-page nav can deep-link it
    function block(title, inner, id, customNum){ 
      n++; 
      var num = customNum !== undefined ? customNum : (n<10?'0'+n:''+n); 
      navItems.push({id:id,num:num,title:title}); 
      var numHtml = num ? '<span class="num">'+num+'</span>' : '';
      return '<section class="memo-sec" id="'+id+'">'+numHtml+'<h2>'+title+'</h2>'+inner+'</section>'; 
    }
    function para(t){ return '<p>'+esc(t)+'</p>'; }

    /* ---- raw-evidence rendering (item 8): screenshots open in a lightbox, FOI docs and links open in a new tab ---- */
    var DOC_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4M9 13h6M9 17h6M9 9h2"/></svg>';
    var LINK_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>';
    var CLOCK_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    var ZOOM_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/></svg>';
    function evidenceGallery(items){
      var imgs=items.filter(function(e){return e.type==='image';});
      var rest=items.filter(function(e){return e.type!=='image';});
      var html='';
      if(imgs.length){
        html+='<div class="ev-gallery">'+imgs.map(function(e){
          var src=esc(e.src||e.href||''), cap=esc(e.title||'');
          return '<figure class="ev-shot"><button type="button" class="ev-shot-btn" data-lightbox="'+src+'" data-cap="'+cap+'">'+
            '<img src="'+esc(e.thumb||e.src||e.href||'')+'" alt="'+(cap||'Evidence')+'" loading="lazy"><span class="ev-zoom">'+ZOOM_ICON+'</span></button>'+
            (e.title?'<figcaption>'+esc(e.title)+(e.source?' <span>'+esc(e.source)+'</span>':'')+'</figcaption>':'')+'</figure>';
        }).join('')+'</div>';
      }
      if(rest.length){
        html+='<div class="ev-docs">'+rest.map(function(e){
          var href=esc(e.href||e.src||'#');
          var meta=[e.source,e.date].filter(Boolean).map(esc).join(' &middot; ');
          return '<a class="ev-doc" href="'+href+'" target="_top" rel="noopener"><span class="ev-doc-ic">'+(e.type==='doc'?DOC_ICON:LINK_ICON)+'</span>'+
            '<span class="ev-doc-meta"><b>'+esc(e.title||'Document')+'</b>'+(meta?'<span>'+meta+'</span>':'')+'</span><span class="ev-doc-go">View'+ic.arrow+'</span></a>';
        }).join('')+'</div>';
      }
      return html;
    }
    function evidencePending(){
      return '<div class="ev-pending"><span class="ev-pending-ic">'+CLOCK_ICON+'</span><div><b>Source material is being added.</b><p>Screenshots from parent and stakeholder group pages and the Freedom of Information requests behind this issue will be published here, so members can review the raw evidence directly.</p></div></div>';
    }

    // share helpers (members share findings on their own channels)
    var pageUrl=(function(){try{return location.href.split('#')[0];}catch(e){return '';}})();
    var TGI='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.5 2 2 10.6l6.3 2.2L18 5.7l-7.4 8.6v4.5l3-3.3 4.1 2.9z"/></svg>';
    var XI='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h3l-7.1 8.1L22.5 22H16l-5-6.3L5.2 22H2l7.6-8.7L1.5 2H8l4.5 5.9z"/></svg>';
    var MI='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
    var LI='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>';
    function shareLinks(){
      var u=encodeURIComponent(pageUrl),t=encodeURIComponent(it.title);
      return '<a class="share-btn" href="https://t.me/share/url?url='+u+'&text='+t+'" target="_top" rel="noopener">'+TGI+' Telegram</a>'+
        '<a class="share-btn" href="https://twitter.com/intent/tweet?text='+t+'&url='+u+'" target="_top" rel="noopener">'+XI+' X</a>'+
        '<a class="share-btn" href="mailto:?subject='+t+'&body='+u+'" target="_top" rel="noopener">'+MI+' Email</a>'+
        '<button class="share-btn" type="button" data-copy="'+esc(pageUrl)+'">'+LI+' Copy link</button>';
    }

    if(it.sections && it.sections.length){
      it.sections.forEach(function(s){
        sec.push(block(s.title, s.content, s.id, ""));
      });
    } else {
      sec.push(block('Summary', para(it.summary), 'summary'));
      if(p&&p.problem) sec.push(block('The Problem', para(p.problem), 'problem'));
      if(r&&r.findings&&r.findings.length){
        var ev='<div class="memo-list">'+r.findings.map(function(f,i){return '<div class="mi"><span class="mk">'+(i+1)+'</span><span><b>'+esc(f.t)+'.</b> '+esc(f.d)+'</span></div>';}).join('')+'</div>';
        // raw source material members can view directly (screenshots, FOIs, records)
        ev+='<div class="ev-block"><div class="ev-head"><span class="ev-eyebrow">Source material</span>'+
          '<p>The raw evidence behind these findings: stakeholder and group screenshots, records, and Freedom of Information requests, so members can review it for themselves.</p></div>'+
          ((r.evidence&&r.evidence.length)?evidenceGallery(r.evidence):evidencePending())+'</div>';
        ev+='<div class="evidence"><b>Worth sharing?</b> Members can share these findings on their own channels to build momentum.'+
          '<div class="share-row">'+shareLinks()+'</div></div>';
        sec.push(block('Evidence Gathered', ev, 'evidence'));
      }
      if(p&&p.alternative) sec.push(block('A Bold Solution', para(p.alternative)+(p.outcome?para(p.outcome):''), 'solution'));
      if(it.howToPay) sec.push(block('How to Pay For It', para(it.howToPay), 'pay'));
      if(p&&p.recs&&p.recs.length) sec.push(block('What Must Be Done','<div class="memo-list">'+p.recs.map(function(x){return '<div class="mi"><span class="r-check">'+ic.check+'</span><span>'+esc(x)+'</span></div>';}).join('')+'</div>', 'actions'));
      if(r&&r.stakeholders&&r.stakeholders.length) sec.push(block('People &amp; Organizations Involved','<div class="stake-grid">'+r.stakeholders.map(function(s){var si=(s.name||'').split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase();return '<div class="stake"><div class="s-av">'+esc(si)+'</div><div><h3>'+esc(s.name)+'</h3><div class="s-role">'+esc(s.role)+'</div><p>'+esc(s.d)+'</p></div></div>';}).join('')+'</div>', 'people'));
      if(it.qa&&it.qa.length) sec.push(block('Common Questions','<div class="qa-list">'+it.qa.map(function(q){return '<div class="qa-item"><div class="q">'+esc(q.q)+'</div><div class="a">'+esc(q.a)+'</div></div>';}).join('')+'</div>', 'questions'));
      var concl = it.conclusion || (p&&p.outcome) || '';
      if(concl) sec.push(block('Conclusion', para(concl)+(p&&p.action?'<div class="status-banner" style="margin-top:24px">'+ic.arrow+'<span><b style="color:var(--ink)">What you can do.</b> '+esc(p.action)+'</span></div>':''), 'conclusion'));
    }
    setHTML('[data-i-memo]', sec.join(''));
    setHTML('[data-i-share]', shareLinks());
    var memoEl = root.querySelector('[data-i-memo]');
    if(memoEl) memoEl.classList.add('in');
    var shareBar = root.querySelector('.share-bar.anim');
    if(shareBar) shareBar.classList.add('in');

    /* ---- on-this-page anchor navigation (item 10a): quick links to every section ---- */
    var navWrap=root.querySelector('[data-i-nav]');
    if(navWrap){
      navWrap.innerHTML='<span class="mn-title">On this page</span><div class="mn-links">'+navItems.map(function(s){
        var numSpan = s.num ? '<span class="mn-num">'+s.num+'</span>' : '';
        return '<a href="javascript:;" data-target="'+s.id+'">'+numSpan+'<span class="mn-tx">'+s.title+'</span></a>';
      }).join('')+'</div>';
      // deterministic scrollspy: the active section is the last one whose top has
      // crossed a line just under the sticky header.
      var links={}; navWrap.querySelectorAll('a[data-target]').forEach(function(a){links[a.getAttribute('data-target')]=a;});
      var secs=Array.prototype.slice.call(root.querySelectorAll('.memo-sec[id]'));
      function syncSpy(){
        var line=160,cur=secs[0]?secs[0].id:null;
        secs.forEach(function(s){ if(s.getBoundingClientRect().top<=line) cur=s.id; });
        navWrap.querySelectorAll('a.active').forEach(function(x){x.classList.remove('active');});
        var l=links[cur]; if(l) l.classList.add('active');
      }
      // instant feedback on click; the scroll handler then keeps it in sync
      navWrap.addEventListener('click',function(e){
        var a=e.target.closest('a[data-target]'); if(!a)return;
        e.preventDefault();
        var targetId = a.getAttribute('data-target');
        var targetEl = document.getElementById(targetId);
        if(targetEl){
          var headerOffset = 130;
          var elementPosition = targetEl.getBoundingClientRect().top;
          var offsetPosition = elementPosition + window.pageYOffset - headerOffset;
          window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
        }
        navWrap.querySelectorAll('a.active').forEach(function(x){x.classList.remove('active');});
        a.classList.add('active');
      });
      window.addEventListener('scroll',syncSpy,{passive:true});
      window.addEventListener('resize',syncSpy,{passive:true});
      syncSpy();
    }

    /* ---- lightbox for evidence screenshots ---- */
    (function(){
      var lb=null;
      document.addEventListener('click',function(e){
        var btn=e.target.closest('[data-lightbox]'); if(!btn) return;
        var src=btn.getAttribute('data-lightbox'), cap=btn.getAttribute('data-cap')||'';
        if(!src) return;
        if(!lb){
          lb=document.createElement('div'); lb.className='lightbox';
          lb.innerHTML='<button class="lb-close" type="button" aria-label="Close">&times;</button><figure><img alt=""><figcaption></figcaption></figure>';
          document.body.appendChild(lb);
          lb.addEventListener('click',function(ev){ if(ev.target===lb||ev.target.closest('.lb-close')) lb.classList.remove('show'); });
          document.addEventListener('keydown',function(ev){ if(ev.key==='Escape'&&lb) lb.classList.remove('show'); });
        }
        lb.querySelector('img').src=src;
        var fc=lb.querySelector('figcaption'); fc.textContent=cap; fc.style.display=cap?'':'none';
        lb.classList.add('show');
      });
    })();



    // discussion (Telegram, members)
    var dl=root.querySelector('[data-i-discuss-title]'); if(dl) dl.textContent='Discuss: '+it.title.split(':')[0];
  })();

  /* ====================== RIDING DATA + COMBOBOX + MAP ====================== */
  (function(){
    var needsData = $('bcMap') || $('hRidingInput') || $('suRidingInput');
    if(!needsData) return;

    var PARTY_COLORS={"Conservative":"#1f5f8b","BC Conservative":"#1f5f8b","NDP":"#d65f3f","BC NDP":"#d65f3f","Green":"#3e9b6b","BC Green":"#3e9b6b","Independent":"#8492a2"};
    var REGION_COLORS={"Okanagan":"#a88240","Lower Mainland":"#2e6e4e","Interior":"#1f5f8b","Island":"#7d3b3b"};
    var NEUTRAL='#dfe6ee';
    var ridingData=[], ridingByName={}, pathByName={};
    var focusRiding=null; // set by the zoom module; lets the search box zoom the map to a riding
    var bcMap=$('bcMap'), mapLoading=$('mapLoading'), mapFallback=$('mapFallback'),
        mapNote=$('mapNote'), ridingPanel=$('ridingPanel'), rpEmpty=$('rpEmpty'),
        ridingSearch=$('ridingSearch'), ridingSugg=$('ridingSugg'),
        signupRiding=$('signupRiding'), heroRiding=$('heroRiding');

    function rMargin(r){var x=(r.result2024||{}).marginPct;return x==null?null:x;}
    var COMP_LABELS=['Toss-up','Lean','Likely','Safe'];
    var COMP_COLORS=['#b3402f','#d8743a','#c9a86a',NEUTRAL];
    function compBucket(m){if(m==null)return null;if(m<5)return 0;if(m<10)return 1;if(m<20)return 2;return 3;}
    function strategicScore(r){var m=rMargin(r);if(m==null)return null;return Math.max(0,Math.min(100,Math.round(100-m*2.6)));}
    function strategicColor(s){if(s==null)return NEUTRAL;if(s>=70)return '#b3402f';if(s>=50)return '#d8743a';if(s>=30)return '#e0b15f';return NEUTRAL;}

    // Uniform map: no inline fills. CSS paints every riding the same colour, and the
    // selected riding picks up its highlight from the `.active` rule.
    function paintAll(){ridingData.forEach(function(r){var p=pathByName[r.name.toLowerCase()];if(!p)return;p.style.fill='';});}

    function wireCombo(inputId,hiddenId,listId){
      var input=$(inputId),hidden=$(hiddenId),list=$(listId);
      if(!input||!hidden||!list)return;
      var active=-1;
      function render(q){
        q=(q||'').trim().toLowerCase();
        var hits=ridingData.filter(function(r){return !q||r.name.toLowerCase().indexOf(q)!==-1;}).sort(function(a,b){return a.name<b.name?-1:1;}).slice(0,80);
        list.innerHTML=hits.length?hits.map(function(r){return '<button type="button" data-name="'+esc(r.name)+'"><span>'+esc(r.name)+'</span><span class="rg">'+esc(r.region||'')+'</span></button>';}).join(''):'<div class="rcombo-empty">No riding matches that.</div>';
        active=-1;list.classList.add('show');input.setAttribute('aria-expanded','true');
      }
      function choose(name){input.value=name;hidden.value=name;input.setCustomValidity('');list.classList.remove('show');input.setAttribute('aria-expanded','false');}
      function sync(){var m=ridingByName[(input.value||'').trim().toLowerCase()];if(m){hidden.value=m.name;input.setCustomValidity('');}else{hidden.value='';input.setCustomValidity(input.value?'Please pick your riding from the list.':'');}}
      input.addEventListener('focus',function(){render(input.value);});
      input.addEventListener('input',function(){sync();render(input.value);});
      list.addEventListener('mousedown',function(e){var b=e.target.closest('button[data-name]');if(!b)return;e.preventDefault();choose(b.getAttribute('data-name'));});
      input.addEventListener('keydown',function(e){
        var btns=list.querySelectorAll('button[data-name]');
        if(!list.classList.contains('show')||!btns.length)return;
        if(e.key==='ArrowDown'){e.preventDefault();active=Math.min(active+1,btns.length-1);}
        else if(e.key==='ArrowUp'){e.preventDefault();active=Math.max(active-1,0);}
        else if(e.key==='Enter'){if(active>=0){e.preventDefault();choose(btns[active].getAttribute('data-name'));}return;}
        else if(e.key==='Escape'){list.classList.remove('show');return;}
        else return;
        btns.forEach(function(b,i){b.classList.toggle('active',i===active);if(i===active)b.scrollIntoView({block:'nearest'});});
      });
      input.addEventListener('blur',function(){setTimeout(function(){list.classList.remove('show');input.setAttribute('aria-expanded','false');sync();},150);});
    }

    function renderPanel(r){
      if(!ridingPanel)return;
      if(rpEmpty)rpEmpty.style.display='none';
      var pc=PARTY_COLORS[r.party]||"#8492a2";var res=r.result2024||{};
      var html='<div class="rp-region">'+esc(r.region||'British Columbia')+' Chapter</div><h3>'+esc(r.name)+'</h3>'+
        '<div class="rp-row"><span class="lbl">MLA</span><span class="val">'+esc(r.mla||'TBD')+'</span></div>'+
        '<div class="rp-row"><span class="lbl">Party</span><span class="val party"><span class="dot" style="background:'+pc+'"></span>'+esc(r.party||'TBD')+'</span></div>';
      if(res.winnerVotePct!=null)html+='<div class="rp-row"><span class="lbl">2024 vote share</span><span class="val">'+res.winnerVotePct+'%</span></div>';
      if(res.marginPct!=null)html+='<div class="rp-row"><span class="lbl">Margin</span><span class="val">'+(res.marginPct>0?'+':'')+res.marginPct+' pts'+(res.runnerUpParty?' vs '+esc(res.runnerUpParty):'')+'</span></div>';
      var cb=compBucket(rMargin(r));
      if(cb!=null)html+='<div class="rp-row"><span class="lbl">Competitiveness</span><span class="val rp-comp"><span class="dot" style="background:'+COMP_COLORS[cb]+'"></span>'+COMP_LABELS[cb]+'</span></div>';
      // Charterhouse members in this riding (item 10c). Populated from r.members once
      // the GHL contacts-by-riding sync writes it; shows a clear placeholder until then.
      var mem=(r.members!=null&&r.members!==''&&Number(r.members)>0)?r.members:null;
      html+='<div class="rp-members"><div class="rm-top"><span class="rm-lbl">Charterhouse members</span>'+
        '<span class="rm-val'+(mem==null?' rm-pending':'')+'">'+(mem!=null?esc(String(mem)):'Coming soon')+'</span></div>'+
        '<div class="rm-note">'+(mem!=null?'organizing in this riding':'We will show how many members we have here as people join.')+'</div></div>';
      var ps=strategicScore(r);
      if(ps!=null)html+='<div class="rp-pressure"><div class="pp-top"><span class="pp-lbl">Strategic importance</span><span class="pp-val">'+ps+'<small>/100</small></span></div><div class="rp-bar"><i style="width:'+ps+'%;background:'+strategicColor(ps)+'"></i></div><div class="pp-note">A non-partisan model based on how competitive the 2024 result was.</div></div>';
      html+='<div class="rp-cta"><button class="btn btn--primary btn--block" data-join="'+esc(r.name)+'">Join the '+esc(r.name)+' section</button></div>';
      ridingPanel.innerHTML=html;
    }
    if(ridingPanel) ridingPanel.addEventListener('click',function(e){
      var b=e.target.closest('[data-join]');if(!b)return;
      var name=b.getAttribute('data-join');
      var su=$('signup');
      if(su){
        if(signupRiding)signupRiding.value=name;
        var vin=$('suRidingInput');if(vin){vin.value=name;vin.setCustomValidity('');}
        su.scrollIntoView({behavior:'smooth'});var nm=$('suName');if(nm)setTimeout(function(){nm.focus();},300);
      } else {
        // no signup form on this page (e.g. advocacy): go to the home signup with the riding prefilled
        window.location.href='index.html?riding='+encodeURIComponent(name)+'#stay';
      }
    });
    function selectRiding(name){
      var r=ridingByName[name.toLowerCase()];if(!r)return;
      renderPanel(r);
      if(bcMap){
        bcMap.querySelectorAll('path.riding.active').forEach(function(p){p.classList.remove('active');});
        var ap=pathByName[r.name.toLowerCase()];if(ap)ap.classList.add('active');
      }
      paintAll();
      var panel = $('ridingPanel') || document.querySelector('.map-panel');
      if(panel){
        var headerOffset = 130;
        var elementPosition = panel.getBoundingClientRect().top;
        var offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
      }
    }

    function buildMap(geo){
      if(!bcMap)return false;
      var W=800,H=600,pad=12,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      function mercY(lat){
        var r=Math.max(-85,Math.min(85,lat))*Math.PI/180;
        return Math.log(Math.tan(Math.PI/4+r/2));
      }
      function scan(c){
        if(typeof c[0]==='number'){
          var x=c[0]*Math.PI/180,y=mercY(c[1]);
          if(x<minX)minX=x;if(x>maxX)maxX=x;
          if(y<minY)minY=y;if(y>maxY)maxY=y;
          return;
        }
        c.forEach(scan);
      }
      geo.features.forEach(function(f){scan(f.geometry.coordinates);});
      if(!isFinite(minX))return false;
      var spanX=maxX-minX,spanY=maxY-minY,scale=Math.min((W-2*pad)/spanX,(H-2*pad)/spanY);
      var offX=(W-spanX*scale)/2,offY=(H-spanY*scale)/2;
      function px(x,y){return [offX+(x*Math.PI/180-minX)*scale,H-(offY+(mercY(y)-minY)*scale)];}
      function ring(c){var d='';c.forEach(function(pt,i){var p=px(pt[0],pt[1]);d+=(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1);});return d+'Z';}

      // The riding geometry is clipped to the real coastline, so islands are already
      // separate polygons from the mainland. Just draw every ring of every (Multi)Polygon
      // at its true projected position — no displacement or strait-splitting hacks needed.
      var svg='';
      geo.features.forEach(function(f){
        var nm=f.properties.name||f.properties.NAME||f.properties.ED_NAME||'';
        var pathD='';
        function addPoly(poly){poly.forEach(function(r){if(r.length>=3)pathD+=ring(r);});}
        if(f.geometry.type==='Polygon') addPoly(f.geometry.coordinates);
        else if(f.geometry.type==='MultiPolygon') f.geometry.coordinates.forEach(addPoly);
        svg+='<path class="riding" data-name="'+esc(nm)+'" d="'+pathD+'"><title>'+esc(nm)+'</title></path>';
      });
      bcMap.innerHTML=svg;pathByName={};
      bcMap.querySelectorAll('path.riding').forEach(function(p){pathByName[(p.getAttribute('data-name')||'').toLowerCase()]=p;});
      bcMap.addEventListener('click',function(e){var p=e.target.closest('path.riding');if(!p)return;selectRiding(p.getAttribute('data-name'));});
      // No intelligence-layer switcher and no regional colouring: one uniform province.
      // Selecting a riding opens its detail in the side panel.
      if(mapNote){mapNote.style.display='block';mapNote.innerHTML=esc('Select your riding on the map, or search by name, to see its detail.');}
      paintAll();
      if(mapLoading)mapLoading.style.display='none';
      return true;
    }
    function buildFallback(){
      if(mapLoading)mapLoading.style.display='none';if(bcMap)bcMap.style.display='none';if(mapNote)mapNote.style.display='none';
      if(!mapFallback)return;
      var byRegion={};ridingData.forEach(function(r){(byRegion[r.region]=byRegion[r.region]||[]).push(r);});
      var html='';Object.keys(byRegion).sort().forEach(function(reg){byRegion[reg].sort(function(a,b){return a.name<b.name?-1:1;}).forEach(function(r){html+='<button data-name="'+esc(r.name)+'"><span>'+esc(r.name)+'</span><span class="reg">'+esc(reg)+'</span></button>';});});
      mapFallback.innerHTML=html;mapFallback.classList.add('show');
      mapFallback.addEventListener('click',function(e){var b=e.target.closest('[data-name]');if(!b)return;selectRiding(b.getAttribute('data-name'));});
    }
    if(ridingSearch&&ridingSugg){
      ridingSearch.addEventListener('input',function(){var q=this.value.trim().toLowerCase();if(!q){ridingSugg.classList.remove('show');return;}var hits=ridingData.filter(function(r){return r.name.toLowerCase().indexOf(q)!==-1;}).slice(0,8);if(!hits.length){ridingSugg.classList.remove('show');return;}ridingSugg.innerHTML=hits.map(function(r){return '<button data-name="'+esc(r.name)+'">'+esc(r.name)+'</button>';}).join('');ridingSugg.classList.add('show');});
      ridingSugg.addEventListener('click',function(e){var b=e.target.closest('[data-name]');if(!b)return;var nm=b.getAttribute('data-name');ridingSearch.value=nm;ridingSugg.classList.remove('show');selectRiding(nm);if(focusRiding)focusRiding(nm);});
      document.addEventListener('click',function(e){if(!e.target.closest('.map-search'))ridingSugg.classList.remove('show');});
    }

    /* zoom + pan controls (so the small, dense ridings are reachable and clickable) */
    (function(){
      var zin=$('mapZoomIn'),zout=$('mapZoomOut'),zreset=$('mapZoomReset');
      if(!bcMap) return;
      var W=800,H=600,MAXZ=14,zoom=1,cx=W/2,cy=H/2;
      function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
      function apply(){
        var vw=W/zoom,vh=H/zoom;
        cx=clamp(cx,vw/2,W-vw/2); cy=clamp(cy,vh/2,H-vh/2);
        bcMap.setAttribute('viewBox',(cx-vw/2).toFixed(1)+' '+(cy-vh/2).toFixed(1)+' '+vw.toFixed(1)+' '+vh.toFixed(1));
        if(zout) zout.disabled=zoom<=1.001;
        if(zin) zin.disabled=zoom>=MAXZ-0.001;
        bcMap.style.cursor=zoom>1?'grab':'';
      }
      // svg-space point under a screen coordinate (for zoom-to-cursor)
      function svgAt(clientX,clientY){
        var rect=bcMap.getBoundingClientRect(),vw=W/zoom,vh=H/zoom;
        return [ (cx-vw/2)+((clientX-rect.left)/Math.max(1,rect.width))*vw,
                 (cy-vh/2)+((clientY-rect.top)/Math.max(1,rect.height))*vh ];
      }
      // zoom while keeping the point under the cursor/pinch-midpoint fixed on screen
      function zoomToward(clientX,clientY,nz){
        nz=clamp(nz,1,MAXZ); if(Math.abs(nz-zoom)<1e-3)return;
        var rect=bcMap.getBoundingClientRect();
        var fx=(clientX-rect.left)/Math.max(1,rect.width), fy=(clientY-rect.top)/Math.max(1,rect.height);
        var f=svgAt(clientX,clientY);
        zoom=nz; var vw=W/zoom,vh=H/zoom;
        cx=f[0]+(0.5-fx)*vw; cy=f[1]+(0.5-fy)*vh; apply();
      }
      function setZoomCenter(z){zoom=clamp(z,1,MAXZ);apply();}
      if(zin) zin.addEventListener('click',function(){setZoomCenter(zoom*1.6);});
      if(zout) zout.addEventListener('click',function(){setZoomCenter(zoom/1.6);});
      if(zreset) zreset.addEventListener('click',function(){zoom=1;cx=W/2;cy=H/2;apply();});

      // searching a riding zooms the map straight to it (best for the dense Lower Mainland)
      focusRiding=function(name){
        var pth=pathByName[(name||'').toLowerCase()]; if(!pth||!pth.getBBox) return;
        var bb; try{bb=pth.getBBox();}catch(_){return;}
        if(!bb||!bb.width||!bb.height) return;
        zoom=clamp(Math.min(W/(bb.width*2.6),H/(bb.height*2.6)),1.8,MAXZ);
        cx=bb.x+bb.width/2; cy=bb.y+bb.height/2; apply();
      };

      // wheel zooms toward the cursor; double-click zooms in on the point
      bcMap.addEventListener('wheel',function(e){e.preventDefault();zoomToward(e.clientX,e.clientY,zoom*(e.deltaY<0?1.2:1/1.2));},{passive:false});
      bcMap.addEventListener('dblclick',function(e){e.preventDefault();zoomToward(e.clientX,e.clientY,zoom*1.8);});

      // pointer gestures: one finger pans, two fingers pinch-zoom. A plain click still
      // reaches the riding and selects it (the swallow only fires after a real gesture).
      var pts={},npts=0,panning=false,armed=false,startX=0,startY=0,scx=0,scy=0,capId=null,gesture=false,pinchD=0,pinchZ=1;
      function vals(o){return Object.keys(o).map(function(k){return o[k];});}
      function dist(a,b){var dx=a.x-b.x,dy=a.y-b.y;return Math.sqrt(dx*dx+dy*dy);}
      function swallow(ev){ev.stopPropagation();ev.preventDefault();bcMap.removeEventListener('click',swallow,true);}
      function armSwallow(){bcMap.addEventListener('click',swallow,true);setTimeout(function(){bcMap.removeEventListener('click',swallow,true);},80);}
      bcMap.addEventListener('pointerdown',function(e){
        pts[e.pointerId]={x:e.clientX,y:e.clientY}; npts++;
        if(npts===1){ armed=zoom>1; panning=false; startX=e.clientX;startY=e.clientY;scx=cx;scy=cy;capId=e.pointerId; }
        else if(npts===2){ armed=false; var a=vals(pts); pinchD=dist(a[0],a[1]); pinchZ=zoom; gesture=true; }
      });
      bcMap.addEventListener('pointermove',function(e){
        if(!(e.pointerId in pts))return;
        pts[e.pointerId]={x:e.clientX,y:e.clientY};
        if(npts>=2){ var a=vals(pts); var d=dist(a[0],a[1]); if(pinchD>0){var mx=(a[0].x+a[1].x)/2,my=(a[0].y+a[1].y)/2;zoomToward(mx,my,pinchZ*(d/pinchD));} return; }
        if(!armed)return;
        var dx=e.clientX-startX,dy=e.clientY-startY;
        if(!panning){ if(Math.abs(dx)<8&&Math.abs(dy)<8) return; panning=true; bcMap.style.cursor='grabbing'; try{bcMap.setPointerCapture(capId);}catch(_){} }
        var rect=bcMap.getBoundingClientRect(),vw=W/zoom,vh=H/zoom;
        cx=scx-dx*(vw/rect.width); cy=scy-dy*(vh/rect.height); apply();
      });
      function up(e){
        if(e.pointerId in pts){delete pts[e.pointerId];npts=Math.max(0,npts-1);}
        if(panning||gesture) armSwallow();
        if(npts<2) gesture=false;
        if(npts===0){ panning=false; armed=false; if(zoom>1)bcMap.style.cursor='grab'; }
      }
      bcMap.addEventListener('pointerup',up); bcMap.addEventListener('pointercancel',up);
      apply();
    })();

    fetch('data/bc-ridings-data.json').then(function(r){return r.ok?r.json():Promise.reject();}).then(function(data){
      ridingData=Array.isArray(data)?data:(data.ridings||[]);
      ridingData.forEach(function(r){ridingByName[r.name.toLowerCase()]=r;});
      // live Charterhouse member counts per riding (counts only, no PII). Served by the
      // n8n "WCH Riding Member Counts" webhook, which tallies GHL contacts by the Riding
      // custom field. Falls back to the committed data/riding-members.json if the webhook
      // is unreachable. The panel shows the number when > 0, else a "Coming soon" note.
      var MEMBERS_URL='https://nilsdigital.app.n8n.cloud/webhook/wch-riding-members';
      fetch(MEMBERS_URL).then(function(r){return r.ok?r.json():Promise.reject();})
        .catch(function(){return fetch('data/riding-members.json').then(function(r){return r.ok?r.json():null;});})
        .then(function(m){
          if(m&&typeof m==='object'){
            Object.keys(m).forEach(function(k){var rr=ridingByName[k.toLowerCase()];if(rr)rr.members=m[k];});
            var total=Object.values(m).reduce(function(a,b){return a+(+b||0);},0);
            var totalCountEl=document.querySelector('[data-i-total-count]');
            var totalBannerEl=document.querySelector('[data-i-total-banner]');
            if(totalCountEl&&totalBannerEl&&total>0){
              totalCountEl.textContent=total;
              totalBannerEl.style.display='flex';
              var totalShareEl=document.querySelector('[data-i-total-share]');
              if(totalShareEl){
                var shareUrl='https://westerncharterhouse.ca/';
                var shareText='Western Charter House now has '+total+' members organizing across BC\'s 93 ridings. Join yours:';
                var u=encodeURIComponent(shareUrl), t=encodeURIComponent(shareText);
                var tgi='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.5 2 2 10.6l6.3 2.2L18 5.7l-7.4 8.6v4.5l3-3.3 4.1 2.9z"/></svg>';
                var xi='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h3l-7.1 8.1L22.5 22H16l-5-6.3L5.2 22H2l7.6-8.7L1.5 2H8l4.5 5.9z"/></svg>';
                var li='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>';
                totalShareEl.innerHTML='<a class="share-btn" href="https://t.me/share/url?url='+u+'&text='+t+'" target="_top" rel="noopener">'+tgi+' Telegram</a>'+
                  '<a class="share-btn" href="https://twitter.com/intent/tweet?text='+t+'%20'+u+'" target="_top" rel="noopener">'+xi+' X</a>'+
                  '<button class="share-btn" type="button" data-copy="'+esc(shareText)+' '+esc(shareUrl)+'">'+li+' Copy link</button>';
              }
            }
          }
        }).catch(function(){});
      wireCombo('hRidingInput','heroRiding','hRidingList');
      wireCombo('suRidingInput','signupRiding','suRidingList');
      // prefill the riding when arriving from a "Join this riding" link (index.html?riding=NAME)
      var pre=qp('riding'); var m=pre&&ridingByName[pre.trim().toLowerCase()];
      if(m){['hRidingInput','suRidingInput'].forEach(function(id){var el=$(id);if(el){el.value=m.name;el.setCustomValidity('');}});
        if($('heroRiding'))$('heroRiding').value=m.name; if($('signupRiding'))$('signupRiding').value=m.name;}
      if(bcMap) return fetch('data/bc-ridings-2024.geojson');
      return null;
    }).then(function(r){if(r&&r.ok)return r.json();if(bcMap&&!r)return Promise.reject('no-geo');return null;}).then(function(geo){
      if(geo&&bcMap){if(!buildMap(geo))buildFallback();}
    }).catch(function(){
      if(bcMap){if(ridingData.length)buildFallback();else if(mapLoading)mapLoading.innerHTML='<div style="color:#9fb2c5">Riding map is being prepared.</div>';}
    });
  })();

  /* ====================== LEAD FORMS (wired to GHL inbound webhook) ====================== */
  (function(){
    var LEAD_ENDPOINTS=['https://services.leadconnectorhq.com/hooks/D4WN0qBDwZNeBqYUlni5/webhook-trigger/0bed9eea-6794-4d4a-b85e-5da5311582f6'];
    function fval(id){var el=$(id);return el?(el.value||'').trim():'';}
    function splitName(f){f=(f||'').trim();if(!f)return{first:'',last:''};var p=f.split(/\s+/);return{first:p.shift(),last:p.join(' ')};}
    function sendLead(payload){LEAD_ENDPOINTS.forEach(function(url){try{fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive:true}).catch(function(){});}catch(e){}});}
    function wire(formId,thanksId,build){
      var form=$(formId);if(!form)return;
      form.addEventListener('submit',function(e){e.preventDefault();if(!form.checkValidity()){form.reportValidity();return;}try{sendLead(build());}catch(err){}form.style.display='none';var t=$(thanksId);if(t)t.classList.add('show');});
    }
    // Home hero form: now collects name + riding + email + phone + postal
    wire('heroForm','heroThanks',function(){var n=splitName(fval('hName'));return {formType:'signup',source:'hero',firstName:n.first,lastName:n.last,email:fval('hEmail'),phone:fval('hPhone'),riding:fval('heroRiding'),postalCode:fval('hPostal')};});
    // Full signup section
    wire('signupForm','signupThanks',function(){var n=splitName(fval('suName'));return {formType:'signup',source:'signup-section',firstName:n.first,lastName:n.last,email:fval('suEmail'),phone:fval('suPhone'),riding:fval('signupRiding'),city:fval('suCity'),postalCode:fval('suPostal')};});
  })();

  /* ====================== MICROSOFT CLARITY (inert until project id is set) ====================== */
  // TODO(clarity): paste the Western Charter House Clarity project id once provisioned.
  var CLARITY_ID="";
  if(CLARITY_ID){(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",CLARITY_ID);}

})();
