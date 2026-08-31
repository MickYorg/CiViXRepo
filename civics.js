// civics.js — shared "teachable moment" engine, included on every page in
// the CiViX journey (splash, builder, calendar, DIG). Two card types:
//   fact — a short definition/explainer, dismissed with "Got it".
//   quiz — three famous sayings + three attributions, tap to match, Skip
//          always allowed, correct pairing always revealed before it
//          dissolves back into whatever the citizen was doing.
// Self-contained on purpose: no dependency on the host page's CSS tokens,
// since dig/index.html runs a different palette/font system than the
// other three pages (see CLAUDE.md's design-token-drift note) — this
// carries its own look so it reads the same everywhere it's dropped in.
//
// Reactions (agree/disagree with a quote) are stored separately from the
// manifesto itself, under their own localStorage key — this is a light,
// cross-page opinion log, not a mutation of civix-profile.
(function () {
  'use strict';
  if (window.CivicsEngine) return;

  var STORE_KEY = 'civix-civics';
  var COOLDOWN_MS = 90 * 1000;
  var SHOW_CHANCE = 0.5;

  var FACTS = [
    { id: 'f-civics', title: 'What is civics?', body: 'Civics is the study of the rights, duties, and responsibilities of citizens, how government works, and how people work together to shape their communities.' },
    { id: 'f-quorum', title: 'Word of the day: quorum', body: 'The minimum number of members who must be present for a legislative body to conduct official business and hold a valid vote.' },
    { id: 'f-veto', title: 'Word of the day: veto', body: 'The power of an executive — a president, governor, or mayor — to reject a bill passed by the legislature, usually subject to an override.' },
    { id: 'f-filibuster', title: 'Word of the day: filibuster', body: 'A tactic for delaying or blocking a vote, most famous in the U.S. Senate, by holding the floor and refusing to yield it.' },
    { id: 'f-amendment', title: 'Word of the day: amendment', body: 'A formal change or addition to a law or constitution, usually requiring more than a simple majority to adopt.' },
    { id: 'f-constituent', title: 'Word of the day: constituent', body: 'A resident of a district or state whom an elected official represents — the reason lawmakers hold town halls and answer mail.' }
  ];

  // Verified, non-disputed attributions only — a wrong attribution here
  // would undercut the "Truth" principle the rest of the app leans on.
  var DECKS = [
    { id: 'd-1', quotes: [
      { text: 'Government of the people, by the people, for the people shall not perish from the earth.', who: 'Abraham Lincoln' },
      { text: 'Ask not what your country can do for you — ask what you can do for your country.', who: 'John F. Kennedy' },
      { text: 'The only thing we have to fear is fear itself.', who: 'Franklin D. Roosevelt' }
    ] },
    { id: 'd-2', quotes: [
      { text: 'Give me liberty, or give me death!', who: 'Patrick Henry' },
      { text: 'A republic, if you can keep it.', who: 'Benjamin Franklin' },
      { text: 'Injustice anywhere is a threat to justice everywhere.', who: 'Martin Luther King Jr.' }
    ] },
    { id: 'd-3', quotes: [
      { text: 'Democracy is the worst form of government, except for all the others that have been tried.', who: 'Winston Churchill' },
      { text: 'Power tends to corrupt, and absolute power corrupts absolutely.', who: 'Lord Acton' },
      { text: 'That government is best which governs least.', who: 'Henry David Thoreau' }
    ] }
  ];

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return {
        seenFacts: Array.isArray(s.seenFacts) ? s.seenFacts : [],
        seenDecks: Array.isArray(s.seenDecks) ? s.seenDecks : [],
        lastShownAt: s.lastShownAt || 0,
        reactions: Array.isArray(s.reactions) ? s.reactions : []
      };
    } catch (e) {
      return { seenFacts: [], seenDecks: [], lastShownAt: 0, reactions: [] };
    }
  }
  function saveState(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function pickNext(state) {
    var wantQuiz = Math.random() < 0.5;
    if (wantQuiz) {
      var unseenDecks = DECKS.filter(function (d) { return state.seenDecks.indexOf(d.id) === -1; });
      if (!unseenDecks.length) { state.seenDecks = []; unseenDecks = DECKS.slice(); }
      return { type: 'quiz', item: unseenDecks[Math.floor(Math.random() * unseenDecks.length)] };
    }
    var unseenFacts = FACTS.filter(function (f) { return state.seenFacts.indexOf(f.id) === -1; });
    if (!unseenFacts.length) { state.seenFacts = []; unseenFacts = FACTS.slice(); }
    return { type: 'fact', item: unseenFacts[Math.floor(Math.random() * unseenFacts.length)] };
  }

  var styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    var tag = document.createElement('style');
    tag.textContent = [
      '.cx-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;',
      'padding:20px;background:rgba(8,11,20,0.6);backdrop-filter:blur(2px);animation:cx-fade-in .3s ease both;}',
      '.cx-overlay.cx-out{animation:cx-fade-out .35s ease both;}',
      '@keyframes cx-fade-in{from{opacity:0}to{opacity:1}}',
      '@keyframes cx-fade-out{from{opacity:1}to{opacity:0}}',
      '.cx-card{--ci:#0A0F1C;--cr:#121A2C;--cp:#ECEAE2;--cpd:#8792A8;--ca:#E0A93F;--cai:#E0A93F;--caw:rgba(224,169,63,.14);',
      'background:var(--cr);color:var(--cp);border:1px solid var(--caw);border-radius:16px;max-width:440px;width:100%;',
      'padding:26px 24px 22px;font-family:Newsreader,Georgia,serif;box-shadow:0 24px 70px rgba(0,0,0,.5);',
      'animation:cx-pop-in .4s cubic-bezier(.2,.9,.3,1.2) both;max-height:88vh;overflow-y:auto;}',
      '@keyframes cx-pop-in{from{transform:scale(.93) translateY(10px);opacity:0}to{transform:none;opacity:1}}',
      '@media (prefers-color-scheme:dark){.cx-card{--ci:#FBFAF7;--cr:#FFFFFF;--cp:#14192B;--cpd:#636B80;--cai:#8F6111;--caw:rgba(224,169,63,.2)}}',
      '.cx-kicker{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;letter-spacing:.14em;color:var(--cai);margin-bottom:10px;}',
      '.cx-title{font-size:19px;font-weight:600;margin:0 0 10px;line-height:1.3;}',
      '.cx-body{font-size:15px;line-height:1.55;color:var(--cp);margin:0 0 20px;}',
      '.cx-sub{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11.5px;color:var(--cpd);margin:0 0 16px;}',
      '.cx-btn{appearance:none;border:1px solid var(--caw);background:none;color:var(--cp);font-family:"IBM Plex Mono",ui-monospace,monospace;',
      'font-size:12px;padding:10px 16px;border-radius:8px;cursor:pointer;}',
      '.cx-btn:hover{filter:brightness(1.1);}',
      '.cx-btn-primary{background:var(--ca);border-color:var(--ca);color:#0A0F1C;font-weight:600;}',
      '.cx-btn[disabled]{opacity:.4;cursor:default;}',
      '.cx-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}',
      '.cx-more{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;color:var(--cpd);text-decoration:none;white-space:nowrap;}',
      '.cx-more:hover{color:var(--cai);}',
      '.cx-quotes,.cx-names{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;}',
      '.cx-chip{appearance:none;text-align:left;border:1px solid var(--caw);background:none;color:var(--cp);',
      'font-family:Newsreader,Georgia,serif;font-size:14px;line-height:1.4;padding:10px 12px;border-radius:10px;cursor:pointer;}',
      '.cx-chip.is-sel{border-color:var(--ca);background:var(--caw);}',
      '.cx-chip.is-matched{opacity:.6;}',
      '.cx-chip.is-used{opacity:.3;cursor:default;}',
      '.cx-name{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12.5px;}',
      '.cx-matched-name{font-family:"IBM Plex Mono",ui-monospace,monospace;color:var(--cai);}',
      '.cx-quiz-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:6px;}',
      '.cx-score{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;color:var(--cpd);}',
      '.cx-reveal-row{border-bottom:1px solid var(--caw);padding:10px 0;}',
      '.cx-reveal-row:last-child{border-bottom:none;}',
      '.cx-reveal-quote{font-size:14px;line-height:1.45;}',
      '.cx-reveal-who{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11.5px;color:var(--cai);margin-top:4px;}',
      '.cx-reveal-note{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:11px;color:#B75A3E;margin-top:2px;}',
      '.cx-reveal-row.is-right .cx-reveal-who{color:#4E9E76;}',
      '.cx-react{display:flex;gap:8px;margin-top:8px;}',
      '.cx-react-btn{appearance:none;border:1px solid var(--caw);background:none;border-radius:8px;padding:5px 9px;',
      'font-size:13px;cursor:pointer;}',
      '.cx-react-btn.is-on{background:var(--caw);border-color:var(--ca);}'
    ].join('');
    document.head.appendChild(tag);
  }

  // civics.js is included from different depths (root pages vs. dig/,
  // which is one folder down) — resolve the link relative to wherever the
  // page actually is, not relative to this script's own location.
  function civix101Href() {
    return location.pathname.indexOf('/dig/') !== -1 ? '../civix101.html' : 'civix101.html';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var showing = false;
  // Idempotent on purpose — a fact card's auto-dismiss timer and its
  // manual "Got it"/backdrop-click can both fire; the second call should
  // just no-op rather than double-animate or clear an already-cleared
  // timer.
  function dismiss(overlay) {
    if (overlay.dataset.dismissed) return;
    overlay.dataset.dismissed = '1';
    if (overlay._autoTimer) window.clearTimeout(overlay._autoTimer);
    overlay.classList.add('cx-out');
    window.setTimeout(function () { overlay.remove(); showing = false; }, 350);
  }

  // Purely informational — no interaction required — so it auto-dissolves
  // on its own after a few seconds instead of waiting on a click. "Got
  // it"/backdrop-click still skip it immediately for anyone who doesn't
  // want to wait. The quiz card is deliberately NOT auto-dismissed: it's
  // interactive and inviting a reaction after reveal, not just a fact to
  // skim.
  var AUTO_DISMISS_MS = 3800;

  function renderFact(item) {
    injectStyle();
    var overlay = document.createElement('div');
    overlay.className = 'cx-overlay';
    overlay.innerHTML =
      '<div class="cx-card" role="dialog" aria-label="Civics moment">' +
        '<div class="cx-kicker">CIVICS MOMENT</div>' +
        '<h3 class="cx-title">' + esc(item.title) + '</h3>' +
        '<p class="cx-body">' + esc(item.body) + '</p>' +
        '<div class="cx-row">' +
          '<button type="button" class="cx-btn cx-btn-primary" data-act="ok">Got it</button>' +
          '<a class="cx-more" href="' + civix101Href() + '">More at CiViX 101 &#8594;</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('[data-act="ok"]').addEventListener('click', function () { dismiss(overlay); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) dismiss(overlay); });
    overlay._autoTimer = window.setTimeout(function () { dismiss(overlay); }, AUTO_DISMISS_MS);
  }

  function renderQuiz(deck, state) {
    injectStyle();
    var quotes = deck.quotes.map(function (q, i) { return { i: i, text: q.text, who: q.who }; });
    var names = quotes.slice().sort(function () { return Math.random() - 0.5; });
    var picks = {};
    var selectedQuote = null;
    var revealed = false;

    var overlay = document.createElement('div');
    overlay.className = 'cx-overlay';
    overlay.innerHTML =
      '<div class="cx-card cx-quiz" role="dialog" aria-label="Match the quote">' +
        '<div class="cx-kicker">MATCH THE QUOTE</div>' +
        '<p class="cx-sub">Tap a saying, then tap who said it.</p>' +
        '<div class="cx-quotes"></div>' +
        '<div class="cx-names"></div>' +
        '<div class="cx-quiz-actions">' +
          '<button type="button" class="cx-btn" data-act="skip">Skip</button>' +
          '<button type="button" class="cx-btn cx-btn-primary" data-act="check" disabled>Check answers</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var quotesEl = overlay.querySelector('.cx-quotes');
    var namesEl = overlay.querySelector('.cx-names');
    var checkBtn = overlay.querySelector('[data-act="check"]');
    var actionsEl = overlay.querySelector('.cx-quiz-actions');

    function renderRows() {
      quotesEl.innerHTML = quotes.map(function (q) {
        var matched = picks.hasOwnProperty(q.i);
        return '<button type="button" class="cx-chip cx-quote' +
          (selectedQuote === q.i ? ' is-sel' : '') + (matched ? ' is-matched' : '') +
          '" data-i="' + q.i + '">“' + esc(q.text) + '”' +
          (matched ? ' <span class="cx-matched-name">— ' + esc(names[picks[q.i]].who) + '</span>' : '') +
          '</button>';
      }).join('');
      namesEl.innerHTML = names.map(function (n, ni) {
        var used = Object.keys(picks).some(function (k) { return picks[k] === ni; });
        return '<button type="button" class="cx-chip cx-name' + (used ? ' is-used' : '') +
          '" data-ni="' + ni + '"' + (used ? ' disabled' : '') + '>' + esc(n.who) + '</button>';
      }).join('');
      checkBtn.disabled = Object.keys(picks).length !== quotes.length;
    }
    renderRows();

    quotesEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.cx-quote');
      if (!btn || revealed) return;
      var i = Number(btn.dataset.i);
      if (picks.hasOwnProperty(i)) { delete picks[i]; renderRows(); return; }
      selectedQuote = i;
      renderRows();
    });
    namesEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.cx-name');
      if (!btn || revealed || btn.disabled || selectedQuote === null) return;
      picks[selectedQuote] = Number(btn.dataset.ni);
      selectedQuote = null;
      renderRows();
    });

    function reveal() {
      revealed = true;
      var correctCount = 0;
      quotesEl.innerHTML = quotes.map(function (q) {
        var pickedName = picks.hasOwnProperty(q.i) ? names[picks[q.i]].who : null;
        var isRight = pickedName === q.who;
        if (isRight) correctCount++;
        return (
          '<div class="cx-reveal-row' + (pickedName ? (isRight ? ' is-right' : ' is-wrong') : ' is-skipped') + '">' +
            '<div class="cx-reveal-quote">“' + esc(q.text) + '”</div>' +
            '<div class="cx-reveal-who">— ' + esc(q.who) + '</div>' +
            (pickedName && !isRight ? '<div class="cx-reveal-note">You matched: ' + esc(pickedName) + '</div>' : '') +
            '<div class="cx-react" data-qi="' + q.i + '">' +
              '<button type="button" class="cx-react-btn" data-react="agree" title="Agree with this">\u{1F44D}</button>' +
              '<button type="button" class="cx-react-btn" data-react="disagree" title="Disagree with this">\u{1F44E}</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
      namesEl.innerHTML = '';
      actionsEl.innerHTML =
        '<div class="cx-score">' + correctCount + ' / ' + quotes.length + ' matched</div>' +
        '<div class="cx-row">' +
          '<a class="cx-more" href="' + civix101Href() + '">More at CiViX 101 &#8594;</a>' +
          '<button type="button" class="cx-btn cx-btn-primary" data-act="done">Continue</button>' +
        '</div>';

      overlay.querySelectorAll('.cx-react').forEach(function (row) {
        row.addEventListener('click', function (e) {
          var b = e.target.closest('.cx-react-btn');
          if (!b) return;
          var qi = Number(row.dataset.qi);
          var q = quotes[qi];
          row.querySelectorAll('.cx-react-btn').forEach(function (x) { x.classList.remove('is-on'); });
          b.classList.add('is-on');
          state.reactions.push({ id: deck.id + ':' + qi, who: q.who, agree: b.dataset.react === 'agree', at: Date.now() });
          if (state.reactions.length > 200) state.reactions = state.reactions.slice(-200);
          saveState(state);
        });
      });
    }

    overlay.addEventListener('click', function (e) {
      if (revealed) {
        if (e.target.closest('[data-act="done"]')) dismiss(overlay);
        return;
      }
      if (e.target.closest('[data-act="skip"]') || e.target.closest('[data-act="check"]')) reveal();
    });
  }

  function showNow() {
    if (showing) return;
    showing = true;
    var state = loadState();
    var next = pickNext(state);
    if (next.type === 'fact') {
      state.seenFacts.push(next.item.id);
      renderFact(next.item);
    } else {
      state.seenDecks.push(next.item.id);
      renderQuiz(next.item, state);
    }
    state.lastShownAt = Date.now();
    saveState(state);
  }

  function maybeShow() {
    if (showing) return;
    var state = loadState();
    if (Date.now() - state.lastShownAt < COOLDOWN_MS) return;
    if (Math.random() > SHOW_CHANCE) return;
    showNow();
  }

  // Called from a real network/AI wait elsewhere in the app (fetching
  // headlines, drafting a call script, building the top-3 digest, etc.) to
  // give the citizen something to read instead of a bare spinner. Always a
  // fact — never the quiz, which asks for real attention a mid-load
  // moment shouldn't demand — and skips the random SHOW_CHANCE gate since
  // the caller already knows a wait is actually happening, but still
  // honors the cooldown so a wait that follows close behind another popup
  // (ambient or another wait) doesn't stack a second one on top of it.
  function showDuringWait() {
    if (showing) return;
    var state = loadState();
    if (Date.now() - state.lastShownAt < COOLDOWN_MS) return;
    showing = true;
    var unseenFacts = FACTS.filter(function (f) { return state.seenFacts.indexOf(f.id) === -1; });
    if (!unseenFacts.length) { state.seenFacts = []; unseenFacts = FACTS.slice(); }
    var f = unseenFacts[Math.floor(Math.random() * unseenFacts.length)];
    state.seenFacts.push(f.id);
    state.lastShownAt = Date.now();
    saveState(state);
    renderFact(f);
  }

  // ---- Direct access (CiViX 101) -----------------------------------------
  // Opens a specific fact or deck on demand, bypassing the cooldown/chance
  // gate that governs the sprinkled pop-ups — a citizen who came here on
  // purpose shouldn't be rate-limited. Still marks it seen, so the random
  // sprinkle elsewhere doesn't immediately repeat what they just reviewed.
  function playFact(id) {
    if (showing) return;
    var f = null;
    for (var i = 0; i < FACTS.length; i++) if (FACTS[i].id === id) f = FACTS[i];
    if (!f) return;
    showing = true;
    var state = loadState();
    if (state.seenFacts.indexOf(id) === -1) state.seenFacts.push(id);
    state.lastShownAt = Date.now();
    saveState(state);
    renderFact(f);
  }
  function playDeck(id) {
    if (showing) return;
    var d = null;
    for (var i = 0; i < DECKS.length; i++) if (DECKS[i].id === id) d = DECKS[i];
    if (!d) return;
    showing = true;
    var state = loadState();
    if (state.seenDecks.indexOf(id) === -1) state.seenDecks.push(id);
    state.lastShownAt = Date.now();
    saveState(state);
    renderQuiz(d, state);
  }

  window.CivicsEngine = {
    maybeShow: maybeShow,
    showNow: showNow,
    showDuringWait: showDuringWait,
    playFact: playFact,
    playDeck: playDeck,
    facts: FACTS.map(function (f) { return { id: f.id, title: f.title, body: f.body }; }),
    decks: DECKS.map(function (d) { return { id: d.id, count: d.quotes.length }; })
  };
})();
