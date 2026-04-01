/**
 * GalaxyQuest – Narrative Registration Prologue
 *
 * Guides a newly registered player through a cinematic onboarding sequence:
 *   Phase 1 – Cinematic intro text (typewriter reveal)
 *   Phase 2 – Faction selection (six herald cards + confirmation)
 *   Phase 3 – Faction-specific prolog story
 *   Phase 4 – Transition text with dynamic colony name → calls onComplete()
 *
 * Usage (from auth.js after successful registration):
 *   window.GQProlog.show({
 *     username:   'Commander',
 *     colonyName: data.colony_name,   // from API – never hardcoded
 *     onComplete: async () => { await startGameShell(); },
 *   });
 *
 * The colony name comes from the database (colonies.name), so it reflects
 * whatever name was generated for this player's homeworld.
 */
(function () {
  'use strict';

  // ─── Faction data ──────────────────────────────────────────────────────────

  const FACTIONS = [
    {
      id: 'vor_tak',
      emoji: '🦎',
      name: "Vor'Tak",
      subtitle: 'Der Schildkreis',
      herald: "Sharr'Keth",
      heraldRole: 'Taktischer Diplomat',
      color: '#c0392b',
      promise: '„Wir sichern deine Grenzen."',
      demand: '„Öffne uns den Korridor."',
      confirmQuote: 'Sharr\'Keth tritt vor. „Gouverneur", sagt er knapp, „ich hoffe, ihr seid ein vernünftiger Mensch." Er streckt die Hand aus.',
      story: [
        'Sharr\'Keth betritt dein Büro wie eine Kaserne.',
        'Er wirft keine Dokumente auf den Tisch. Er stellt keine Fragen. Er legt eine einzige Datentafel hin, auf der drei Koordinaten leuchten – die drei FTL-Korridore, die durch deine Welt laufen.',
        '„Vor sieben Zyklen", sagt er, „haben wir diese Position für unbedeutend gehalten. Das war ein Fehler." Er schenkt dir keinen Blick zu lang. „Euer Vorgänger hat die Verteidigung vernachlässigt. Ich brauche zu wissen, ob ihr das auch tun werdet."',
        'Du weißt instinktiv, dass es keine richtige Antwort gibt – nur eine, die er respektiert.',
        'Der Schildkreis bietet dir keine Freundschaft. Er bietet dir etwas Wertvolleres: Schutz, solange du nützlich bist.',
        '„Zeigen Sie mir Ihre Verteidigungsanlagen, Gouverneur. Dann reden wir weiter."',
      ],
      mission: 'Inspiziere die Patrouillenkorvetten in deinem Orbit und melde Sharr\'Keth den Zustand ihrer Waffensysteme.',
    },
    {
      id: 'syl_nar',
      emoji: '🐙',
      name: "Syl'Nar",
      subtitle: 'Der Lichtbund',
      herald: "Tael'Mii",
      heraldRole: 'Junger Priester',
      color: '#e67e22',
      promise: '„Wir ernähren deine Bevölkerung."',
      demand: '„Bleibt unabhängig von den Militärs."',
      confirmQuote: 'Tael\'Mii wartet nicht an der Tür – er steht auf dem Platz davor, einen dampfenden Behälter in Händen. Er lächelt. Aber sein Lächeln enthält mehr Kummer als Freude. „Nehmt die Hand?", fragt er leise.',
      story: [
        'Tael\'Mii erscheint nicht an der Tür – er wartet bereits auf dem Platz vor deinem Amtsgebäude, die Hände um einen dampfenden Behälter geschlossen.',
        'Er ist jünger, als du erwartet hättest. Er lächelt, als er dich sieht, aber sein Lächeln enthält mehr Kummer als Freude.',
        '„Ich habe mitgebracht, was wir haben", sagt er. „Es ist nicht viel. Aber für deine Menschen reicht es für eine Woche." Er hält dir den Behälter hin. „Das ist keine Verhandlung. Das ist einfach… richtig."',
        'Der Lichtbund tauscht keine Güter. Er kultiviert Vertrauen – langsam, beständig, wie ein Baum, der Wurzeln schlägt, lange bevor er Früchte trägt.',
        '„Wenn ihr wollt, können wir morgen über die Hydroponik-Anlagen sprechen. Aber zuerst: Seid ihr gut hier angekommen?"',
      ],
      mission: 'Prüfe die Nahrungsmittelversorgung deiner Kolonie und finde heraus, wie viele Wochen euer aktueller Vorrat reicht.',
    },
    {
      id: 'aereth',
      emoji: '🔥',
      name: 'Aereth',
      subtitle: 'Der Kernrat',
      herald: "Vel'Saar",
      heraldRole: 'Energiemanifest',
      color: '#2980b9',
      promise: '„Wir verdoppeln deine Energieausbeute."',
      demand: '„Lass uns das Mineral untersuchen."',
      confirmQuote: 'Vel\'Saar schwebt in dein Büro. Kein Schritt, kein Geräusch. Holographische Sensorlinien scannen die Wände, bevor du sprechen kannst. „Seid ihr bereit, Erkenntnisse zu teilen?"',
      story: [
        'Vel\'Saar ist keine Person im üblichen Sinne. Was in dein Büro schwebt, ist ein Energiemuster in einer Containerhülle – pulsierend, ungeduldig, zu groß für den Raum.',
        'Noch bevor du sprechen kannst, beginnt es zu analysieren. Holographische Sensorlinien scannen die Wände, den Boden, deinen Schreibtisch.',
        '„Das Mineral unter eurer Erde ist in keinem unserer Kataloge. Unmöglich und dennoch real." Die Stimme klingt wie Strom durch Metall. „Ihr habt keine Ahnung, was ihr besitzt. Das ist akzeptabel – noch."',
        'Aereth respektiert keine Hierarchien. Es respektiert Erkenntnisfortschritt. Solange du dem Kernrat erlaubst zu forschen, wirst du ihre Werkzeuge nutzen dürfen.',
        '„Zeig mir eure Abbauanlagen. Ich werde dir erklären, warum das Mineral wichtiger ist, als ihr glaubt."',
      ],
      mission: 'Öffne die Bergbau-Übersicht und bestimme die aktuelle tägliche Förderrate des unbekannten Minerals.',
    },
    {
      id: 'kryl_tha',
      emoji: '🦗',
      name: "Kryl'Tha",
      subtitle: 'Die Schwarmkommandantur',
      herald: "Zhaa'Kirr",
      heraldRole: 'Schwarm-Delegierte',
      color: '#27ae60',
      promise: '„Wir sichern deine Kolonie."',
      demand: '„Gib uns Raum für unsere Brut."',
      confirmQuote: 'Zhaa\'Kirr kommt nicht allein. Vier Sicherheitskräfte flankieren sie, reglos wie Statuen. Ihre sechsfachen Augen fixieren dich mit absoluter Präzision. „Was sagt ihr?"',
      story: [
        'Zhaa\'Kirr kommt nicht allein. Hinter ihr stehen vier Sicherheitskräfte in voller Rüstung – lautlos, reglos, wie Statuen.',
        'Sie selbst ist kleiner als du erwartest, aber ihre Augen – sechsfach, facettiert – fixieren dich mit einer Präzision, die kein anderes Wesen erreicht. Sie klingt nicht feindlich. Sie klingt absolut sicher.',
        '„Drei Piratengruppen haben in den letzten zwei Monaten eure Außenposten sondiert. Euer Vorgänger hat es ignoriert. Wir nicht." Pause. „Wir können das Problem lösen. Dafür brauchen wir Raum. Land. Nicht für immer. Nur für jetzt."',
        'Die Schwarmkommandantur verhandelt nicht mit Emotionen. Sie verhandelt mit Realitäten. Du hast Feinde. Du hast keine Armee. Sie haben beides.',
        '„Was sagt ihr?"',
      ],
      mission: 'Rufe die Sicherheitsprotokolle deiner Außenposten auf und bewerte die aktuelle Bedrohungslage.',
    },
    {
      id: 'zhareen',
      emoji: '💎',
      name: 'Zhareen',
      subtitle: 'Der Archivrat',
      herald: "Kael'Thin",
      heraldRole: 'Uralter Archivar',
      color: '#8e44ad',
      promise: '„Wir öffnen dir unsere Archive."',
      demand: '„Hilf uns, das Riss-Ereignis zu verstehen."',
      confirmQuote: 'Kael\'Thin bewegt sich durch dein Büro, als würde er sich an einen Ort erinnern. Sein Blick ruht schließlich auf dir. „Falls ihr das wissen wollt."',
      story: [
        'Kael\'Thin ist alt – älter als jeder andere Bewohner dieser Welt, vielleicht älter als die Siedlung selbst.',
        'Er bewegt sich durch dein Büro, als würde er sich an einen Ort erinnern, an dem er schon einmal gewesen ist. Sein Blick gleitet über die Wände, die Karten, das Fenster zum Orbit – und bleibt schließlich auf dir ruhen.',
        '„Das Mineral, das ihr hier gefunden habt –" Er pausiert, als suche er nach einem anderen Namen. „Es existiert in unseren Archiven unter einer anderen Bezeichnung. Älter als die Konvergenz. Älter als Sprache." Er hält inne. „Ihr habt eine Anomalie unter euren Füßen, Gouverneur. Und ich bin der einzige, der euch sagen kann, was sie bedeutet. Falls ihr das wissen wollt."',
        'Der Archivrat gibt nichts umsonst. Aber er gibt ehrlich. Wissen gegen Zugang. Das ist sein Handel.',
      ],
      mission: 'Schalte das Archivdatenbank-Terminal im Gouverneursgebäude frei und rufe die ältesten verfügbaren Karten auf.',
    },
    {
      id: 'vel_ar',
      emoji: '🌫️',
      name: "Vel'Ar",
      subtitle: 'Der Schattenkreis',
      herald: "Nira'Vel",
      heraldRole: 'Maskierte Agentin',
      color: '#546e7a',
      promise: '„Wir zeigen dir, was die anderen verbergen."',
      demand: '„Frag nicht, woher wir das wissen."',
      confirmQuote: 'Du hörst sie, bevor du sie siehst. Nira\'Vel sitzt in der Ecke deines Büros. Du weißt nicht, wie lange sie dort war. „Lies das. Dann entscheide."',
      story: [
        'Du hörst sie, bevor du sie siehst – ein leises Geräusch, das du zunächst für Wind hältst.',
        'Sie sitzt in der Ecke deines Büros. Du weißt nicht, wie lange sie dort war.',
        '„Keine Sorge", sagt Nira\'Vel, ohne die Maske abzunehmen. „Ich bin die Einzige hier, die nicht versucht, dich zu kaufen." Ein kurzes, trockenes Lachen. „Die anderen haben euch alle Angebote gemacht. Schutz, Nahrung, Energie, Sicherheit, Wissen." Pause. „Ich zeige dir etwas anderes: Was sie euch verschwiegen haben."',
        'Sie legt eine Datentafel auf den Tisch – unverschlüsselt, sofort lesbar. Die ersten Zeilen lassen dich innehalten.',
        'Der Schattenkreis will keine Loyalität. Er will ein Netzwerk. Und du bist der nächste Knoten.',
        '„Lies das. Dann entscheide, ob du wissen willst, was als Nächstes kommt."',
      ],
      mission: 'Öffne die Datentafel von Nira\'Vel und analysiere, welche Informationen über die anderen Gesandten sie enthält.',
    },
  ];

  // ─── Cinematic intro lines ─────────────────────────────────────────────────

  const INTRO_LINES = [
    'Es gibt keine neutrale Ecke im Universum.',
    'Jede Welt, jeder Lichtweg zwischen den Sternen, jede Atemluft unter einem fremden Himmel gehört jemandem – oder wird bald jemandem gehören.',
    'Du hast soeben eine Welt geerbt, die niemand haben wollte.',
    'Das wird sich ändern.',
  ];

  // ─── Module state ──────────────────────────────────────────────────────────

  let _username = 'Commander';
  let _colonyName = '';
  let _onComplete = null;
  let _selectedFaction = null;

  // ─── Utility helpers ──────────────────────────────────────────────────────

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function prologLog(msg) {
    try {
      if (window.GQLog && typeof window.GQLog.info === 'function') {
        window.GQLog.info('[prolog]', msg);
      }
    } catch (_) { /* silent */ }
  }

  // ─── API helpers ──────────────────────────────────────────────────────────

  async function fetchCsrf() {
    try {
      const r = await fetch('api/auth.php?action=csrf', { credentials: 'same-origin' });
      const d = await r.json();
      return String(d && d.token ? d.token : '');
    } catch (_) {
      return '';
    }
  }

  async function saveFactionChoice(factionId) {
    try {
      const csrf = await fetchCsrf();
      const r = await fetch('api/game.php?action=set_ftl_drive', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ ftl_drive_type: factionId }),
      });
      const d = await r.json();
      prologLog('faction saved: ' + factionId + ' → ' + String(d && d.message ? d.message : ''));
    } catch (err) {
      prologLog('faction save failed (non-fatal): ' + String(err && err.message ? err.message : err));
    }
  }

  // ─── DOM building ─────────────────────────────────────────────────────────

  function getSection() {
    return document.getElementById('prolog-section');
  }

  /**
   * Inject all phase HTML into #prolog-section and wire up event listeners.
   * Called once per show() invocation so state is always fresh.
   */
  function buildDOM() {
    const section = getSection();
    if (!section) return;

    section.innerHTML = [
      // ── Phase 1: Cinematic intro ──────────────────────────────────────────
      '<div id="prolog-p1" class="prolog-phase" role="region" aria-label="Einleitung" hidden>',
        '<div class="prolog-cinematic">',
          '<div id="prolog-lines" class="prolog-typewriter" aria-live="polite" aria-atomic="false"></div>',
          '<button id="prolog-next1" class="prolog-next hidden" type="button">→ Beginne deine Geschichte</button>',
        '</div>',
        '<button id="prolog-skip" class="prolog-skip" type="button">Überspringen</button>',
      '</div>',

      // ── Phase 2: Faction selection ────────────────────────────────────────
      '<div id="prolog-p2" class="prolog-phase" role="region" aria-label="Fraktionswahl" hidden>',
        '<div class="prolog-phase2-inner">',
          '<p class="prolog-headline">SECHS GESANDTE STEHEN VOR DEINER TÜR</p>',
          '<p class="prolog-intro-quote">',
            'Noch bevor du deinen ersten Befehl erteilen kannst, wartet jeder von ihnen auf dich.',
            ' Sie alle wissen genau, was deine Welt bedeutet.',
          '</p>',
          '<div id="prolog-cards" class="prolog-faction-cards" role="list"></div>',
        '</div>',
        '<div id="prolog-confirm" class="prolog-confirm" aria-live="polite">',
          '<p id="prolog-confirm-quote" class="prolog-confirm-quote"></p>',
          '<div class="prolog-confirm-btns">',
            '<button id="prolog-confirm-yes" class="btn btn-primary" type="button">Ich nehme seine Hand.</button>',
            '<button id="prolog-confirm-back" class="btn btn-secondary" type="button">Zurück</button>',
          '</div>',
        '</div>',
      '</div>',

      // ── Phase 3: Faction-specific prolog ─────────────────────────────────
      '<div id="prolog-p3" class="prolog-phase" role="region" aria-label="Fraktionsprolog" hidden>',
        '<div class="prolog-phase3-inner">',
          '<div id="prolog-story" class="prolog-story" aria-live="polite"></div>',
          '<p id="prolog-mission" class="prolog-first-mission"></p>',
          '<button id="prolog-next3" class="prolog-next" type="button" style="margin-top:1.5rem">Weiter →</button>',
        '</div>',
      '</div>',

      // ── Phase 4: Transition ───────────────────────────────────────────────
      '<div id="prolog-p4" class="prolog-phase" role="region" aria-label="Übergang" hidden>',
        '<div class="prolog-phase4-inner">',
          '<div id="prolog-transition-text" class="prolog-transition-text" aria-live="polite"></div>',
          '<button id="prolog-launch" class="btn btn-primary prolog-launch" type="button">→ Zur Lageübersicht</button>',
        '</div>',
      '</div>',
    ].join('');

    buildFactionCards();
    wireListeners();
  }

  function buildFactionCards() {
    const container = document.getElementById('prolog-cards');
    if (!container) return;

    container.innerHTML = FACTIONS.map((f) => [
      '<button class="prolog-card" role="listitem"',
      ' data-faction-id="' + esc(f.id) + '"',
      ' style="--card-color:' + esc(f.color) + '"',
      ' type="button"',
      ' aria-label="Fraktion ' + esc(f.name) + ' wählen"',
      '>',
        '<div class="prolog-card-icon" aria-hidden="true">' + f.emoji + '</div>',
        '<div class="prolog-card-name">' + esc(f.name) + '</div>',
        '<div class="prolog-card-subtitle">' + esc(f.subtitle) + '</div>',
        '<div class="prolog-card-herald">' + esc(f.herald) + ' · ' + esc(f.heraldRole) + '</div>',
        '<div class="prolog-card-promise">' + esc(f.promise) + '</div>',
        '<div class="prolog-card-demand">' + esc(f.demand) + '</div>',
      '</button>',
    ].join('')).join('');

    container.querySelectorAll('.prolog-card').forEach((card) => {
      card.addEventListener('click', onFactionCardClick);
    });
  }

  function wireListeners() {
    document.getElementById('prolog-skip')?.addEventListener('click', () => showPhase(2));
    document.getElementById('prolog-next1')?.addEventListener('click', () => showPhase(2));
    document.getElementById('prolog-confirm-yes')?.addEventListener('click', onConfirmFaction);
    document.getElementById('prolog-confirm-back')?.addEventListener('click', () => {
      document.getElementById('prolog-confirm')?.classList.remove('is-visible');
      _selectedFaction = null;
    });
    document.getElementById('prolog-next3')?.addEventListener('click', () => showPhase(4));
    document.getElementById('prolog-launch')?.addEventListener('click', completeProlog);
  }

  // ─── Phase transitions ────────────────────────────────────────────────────

  const PHASE_IDS = ['prolog-p1', 'prolog-p2', 'prolog-p3', 'prolog-p4'];

  function showPhase(n) {
    PHASE_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.hidden = true;
      el.classList.remove('is-active');
    });

    const targetId = PHASE_IDS[n - 1];
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (!target) return;

    target.hidden = false;
    // Force reflow so the CSS animation fires even on re-entry.
    void target.offsetWidth;
    target.classList.add('is-active');
    prologLog('phase ' + n);

    if (n === 1) startCinematic();
    else if (n === 3) populateFactionProlog();
    else if (n === 4) populateTransition();
  }

  // ─── Phase 1 – Cinematic ──────────────────────────────────────────────────

  function startCinematic() {
    const container = document.getElementById('prolog-lines');
    if (!container) return;
    container.innerHTML = '';

    const lineEls = INTRO_LINES.map((text) => {
      const span = document.createElement('span');
      span.className = 'prolog-typewriter-line';
      span.textContent = text;
      container.appendChild(span);
      return span;
    });

    const BASE_DELAY_MS = 400;
    const LINE_INTERVAL_MS = 950;
    lineEls.forEach((el, i) => {
      setTimeout(() => el.classList.add('is-visible'), BASE_DELAY_MS + i * LINE_INTERVAL_MS);
    });

    const showNextAt = BASE_DELAY_MS + (lineEls.length - 1) * LINE_INTERVAL_MS + 800;
    setTimeout(() => {
      document.getElementById('prolog-next1')?.classList.remove('hidden');
    }, showNextAt);
  }

  // ─── Phase 2 – Faction selection ──────────────────────────────────────────

  function onFactionCardClick(e) {
    const btn = e.currentTarget;
    const factionId = btn.dataset.factionId;
    const faction = FACTIONS.find((f) => f.id === factionId);
    if (!faction) return;

    _selectedFaction = faction;

    const confirmQuote = document.getElementById('prolog-confirm-quote');
    if (confirmQuote) confirmQuote.textContent = faction.confirmQuote;

    document.getElementById('prolog-confirm')?.classList.add('is-visible');
    document.getElementById('prolog-confirm-yes')?.focus();
  }

  async function onConfirmFaction() {
    if (!_selectedFaction) return;

    document.getElementById('prolog-confirm')?.classList.remove('is-visible');

    // Save faction choice – fire-and-forget: the player advances to phase 3
    // immediately while the API call completes in the background.
    saveFactionChoice(_selectedFaction.id);

    showPhase(3);
  }

  // ─── Phase 3 – Faction prolog ──────────────────────────────────────────────

  function populateFactionProlog() {
    if (!_selectedFaction) return;

    const storyEl = document.getElementById('prolog-story');
    if (storyEl) {
      storyEl.style.setProperty('--faction-accent', _selectedFaction.color);
      storyEl.style.borderLeftColor = _selectedFaction.color;
      storyEl.innerHTML = _selectedFaction.story.map((p) => '<p>' + esc(p) + '</p>').join('');
    }

    const missionEl = document.getElementById('prolog-mission');
    if (missionEl) {
      missionEl.textContent = '⚡ Erster Auftrag: ' + _selectedFaction.mission;
    }
  }

  // ─── Phase 4 – Transition ─────────────────────────────────────────────────

  function populateTransition() {
    // _colonyName comes from the database (colonies.name) – never hardcoded.
    const colony = _colonyName || 'deine Welt';
    const factionName = _selectedFaction ? _selectedFaction.name : 'der Gesandte';

    const lines = [
      factionName + ' ist gegangen.',
      'Du stehst am Fenster des Gouverneursgebäudes und siehst '
        + colony
        + ' zum ersten Mal wirklich: die Siedlung unter dir, die Patrouillenkorvetten im niedrigen Orbit, die Berge am Horizont.',
      'Irgendwo hinter diesem Horizont lauern Piraten. Irgendwo dort oben beobachten fünf weitere Gesandte deine Entscheidung.',
      'Dein Terminal blinkt. Eine Nachricht: „'
        + _username
        + ' – die wöchentliche Lageübersicht steht bereit. Ihr erster Tag beginnt."',
    ];

    const el = document.getElementById('prolog-transition-text');
    if (el) {
      el.innerHTML = lines.map((l) => '<p>' + esc(l) + '</p>').join('');
    }
  }

  // ─── Complete ─────────────────────────────────────────────────────────────

  function completeProlog() {
    prologLog('complete');
    const section = getSection();
    if (section) {
      section.classList.add('hidden');
      section.setAttribute('aria-hidden', 'true');
    }
    try {
      if (typeof _onComplete === 'function') _onComplete();
    } catch (err) {
      prologLog('onComplete error: ' + String(err && err.message ? err.message : err));
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Show the narrative registration prologue.
   *
   * @param {object}   opts
   * @param {string}   opts.username    - Commander name (from registration response)
   * @param {string}   opts.colonyName  - Colony name from colonies.name in the DB
   * @param {Function} opts.onComplete  - Called after the player clicks "Zur Lageübersicht"
   */
  function show(opts) {
    opts = opts || {};
    _username = String(opts.username || 'Commander');
    _colonyName = String(opts.colonyName || '');
    _onComplete = typeof opts.onComplete === 'function' ? opts.onComplete : null;
    _selectedFaction = null;

    const section = getSection();
    if (!section) {
      prologLog('prolog-section not found – calling onComplete directly');
      if (_onComplete) _onComplete();
      return;
    }

    prologLog('show username=' + _username + ' colony=' + (_colonyName || '(empty)'));
    buildDOM();
    section.classList.remove('hidden');
    section.setAttribute('aria-hidden', 'false');
    showPhase(1);
  }

  // Expose the public API; also expose internals under _test for unit tests.
  window.GQProlog = {
    show,
    // Internal helpers exposed for testing only – not part of the public API.
    _test: {
      FACTIONS,
      INTRO_LINES,
      esc,
      getFactionById: (id) => FACTIONS.find((f) => f.id === id),
      getColonyName: () => _colonyName,
      getUsername: () => _username,
      getSelectedFaction: () => _selectedFaction,
    },
  };
})();
