/**
 * GalaxyQuest – Narrative Registration Prologue  (two-step flow)
 *
 * New player onboarding sequence:
 *   Phase 1 – Cinematic intro text (typewriter reveal)
 *   Phase 2 – Faction selection (six herald cards + confirmation)
 *   Phase 3 – Colony generation loading → faction story reveal
 *              (api/auth.php?action=register_prepare creates the provisional
 *               account + homeworld; colony name comes from the database)
 *   Phase 4 – Commander credentials form (username / e-mail / password)
 *   Phase 5 – Transition text (colony name + commander name) → launch
 *              (api/auth.php?action=register_complete finalises the account,
 *               then onComplete() starts the game)
 *
 * Usage (from auth.js when the "Begin" button is clicked):
 *   window.GQProlog.show({
 *     onComplete: async () => { await startGameShell(); },
 *   });
 *
 * username and colonyName are NOT passed in – they are obtained from API
 * calls made inside the prolog so the colony name always reflects the
 * actual DB value for the generated homeworld.
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

  let _prologToken     = '';  // set by register_prepare response
  let _colonyName      = '';  // set by register_prepare response (from DB)
  let _username        = '';  // set by register_complete response
  let _onComplete      = null;
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

  /**
   * Step 1: create provisional account + homeworld via the API.
   * Sets _prologToken and _colonyName on success.
   * Called fire-and-forget from onConfirmFaction(); phase 3 shows the loading
   * overlay immediately, and revealFactionStory() is called when done.
   */
  async function registerPrepare(factionId) {
    try {
      const csrf = await fetchCsrf();
      const r = await fetch('api/auth.php?action=register_prepare', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ faction_id: factionId }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Koloniengenerierung fehlgeschlagen.');
      _prologToken = String(d.prolog_token || '');
      _colonyName  = String(d.colony_name  || '');
      revealFactionStory();
    } catch (err) {
      showPhase3Error(String(err && err.message ? err.message : err));
    }
  }

  /**
   * Step 2: finalise the account with the commander's chosen credentials.
   * Sets _username on success and resolves with the API response data.
   * Registration is passwordless – a one-time login link is sent by e-mail.
   */
  async function registerComplete(username, email, remember) {
    const csrf = await fetchCsrf();
    const r = await fetch('api/auth.php?action=register_complete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ prolog_token: _prologToken, username, email, remember }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'Registrierung fehlgeschlagen.');
    _username = String((d.user && d.user.username) ? d.user.username : username);
    return d;
  }

  // ─── Commander name suggestion ───────────────────────────────────────────

  const _NAME_POOLS = {
    vor_tak:  ['Keth', 'Sarr', 'Dur', 'Vor', 'Ash', 'Rakh'],
    syl_nar:  ['Lun', 'Mera', 'Vel', 'Thar', 'Sol', 'Nael'],
    aereth:   ['Flux', 'Arc', 'Kir', 'Sol', 'Node', 'Data'],
    kryl_tha: ['Zhaa', 'Hive', 'Swarm', 'Brood', 'Kyr'],
    zhareen:  ['Zha', 'Kron', 'Lore', 'Vault', 'Arc'],
    vel_ar:   ['Nira', 'Veil', 'Shadow', 'Dark', 'Null'],
  };

  /** Generate a faction-themed commander name suggestion. */
  function suggestCommanderName() {
    const pool = _selectedFaction ? (_NAME_POOLS[_selectedFaction.id] || ['Cmdr']) : ['Star'];
    const prefix = pool[Math.floor(Math.random() * pool.length)];
    return prefix + '_' + (Math.floor(1000 + Math.random() * 9000));
  }

  // ─── DOM building ─────────────────────────────────────────────────────────

  function getSection() {
    return document.getElementById('prolog-section');
  }

  function buildDOM() {
    const section = getSection();
    if (!section) return;

    section.innerHTML = [
      // ── Phase 1: Cinematic intro ──────────────────────────────────────────
      '<div id="prolog-p1" class="prolog-phase" role="region" aria-label="Einleitung" hidden>',
        '<div class="prolog-cinematic">',
          '<div id="prolog-lines" class="prolog-typewriter" aria-live="polite" aria-atomic="false"></div>',
          '<button id="prolog-next1" class="prolog-next hidden" type="button">\u2192 Beginne deine Geschichte</button>',
        '</div>',
        '<button id="prolog-skip" class="prolog-skip" type="button">\u00dcberspringen</button>',
      '</div>',

      // ── Phase 2: Faction selection ────────────────────────────────────────
      '<div id="prolog-p2" class="prolog-phase" role="region" aria-label="Fraktionswahl" hidden>',
        '<div class="prolog-phase2-inner">',
          '<p class="prolog-headline">SECHS GESANDTE STEHEN VOR DEINER T\u00dcR</p>',
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
            '<button id="prolog-confirm-back" class="btn btn-secondary" type="button">Zur\u00fcck</button>',
          '</div>',
        '</div>',
      '</div>',

      // ── Phase 3: Loading overlay then faction story ───────────────────────
      '<div id="prolog-p3" class="prolog-phase" role="region" aria-label="Fraktionsprolog" hidden>',
        '<div id="prolog-generating" class="prolog-generating">',
          '<div class="prolog-spinner" aria-hidden="true"></div>',
          '<p class="prolog-generating-text" aria-live="polite">Heimatwelt wird generiert\u2026</p>',
          '<p id="prolog-generating-error" class="prolog-generating-error hidden" role="alert"></p>',
          '<button id="prolog-generating-retry" class="btn btn-secondary btn-sm hidden" type="button">',
            '\u2190 Zur\u00fcck zur Fraktionswahl',
          '</button>',
        '</div>',
        '<div id="prolog-story-inner" class="prolog-phase3-inner hidden">',
          '<div id="prolog-story" class="prolog-story" aria-live="polite"></div>',
          '<p id="prolog-mission" class="prolog-first-mission"></p>',
          '<button id="prolog-next3" class="prolog-next" type="button" style="margin-top:1.5rem">Weiter \u2192</button>',
        '</div>',
      '</div>',

      // ── Phase 4: Commander credentials (email + optional name, no password) ─
      '<div id="prolog-p4" class="prolog-phase" role="region" aria-label="Kommandant" hidden>',
        '<div class="prolog-credentials-inner">',
          '<p class="prolog-headline">KOMMANDANTENIDENTIT\u00c4T FESTLEGEN</p>',
          '<p class="prolog-credentials-intro">',
            'Hinterlasse deine Koordinaten.',
            ' Ein Einmal-Zugang folgt per E-Mail.',
          '</p>',
          '<div class="form-group">',
            '<label for="prolog-username">',
              'Kommandantenname ',
              '<span class="prolog-optional">(optional \u2013 wird automatisch generiert)</span>',
            '</label>',
            '<div class="prolog-name-row">',
              '<input id="prolog-username" type="text" autocomplete="username"',
              '       pattern="[A-Za-z0-9_]{3,32}" maxlength="32"',
              '       placeholder="Wird automatisch generiert" />',
              '<button id="prolog-name-regen" type="button"',
              '        class="prolog-regen-btn" title="Neuen Namen w\u00fcrfeln"',
              '        aria-label="Neuen Namen w\u00fcffeln">\ud83c\udfb2</button>',
            '</div>',
          '</div>',
          '<div class="form-group">',
            '<label for="prolog-email">E-Mail-Adresse</label>',
            '<input id="prolog-email" type="email" autocomplete="email"',
            '       placeholder="ihr@beispiel.de" />',
          '</div>',
          '<div class="form-group">',
            '<label class="prolog-remember-row">',
              '<input id="prolog-remember" type="checkbox" checked />',
              ' Angemeldet bleiben',
            '</label>',
          '</div>',
          '<button id="prolog-credentials-submit" type="button" class="prolog-next">',
            '\u2192 Identit\u00e4t best\u00e4tigen',
          '</button>',
          '<div id="prolog-credentials-error" class="form-error" aria-live="polite"></div>',
          '<div id="prolog-credentials-loading" class="prolog-credentials-loading hidden" aria-live="polite">',
            '<div class="prolog-spinner" aria-hidden="true"></div>',
            '<span>Registrierung l\u00e4uft\u2026</span>',
          '</div>',
        '</div>',
      '</div>',

      // ── Phase 5: Transition ───────────────────────────────────────────────
      '<div id="prolog-p5" class="prolog-phase" role="region" aria-label="\u00dcbergang" hidden>',
        '<div class="prolog-phase5-inner">',
          '<div id="prolog-transition-text" class="prolog-transition-text" aria-live="polite"></div>',
          '<button id="prolog-launch" class="btn btn-primary prolog-launch" type="button">',
            '\u2192 Zur Lage\u00fcbersicht',
          '</button>',
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
      ' aria-label="Fraktion ' + esc(f.name) + ' w\u00e4hlen"',
      '>',
        '<div class="prolog-card-icon" aria-hidden="true">' + f.emoji + '</div>',
        '<div class="prolog-card-name">' + esc(f.name) + '</div>',
        '<div class="prolog-card-subtitle">' + esc(f.subtitle) + '</div>',
        '<div class="prolog-card-herald">' + esc(f.herald) + ' \u00b7 ' + esc(f.heraldRole) + '</div>',
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

    document.getElementById('prolog-generating-retry')?.addEventListener('click', () => {
      _selectedFaction = null;
      _prologToken = '';
      _colonyName  = '';
      resetPhase3Loading();
      showPhase(2);
    });

    document.getElementById('prolog-next3')?.addEventListener('click', () => {
      // Skip the credentials form when the colony was pre-seeded via show()
      // (i.e. there is no API-issued prolog token – test/bypass mode).
      showPhase(_prologToken ? 4 : 5);
    });

    document.getElementById('prolog-name-regen')?.addEventListener('click', () => {
      const nameEl = document.getElementById('prolog-username');
      if (nameEl) nameEl.value = suggestCommanderName();
    });

    document.getElementById('prolog-credentials-submit')?.addEventListener('click', () => {
      submitCredentials();
    });

    // Allow Enter key to submit from the email input.
    ['prolog-username', 'prolog-email'].forEach((id) => {
      document.getElementById(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitCredentials(); }
      });
    });

    document.getElementById('prolog-launch')?.addEventListener('click', completeProlog);
  }

  // ─── Phase transitions ────────────────────────────────────────────────────

  const PHASE_IDS = ['prolog-p1', 'prolog-p2', 'prolog-p3', 'prolog-p4', 'prolog-p5'];

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
    void target.offsetWidth; // force reflow for CSS animation
    target.classList.add('is-active');
    prologLog('phase ' + n);

    if (n === 1) startCinematic();
    if (n === 4) prefillCommanderName();
    if (n === 5) populateTransition();
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

    const BASE_DELAY_MS    = 400;
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
    const btn     = e.currentTarget;
    const factionId = btn.dataset.factionId;
    const faction = FACTIONS.find((f) => f.id === factionId);
    if (!faction) return;

    _selectedFaction = faction;

    const confirmQuote = document.getElementById('prolog-confirm-quote');
    if (confirmQuote) confirmQuote.textContent = faction.confirmQuote;

    document.getElementById('prolog-confirm')?.classList.add('is-visible');
    document.getElementById('prolog-confirm-yes')?.focus();
  }

  /**
   * Faction confirmed: show phase 3 (loading state) immediately, then fire
   * register_prepare in the background.  The story is revealed once the API
   * returns and the colony name is known from the database.
   */
  function onConfirmFaction() {
    if (!_selectedFaction) return;
    document.getElementById('prolog-confirm')?.classList.remove('is-visible');
    showPhase(3);                             // synchronous – loading overlay shown immediately
    registerPrepare(_selectedFaction.id);    // async, fire-and-forget
  }

  // ─── Phase 3 – Loading / faction story ────────────────────────────────────

  function resetPhase3Loading() {
    const errEl    = document.getElementById('prolog-generating-error');
    const retryBtn = document.getElementById('prolog-generating-retry');
    const spinner  = document.querySelector('#prolog-generating .prolog-spinner');
    const textEl   = document.querySelector('.prolog-generating-text');
    const inner    = document.getElementById('prolog-story-inner');
    const gen      = document.getElementById('prolog-generating');

    if (errEl)    { errEl.textContent = ''; errEl.classList.add('hidden'); }
    if (retryBtn) retryBtn.classList.add('hidden');
    if (spinner)  spinner.classList.remove('hidden');
    if (textEl)   textEl.textContent = 'Heimatwelt wird generiert\u2026';
    if (inner)    inner.classList.add('hidden');
    if (gen)      gen.classList.remove('hidden');
  }

  /** Called by registerPrepare() on success: hide loading, show story. */
  function revealFactionStory() {
    const generating = document.getElementById('prolog-generating');
    const inner      = document.getElementById('prolog-story-inner');
    if (generating) generating.classList.add('hidden');
    if (inner) {
      inner.classList.remove('hidden');
      populateFactionProlog();
    }
  }

  /** Called by registerPrepare() on error: show message + retry button. */
  function showPhase3Error(msg) {
    const errEl    = document.getElementById('prolog-generating-error');
    const retryBtn = document.getElementById('prolog-generating-retry');
    const spinner  = document.querySelector('#prolog-generating .prolog-spinner');
    const textEl   = document.querySelector('.prolog-generating-text');

    if (spinner) spinner.classList.add('hidden');
    if (textEl)  textEl.textContent = 'Fehler bei der Generierung.';
    if (errEl)   { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    if (retryBtn) retryBtn.classList.remove('hidden');
    prologLog('register_prepare error: ' + msg);
  }

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
      missionEl.textContent = '\u26a1 Erster Auftrag: ' + _selectedFaction.mission;
    }
  }

  // ─── Phase 4 – Commander credentials ─────────────────────────────────────

  /** Pre-fill the commander-name input with a faction-themed suggestion. */
  function prefillCommanderName() {
    const nameEl = document.getElementById('prolog-username');
    if (nameEl && !nameEl.value) {
      nameEl.value = suggestCommanderName();
    }
  }

  async function submitCredentials() {
    const usernameEl = document.getElementById('prolog-username');
    const emailEl    = document.getElementById('prolog-email');
    const rememberEl = document.getElementById('prolog-remember');
    const errEl      = document.getElementById('prolog-credentials-error');
    const loadingEl  = document.getElementById('prolog-credentials-loading');
    const submitBtn  = document.getElementById('prolog-credentials-submit');

    if (errEl) errEl.textContent = '';

    const username = String(usernameEl ? usernameEl.value : '').trim();
    const email    = String(emailEl    ? emailEl.value    : '').trim();
    const remember = !!(rememberEl && rememberEl.checked);

    if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
      if (errEl) errEl.textContent = 'Kommandantenname: 3\u201332 alphanumerische Zeichen oder Unterstriche.';
      return;
    }
    if (!email.includes('@') || !email.includes('.')) {
      if (errEl) errEl.textContent = 'Bitte gib eine g\u00fcltige E-Mail-Adresse ein.';
      return;
    }
    if (!_prologToken) {
      if (errEl) errEl.textContent = 'Session abgelaufen. Bitte w\u00e4hle erneut deine Fraktion.';
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (loadingEl) loadingEl.classList.remove('hidden');

    try {
      await registerComplete(username, email, remember);
      showPhase(5); // transition text uses _username (set inside registerComplete)
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (errEl) errEl.textContent = msg;
      prologLog('register_complete error: ' + msg);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (loadingEl) loadingEl.classList.add('hidden');
    }
  }

  // ─── Phase 5 – Transition ─────────────────────────────────────────────────

  function populateTransition() {
    // _colonyName comes from the DB (register_prepare response) – never hardcoded.
    // _username  comes from the register_complete response.
    const colony      = _colonyName || 'deine Welt';
    const factionName = _selectedFaction ? _selectedFaction.name : 'der Gesandte';
    const commander   = _username || 'Gouverneur';

    const lines = [
      factionName + ' ist gegangen.',
      'Du stehst am Fenster des Gouverneursgeb\u00e4udes und siehst '
        + colony
        + ' zum ersten Mal wirklich: die Siedlung unter dir, die Patrouillenkorvetten im niedrigen Orbit, die Berge am Horizont.',
      'Irgendwo hinter diesem Horizont lauern Piraten. Irgendwo dort oben beobachten f\u00fcnf weitere Gesandte deine Entscheidung.',
      'Dein Terminal blinkt. Eine Nachricht: \u201e'
        + commander
        + ' \u2013 die w\u00f6chentliche Lage\u00fcbersicht steht bereit. Ihr erster Tag beginnt.\u201c',
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
   * @param {Function} opts.onComplete  Called after the player clicks "Zur Lageübersicht"
   *
   * Note: username and colonyName are no longer accepted as parameters.
   * Both are obtained from the API calls made inside the prolog so they
   * always reflect the actual database values.
   */
  function show(opts) {
    opts = opts || {};
    _onComplete      = typeof opts.onComplete === 'function' ? opts.onComplete : null;
    _selectedFaction = null;
    _prologToken     = '';
    _colonyName      = '';
    _username        = '';

    const section = getSection();
    if (!section) {
      prologLog('prolog-section not found \u2013 calling onComplete directly');
      if (_onComplete) _onComplete();
      return;
    }

    prologLog('show');
    buildDOM();
    section.classList.remove('hidden');
    section.setAttribute('aria-hidden', 'false');
    showPhase(1);
  }

  window.GQProlog = {
    show,
    _test: {
      FACTIONS,
      INTRO_LINES,
      esc,
      getFactionById:     (id) => FACTIONS.find((f) => f.id === id),
      getColonyName:      () => _colonyName,
      getUsername:        () => _username,
      getPrologToken:     () => _prologToken,
      getSelectedFaction: () => _selectedFaction,
    },
  };
})();