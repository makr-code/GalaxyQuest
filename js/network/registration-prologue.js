import content from '../../config/onboarding_prologue.json';
import populationIcon from '../../gfx/icons/mono/population.svg?url&no-inline';
import { RegistrationHeraldStage } from '../rendering/registration-herald-stage-webgpu.js';

export function initializeRegistrationPrologue({ request, onPreview = () => {}, onClose = () => {} }) {
  const root = document.getElementById('registration-prologue');
  if (!root) throw new Error('Registration prologue HTML is missing.');
  const element = (id) => root.querySelector(`#registration-${id}`);
  const next = element('continue');
  const audio = new Audio();
  audio.preload = 'auto';
  let active = false;
  let revision = 0;
  let timer = null;
  let playbackTimer = null;
  let duckingTimer = null;
  let narrationRequest = null;
  let currentClip = null;
  let phase = 'teaser';
  let chapter = 0;
  let catalog = null;
  let draft = null;
  let selectedSpecies = '';
  let selectedMentorDraft = null;
  let selectedTutorialPlanet = null;
  let mentorDrafts = [];
  let tutorialIndex = 0;
  let busy = false;
  let portraitTimer = null;
  let portraitRevision = 0;
  let heraldStage = null;

  function characterSaved() {
    return draft?.character && element('name').value.trim() === draft.character.name
      && element('background').value.trim() === draft.character.background;
  }

  function resetPortrait() {
    clearTimeout(portraitTimer);
    portraitRevision++;
    const image = element('portrait-image');
    image.hidden = true;
    image.removeAttribute('src');
    element('portrait-generate').disabled = true;
    element('portrait-refresh').hidden = true;
    element('portrait-status').textContent = 'Speichere zuerst deinen Charakter-Draft.';
  }

  function showPortrait(portrait) {
    clearTimeout(portraitTimer);
    const image = element('portrait-image');
    image.hidden = true;
    image.removeAttribute('src');
    const button = element('portrait-generate');
    button.textContent = portrait.status === 'failed' ? 'KI-Portrait erneut versuchen' : 'KI-Portrait erzeugen';
    button.disabled = busy || portrait.status === 'pending' || portrait.status === 'generated'
      || portrait.attempts_remaining === 0 || portrait.retry_after > 0;
    element('portrait-refresh').hidden = false;
    if (portrait.status === 'generated') {
      if (!/^api\/auth\.php\?action=register_portrait_image&revision=[a-f0-9]{32}$/.test(portrait.image_url)) {
        throw new Error('Der Server hat keine gültige private Portraitadresse geliefert.');
      }
      element('portrait-status').textContent = 'Dein KI-Portrait ist erzeugt und bleibt an deinen privaten Draft gebunden.';
      image.src = portrait.image_url;
    } else if (portrait.status === 'pending') {
      element('portrait-status').textContent = 'Dein KI-Portrait wird erzeugt. Du kannst zurückgehen; der Auftrag bleibt privat am Draft gespeichert.';
    } else {
      element('portrait-status').textContent = portrait.status === 'failed'
        ? `Kein KI-Portrait erzeugt: ${portrait.error}` : 'Noch kein KI-Portrait erzeugt. Die gewählte Spezies bestimmt das Aussehen.';
      if (portrait.attempts_remaining === 0) element('portrait-status').textContent += ' Die drei Versuche für diesen Draft sind aufgebraucht.';
      else if (portrait.retry_after > 0) element('portrait-status').textContent += ` Erneut möglich in ${portrait.retry_after} Sekunden.`;
    }
    if (portrait.status === 'pending' || (portrait.retry_after > 0 && portrait.attempts_remaining > 0)) {
      portraitTimer = setTimeout(() => { void refreshPortrait(); }, portrait.status === 'pending' ? 3000 : Math.min(portrait.retry_after * 1000, 30000));
    }
  }

  async function refreshPortrait() {
    if (!active || phase !== 'character' || busy || !characterSaved()) return;
    const version = revision;
    const identity = ++portraitRevision;
    try {
      const data = await request('register_portrait_status');
      if (active && version === revision && identity === portraitRevision) showPortrait(data.portrait);
    } catch (error) {
      if (!active || version !== revision || identity !== portraitRevision) return;
      element('portrait-status').textContent = `Portraitstatus nicht verfügbar: ${error.message}`;
      element('portrait-refresh').hidden = false;
      element('portrait-generate').disabled = true;
      window.GQLog?.warn?.('[registration-portrait]', error.message);
    }
  }

  async function generatePortrait() {
    if (busy || !characterSaved()) return;
    busy = true;
    const version = revision;
    const identity = ++portraitRevision;
    clearTimeout(portraitTimer);
    element('character-form').inert = true;
    element('portrait-generate').disabled = true;
    element('portrait-status').textContent = 'Dein KI-Portrait wird erzeugt. Das kann einige Minuten dauern.';
    try {
      const data = await request('register_portrait', { prolog_token: draft.prolog_token });
      if (!active || version !== revision || identity !== portraitRevision) return;
      busy = false;
      showPortrait(data.portrait);
    } catch (error) {
      if (!active || version !== revision || identity !== portraitRevision) return;
      busy = false;
      element('portrait-status').textContent = `Kein KI-Portrait erzeugt: ${error.message}`;
      element('portrait-refresh').hidden = false;
      window.GQLog?.warn?.('[registration-portrait]', error.message);
      void refreshPortrait();
    } finally {
      if (active && version === revision) { busy = false; element('character-form').inert = false; }
    }
  }

  function stopNarration() {
    clearTimeout(timer);
    clearTimeout(playbackTimer);
    if (duckingTimer !== null) {
      clearInterval(duckingTimer);
      window.__GQ_AUDIO_MANAGER?.duckMusicForTts?.(200);
      duckingTimer = null;
    }
    timer = null;
    narrationRequest?.abort();
    narrationRequest = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  function muted() {
    const state = window.__GQ_AUDIO_MANAGER?.snapshot?.();
    return state?.masterMuted === true || state?.ttsMuted === true
      || state?.masterVolume === 0 || state?.ttsVolume === 0;
  }

  function applyAudioSettings() {
    const state = window.__GQ_AUDIO_MANAGER?.snapshot?.();
    audio.muted = muted();
    audio.volume = Math.max(0, Math.min(1, (state?.masterVolume ?? 0.8) * (state?.ttsVolume ?? 0.95)));
  }

  function fail(error) {
    element('error').textContent = error.message || 'Der Prolog konnte nicht geladen werden.';
    window.GQLog?.error?.('[registration-prologue]', element('error').textContent);
  }

  async function narrate(clip, done) {
    stopNarration();
    currentClip = { clip, done };
    const version = ++revision;
    let reading = false;
    element('narration-retry').hidden = true;
    element('narration-status').textContent = muted() ? 'Sprachausgabe ist stummgeschaltet.' : 'Sprachausgabe wird geladen...';
    const finishByReading = () => {
      if (reading) return;
      reading = true;
      timer = setTimeout(() => {
        if (active && version === revision) done();
      }, Math.max(8000, clip.text.split(/\s+/).length * 430));
    };
    const unavailable = (message) => {
      if (!active || version !== revision || reading) return;
      stopNarration();
      element('narration-status').textContent = 'Sprachausgabe nicht verfügbar. Der Prolog läuft als Text weiter.';
      element('narration-retry').hidden = false;
      window.GQLog?.warn?.('[registration-narration]', message);
      finishByReading();
    };
    if (muted()) {
      finishByReading();
      return;
    }
    const controller = new AbortController();
    narrationRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`api/registration_narration.php?clip=${encodeURIComponent(clip.id)}`, {
        credentials: 'same-origin', signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Sprachausgabe nicht verfügbar (HTTP ${response.status}).`);
      const data = await response.json();
      if (data.success !== true || data.text !== clip.text || typeof data.audio_url !== 'string'
        || !/^generated\/tts\/[a-f0-9]{64}\.mp3$/.test(data.audio_url)) {
        throw new Error('Die vorbereitete Sprachausgabe passt nicht zum Loretext.');
      }
      if (!active || version !== revision) return;
      audio.src = data.audio_url;
      applyAudioSettings();
      audio.onended = () => {
        if (active && version === revision) {
          stopNarration();
          element('narration-status').textContent = '';
          done();
        }
      };
      audio.onerror = () => unavailable('Der Sprachclip konnte nicht abgespielt werden.');
      playbackTimer = setTimeout(() => unavailable('Das Starten des Sprachclips hat zu lange gedauert.'), 10000);
      await audio.play();
      if (!active || version !== revision) return;
      if (reading) return;
      clearTimeout(playbackTimer);
      playbackTimer = setTimeout(() => unavailable('Die Wiedergabe des Sprachclips wurde nicht beendet.'),
        Math.max(30000, Number.isFinite(audio.duration) ? audio.duration * 1000 + 10000 : clip.text.split(/\s+/).length * 1000));
      const duck = () => window.__GQ_AUDIO_MANAGER?.duckMusicForTts?.(3000);
      duck();
      duckingTimer = setInterval(duck, 2000);
      element('narration-status').textContent = '';
    } catch (error) {
      unavailable(String(error.message));
    } finally {
      clearTimeout(timeout);
    }
  }

  function frame(title, text, label) {
    root.dataset.phase = phase;
    heraldStage?.setVisible(active && phase === 'mentor-room');
    resetPortrait();
    revision++;
    stopNarration();
    currentClip = null;
    element('title').textContent = title;
    element('story').textContent = text;
    element('chapter').textContent = label;
    element('choices').replaceChildren();
    element('character').hidden = true;
    element('surface').hidden = true;
    element('draft-summary').hidden = true;
    element('error').textContent = '';
    element('status').textContent = '';
    element('flight-status').textContent = '';
    element('narration-status').textContent = '';
    element('narration-retry').hidden = true;
    element('retry').hidden = true;
    next.hidden = true;
    next.disabled = false;
    next.textContent = 'Weiter';
    element('story').classList.remove('registration-reveal');
    void element('story').offsetWidth;
    element('story').classList.add('registration-reveal');
    element('title').focus();
    root.scrollTop = 0;
  }

  function showTeaser(index) {
    phase = 'teaser';
    chapter = index;
    const clip = content.teaser[index];
    frame(clip.title, clip.text, 'Prolog / Die Kalytherion-Konvergenz');
    preview(null);
    next.hidden = false;
    next.textContent = index + 1 < content.teaser.length ? 'Weiter' : 'Weiter zur Heroldkammer';
    void narrate(clip, () => {
      if (index + 1 < content.teaser.length) showTeaser(index + 1);
    });
  }

  function choice(entry, icon, choose) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'registration-choice';
    button.dataset.choice = entry.code;
    button.style.setProperty('--faction-color', entry.color || '#bce6ff');
    button.setAttribute('aria-pressed', 'false');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `${icon}#icon-${entry.symbol || 'population'}`);
    svg.append(use);
    const name = document.createElement('span');
    name.textContent = entry.name;
    button.append(svg, name);
    button.addEventListener('click', () => {
      if (busy) return;
      element('choices').querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      choose();
    });
    element('choices').append(button);
    return button;
  }

  function preview(value) {
    if (onPreview(value) === false && value) {
      element('flight-status').textContent = 'Der WebGPU-Flug ist nicht verfügbar. Die Auswahl bleibt bedienbar.';
    } else {
      element('flight-status').textContent = value
        ? ({ region: 'Anflug auf das Fraktionsgebiet.', system: 'Anflug auf dein reserviertes Startsystem. Umlaufbahnen schematisch.',
          planet: 'Anflug auf deinen reservierten Startplaneten.', surface: 'Sinkflug zur privaten Landeplatz-Vorschau. Noch kein Baututorial.' }[value.stage] || '')
        : '';
    }
  }

  function showMentorRoom() {
    phase = 'mentor-room';
    selectedMentorDraft = null;
    selectedSpecies = '';
    frame('Die Heroldkammer', 'Sechs Mentoren erwarten dich. Jeder bietet dir eine Herkunft und ein eigenes Startsystem an.', 'Schritt 2 / Mentor und Herkunft');
    preview(null);
    next.hidden = true;
    void loadMentorDrafts();
  }

  async function loadMentorDrafts() {
    if (busy) return;
    const version = revision;
    busy = true;
    element('error').textContent = '';
    element('status').textContent = 'Die sechs Mentor-Systeme werden vorbereitet...';
    element('retry').hidden = true;
    try {
      const [data, result] = await Promise.all([
        request('register_catalog'),
        request('register_mentor_drafts', {}),
      ]);
      if (!active || version !== revision) return;
      if (!Array.isArray(data.species) || data.species.length !== 6
        || !Array.isArray(result.drafts) || result.drafts.length !== 6) {
        throw new Error('Die sechs Mentor-Systeme sind noch nicht vollständig vorbereitet.');
      }
      catalog = data;
      mentorDrafts = result.drafts;
      for (const species of catalog.species) {
        const candidate = mentorDrafts.find((item) => item.mentor_code === species.code);
        if (!candidate) throw new Error(`Das System für ${species.name} fehlt.`);
        const button = choice(species, populationIcon, () => activateMentor(species, candidate));
        button.classList.add('registration-herald-choice');
        button.addEventListener('focus', () => heraldStage?.setFocus(species.code));
        button.addEventListener('pointerenter', () => heraldStage?.setFocus(species.code));
        button.addEventListener('pointerleave', () => {
          if (document.activeElement !== button) heraldStage?.setFocus(selectedSpecies || null);
        });
      }
      const previousSelection = mentorDrafts.find((item) => item.selected === true);
      if (previousSelection) {
        const species = catalog.species.find((item) => item.code === previousSelection.mentor_code);
        if (species) activateMentor(species, previousSelection);
      }
      element('status').textContent = 'Sechs private System-Drafts bereit. Noch keine Welt ist aktiviert.';
      ensureHeraldStage(catalog.species);
    } catch (error) {
      if (!active || version !== revision) return;
      fail(error);
      element('retry').hidden = false;
    } finally {
      if (active && version === revision) busy = false;
    }
  }

  function activateMentor(species, candidate) {
    selectedSpecies = species.code;
    selectedMentorDraft = candidate;
    element('choices').querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.choice === species.code));
    });
    heraldStage?.setSelected(species.code);
    const planet = candidate.planets?.find((item) => Number(item.position) === Number(candidate.target.position));
    element('story').textContent = `Ich bin der Herold der ${species.name}. ${species.description}\n\nMein System: ${candidate.system_name}. ${planet?.name || candidate.colony_name} ist deine mögliche Heimatwelt in ${species.homeworld || 'unserer Herkunftsregion'}.`;
    preview({ stage: 'planet', target: candidate.target, stars: candidate.stars, draft: candidate });
    next.hidden = false;
    next.disabled = false;
    next.textContent = 'System wählen und Tutorial starten';
  }

  async function selectMentorDraft() {
    if (busy || !selectedMentorDraft) return;
    const version = revision;
    busy = true;
    next.disabled = true;
    element('status').textContent = 'Dein ausgewähltes System wird reserviert...';
    try {
      const result = await request('register_select_mentor', {
        prolog_token: selectedMentorDraft.prolog_token,
        mentor_code: selectedMentorDraft.mentor_code,
      });
      if (!active || version !== revision) return;
      draft = result.draft;
      selectedSpecies = draft.species_code;
      selectedTutorialPlanet = null;
      busy = false;
      showTutorial(0);
    } catch (error) {
      if (active && version === revision) {
        fail(error);
        next.disabled = false;
      }
    } finally {
      if (active && version === revision) busy = false;
    }
  }

  const tutorialSteps = [
    { stage: 'system', title: 'Dein Sternsystem', text: 'Untersuche das System und markiere die vom Mentor vorgeschlagene Startwelt für den Scan.' },
    { stage: 'planet', title: 'Planetenscan', text: 'Der Planet ist markiert. Lies seine Messwerte und bereite den Landeanflug vor.' },
    { stage: 'surface', title: 'Landeanflug', text: 'Der Landeanflug ist abgeschlossen. Dein System bleibt ein privater Draft; noch wird keine Welt aktiviert.' },
  ];

  function chooseTutorialPlanet(planet) {
    selectedTutorialPlanet = planet;
    const position = Number(planet.position);
    const target = { ...draft.target, position };
    const button = element('choices').querySelector(`[data-tutorial-planet="${position}"]`);
    element('choices').querySelectorAll('button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    element('story').textContent = `${planet.name} · ${planet.class}\n${Number(planet.diameter_km).toLocaleString()} km Durchmesser · ${Number(planet.semi_major_axis_au).toFixed(2)} AU\nDies ist die für deinen privaten Draft reservierte Startwelt.`;
    preview({ stage: 'planet', target, stars: draft.stars, draft });
    next.hidden = false;
    next.disabled = false;
    next.textContent = 'Planet scannen';
  }

  function showTutorial(index) {
    tutorialIndex = Math.max(0, Math.min(tutorialSteps.length - 1, index));
    phase = 'tutorial';
    const step = tutorialSteps[tutorialIndex];
    frame(step.title, step.text, `Schritt 3 / Tutorial ${tutorialIndex + 1} von ${tutorialSteps.length}`);
    if (tutorialIndex === 1 && selectedTutorialPlanet) {
      const planet = selectedTutorialPlanet;
      element('story').textContent = `${planet.name} · ${planet.class}\nDurchmesser: ${Number(planet.diameter_km).toLocaleString()} km\nUmlaufbahn: ${Number(planet.semi_major_axis_au).toFixed(2)} AU\nStatus: kolonialisierbar · Reservierung: privat`;
    }
    const target = selectedTutorialPlanet
      ? { ...draft.target, position: Number(selectedTutorialPlanet.position) }
      : draft.target;
    preview({ stage: step.stage, target, stars: draft.stars, draft });
    next.hidden = tutorialIndex === 0 && !selectedTutorialPlanet;
    next.disabled = false;
    if (tutorialIndex === 0) {
      for (const planet of draft.planets.filter((item) => item.can_colonize
        && Number(item.position) === Number(draft.position.position))) {
        const button = choice({ ...planet, code: `planet-${planet.position}` }, populationIcon,
          () => chooseTutorialPlanet(planet));
        button.dataset.tutorialPlanet = String(planet.position);
        if (selectedTutorialPlanet?.position === planet.position) button.setAttribute('aria-pressed', 'true');
      }
      if (selectedTutorialPlanet) next.textContent = 'Planet scannen';
    } else {
      next.textContent = tutorialIndex === 1 ? 'Scan akzeptieren und Landeanflug starten' : 'Landeanflug bestätigen';
    }
  }

  function ensureHeraldStage(species) {
    if (heraldStage) {
      heraldStage.setVisible(active && phase === 'mentor-room');
      return;
    }
    const stage = new RegistrationHeraldStage();
    heraldStage = stage;
    void stage.mount(root, species).then((mounted) => {
      if (heraldStage !== stage) {
        stage.destroy();
        return;
      }
      if (!mounted) {
        stage.destroy();
        heraldStage = null;
        return;
      }
      if (selectedSpecies) stage.setSelected(selectedSpecies);
      stage.setVisible(active && phase === 'mentor-room');
    }).catch((error) => {
      if (heraldStage === stage) heraldStage = null;
      stage.destroy();
      window.GQLog?.warn?.('[registration-herald-webgpu]', String(error?.message || error));
    });
  }

  async function prepareCharacter() {
    const version = revision;
    busy = true;
    next.disabled = true;
    element('status').textContent = 'Deine private Randwelt wird vorbereitet...';
    element('error').textContent = '';
    try {
      const data = await request('register_profile', { prolog_token: draft.prolog_token, species_code: selectedSpecies });
      if (!active || version !== revision) return;
      draft = data.draft;
      busy = false;
      showCharacter();
    } catch (error) {
      if (active && version === revision) fail(error);
    } finally {
      if (active && version === revision) {
        busy = false;
        next.disabled = false;
        element('status').textContent = '';
      }
    }
  }

  function showCharacter() {
    phase = 'character';
    frame('Wer übernimmt das Kommando?', 'Deine Identität entsteht in einem privaten Draft. Noch keine E-Mail, kein Passwort und keine aktive Welt.', 'Schritt 4 / Commander');
    element('character').hidden = false;
    element('character-form').inert = false;
    element('character-form').querySelector('button').disabled = false;
    element('name').value = draft.character?.name || '';
    element('background').value = draft.character?.background || '';
    element('draft-summary').hidden = false;
    element('draft-summary').textContent = `${draft.colony_name} [${draft.position.galaxy}:${draft.position.system}:${draft.position.position}] · Privat reserviert bis ${new Date(draft.expires_at).toLocaleString()}.`;
    preview({ stage: 'planet', target: draft.target, stars: draft.stars, draft });
    next.textContent = 'Weiter zur Planetenoberfläche';
    next.hidden = !draft.character;
    void refreshPortrait();
  }

  async function saveCharacter(event) {
    event.preventDefault();
    if (busy || !element('character-form').reportValidity()) return;
    busy = true;
    const version = revision;
    const button = element('character-form').querySelector('button');
    button.disabled = true;
    element('portrait-generate').disabled = true;
    element('error').textContent = '';
    try {
      const data = await request('register_character', {
        prolog_token: draft.prolog_token,
        name: element('name').value.trim(), background: element('background').value.trim(),
      });
      if (!active || version !== revision) return;
      draft = data.draft;
      busy = false;
      next.textContent = 'Startwelt-Vorschau anzeigen';
      next.hidden = false;
      void refreshPortrait();
      element('status').textContent = 'Charakter-Draft gespeichert. Dein geführter Anflug ist abgeschlossen; die Welt bleibt privat und ist noch nicht aktiviert.';
    } catch (error) {
      if (active && version === revision) fail(error);
    } finally {
      if (active && version === revision) { button.disabled = false; busy = false; }
    }
  }

  function close() {
    if (!active) return;
    active = false;
    busy = false;
    revision++;
    resetPortrait();
    stopNarration();
    root.hidden = true;
    document.body.classList.remove('registration-active');
    document.removeEventListener('keydown', onKeydown);
    preview(null);
    heraldStage?.destroy();
    heraldStage = null;
    onClose();
  }

  function showSurface() {
    phase = 'surface';
    frame('Startwelt-Vorschau', 'Dein Mentor, das System und der Planetenscan sind abgeschlossen. Diese Welt bleibt ein privater Entwurf; die Spielwelt wird erst mit der späteren Registrierungsaktivierung erstellt.', 'Onboarding / Vorschau abgeschlossen');
    element('surface').hidden = false;
    preview({ stage: 'surface', target: draft.target, stars: draft.stars, draft });
    next.hidden = true;
  }

  function back() {
    if (busy) { close(); return; }
    if (phase === 'teaser') { if (chapter > 0) showTeaser(chapter - 1); else close(); }
    else if (phase === 'mentor-room') showTeaser(content.teaser.length - 1);
    else if (phase === 'tutorial') {
      if (tutorialIndex > 0) showTutorial(tutorialIndex - 1);
      else showMentorRoom();
    }
    else if (phase === 'character') showTutorial(tutorialSteps.length - 1);
    else if (phase === 'surface') showCharacter();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); back(); }
  }

  next.addEventListener('click', () => {
    if (busy) return;
    if (phase === 'teaser') {
      if (chapter + 1 < content.teaser.length) showTeaser(chapter + 1);
      else showMentorRoom();
    }
    else if (phase === 'mentor-room') void selectMentorDraft();
    else if (phase === 'tutorial') {
      if (tutorialIndex + 1 < tutorialSteps.length) showTutorial(tutorialIndex + 1);
      else void prepareCharacter();
    }
    else if (phase === 'character') showSurface();
  });
  element('back').addEventListener('click', back);
  element('retry').addEventListener('click', loadMentorDrafts);
  element('character-form').addEventListener('submit', saveCharacter);
  element('character-form').addEventListener('input', () => { resetPortrait(); next.hidden = true; });
  element('portrait-generate').addEventListener('click', generatePortrait);
  element('portrait-refresh').addEventListener('click', () => { void refreshPortrait(); });
  element('portrait-image').addEventListener('load', () => {
    if (active && phase === 'character' && characterSaved() && element('portrait-image').hasAttribute('src')) element('portrait-image').hidden = false;
  });
  element('portrait-image').addEventListener('error', () => {
    element('portrait-image').hidden = true;
    element('portrait-status').textContent = 'Das private Portrait konnte nicht geladen werden. Prüfe den Portraitstatus erneut.';
  });
  element('narration-retry').addEventListener('click', () => {
    if (currentClip) void narrate(currentClip.clip, currentClip.done);
  });
  window.addEventListener('gq:audio-state', applyAudioSettings);

  return {
    isActive: () => active,
    close,
    open() {
      if (active) return;
      active = true;
      catalog = null;
      mentorDrafts = [];
      selectedMentorDraft = null;
      selectedTutorialPlanet = null;
      selectedSpecies = '';
      root.hidden = false;
      document.body.classList.add('registration-active');
      document.addEventListener('keydown', onKeydown);
      showTeaser(0);
    },
  };
}
