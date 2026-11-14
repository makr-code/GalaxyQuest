import content from '../../config/onboarding_prologue.json';
import cometNarration from '../../config/onboarding_narration.json';
import populationIcon from '../../gfx/icons/mono/population.svg?url&no-inline';
import { RegistrationHeraldStage } from '../rendering/registration-herald-stage-webgpu.js';
import { COMET_WORLD_DURATION_MS } from '../rendering/registration-voyage.js';
import { createRegistrationSlideMotion } from './registration-slide-motion.js';

export function initializeRegistrationPrologue({ request, onPreview = () => {}, onCamera, onClose = () => {}, onEnterDraft }) {
  const root = document.getElementById('registration-prologue');
  if (!root) throw new Error('Registration prologue HTML is missing.');
  const element = (id) => root.querySelector(`#registration-${id}`);
  const next = element('continue');
  const slideMotion = createRegistrationSlideMotion({
    root,
    elements: [element('story')],
    isReduced: () => document.body.dataset.startReducedMotion === 'true'
      || (document.body.dataset.startReducedMotion === undefined
        && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true),
  });
  const audio = new Audio();
  audio.preload = 'auto';
  let active = false;
  let revision = 0;
  let narrationRevision = 0;
  let timer = null;
  let playbackTimer = null;
  let releaseDucking = null;
  let narrationRequest = null;
  let prefetchedNarration = null;
  let currentClip = null;
  let pendingNarrationTransition = null;
  let narrationPausedForPrologue = false;
  let phase = 'teaser';
  let chapter = 0;
  let catalog = null;
  let homeworldStops = [];
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
  let openingTimer = null;
  let openingRemaining = 0;
  let openingDeadline = 0;
  let openingCueIndex = 0;
  let openingPaused = false;
  let beginJourney = null;
  let cameraRevision = 0;
  let cinematicCampaign = false;
  let homeworldTravel = false;
  let homeworldTransitBeat = 0;
  let homeworldCueIndex = 0;
  let homeworldArrivalCue = 0;
  let homeworldTransitResting = false;
  let homeworldTransitComplete = false;
  let homeworldCameraArrived = false;
  let homeworldCameraCode = '';
  let homeworldWaitForManual = false;
  const timedPhase = () => ['opening', 'homeworlds'].includes(phase);
  const pausablePhase = () => timedPhase() || ['journey', 'landing'].includes(phase);

  function setControlLabel(control, label) {
    control.querySelector('.sr-only').textContent = label;
    control.setAttribute('aria-label', label);
    control.title = label;
  }

  function setStatus(id, text, isError = false) {
    const status = element(id);
    status.textContent = text;
    status.classList.toggle('is-error', isError);
    status.classList.remove('is-loading');
  }

  function updateProgress(title) {
    const progress = element('progress');
    progress.hidden = false;
    if (!cinematicCampaign) {
      progress.max = 10;
      progress.value = ({
        opening: chapter + 1, teaser: chapter + 1,
        'mentor-room': 5, tutorial: tutorialIndex + 6, character: 9, surface: 10,
      })[phase] || 1;
    } else {
      const openingTotal = cometNarration.opening.reduce((total, slide) => total + slide.cues.length, 0);
      const stopsTotal = cometNarration.stops.reduce((total, stop) => total + stop.transit.length + stop.arrival.length, 0);
      progress.max = openingTotal + stopsTotal + 5;
      if (phase === 'opening') {
        progress.value = cometNarration.opening.slice(0, chapter)
          .reduce((total, slide) => total + slide.cues.length, 0) + openingCueIndex + 1;
      } else if (phase === 'homeworlds') {
        const stop = cometNarration.stops.find((entry) => entry.code === homeworldStops[chapter]?.code);
        const previous = homeworldStops.slice(0, chapter).reduce((total, destination) => {
          const narration = cometNarration.stops.find((entry) => entry.code === destination.code);
          return total + (narration ? narration.transit.length + narration.arrival.length : 0);
        }, 0);
        progress.value = stop
          ? openingTotal + previous + (homeworldTravel ? homeworldCueIndex : stop.transit.length + homeworldArrivalCue) + 1
          : openingTotal;
      } else {
        const step = ({ 'mentor-room': 1, character: 2, journey: 3, surface: 4, landing: 5 })[phase] || 0;
        progress.value = openingTotal + stopsTotal + step;
      }
    }
    progress.setAttribute('aria-valuetext', `${progress.value} von ${progress.max}: ${title}`);
  }

  function cancelCamera() {
    cameraRevision++;
    homeworldCameraCode = '';
    onCamera?.cancel();
    root.dataset.cameraState = 'idle';
  }

  function directCamera(shot, arrived, failed) {
    if (!onCamera) { failed?.(); return; }
    const version = ++cameraRevision;
    root.dataset.cameraState = 'preparing';
    const unavailable = (error) => {
      if (!active || version !== cameraRevision) return;
      root.dataset.cameraState = 'unavailable';
      setStatus('flight-status', `Die Kamera-Regie ist nicht verfügbar: ${error.message}`, true);
      window.GQLog?.warn?.('[registration-camera]', error.message);
      failed?.();
    };
    try {
      Promise.resolve(onCamera.play(shot)).then((ready) => {
        if (!active || version !== cameraRevision) return;
        if (ready !== true) { unavailable(new Error('Die Szene oder das Kameraziel ist noch nicht verfügbar.')); return; }
        root.dataset.cameraState = openingPaused && pausablePhase() ? 'paused' : 'ready';
        arrived?.();
      }).catch(unavailable);
    } catch (error) {
      unavailable(error);
    }
  }

  function stopOpening() {
    clearTimeout(openingTimer);
    openingTimer = null;
  }

  function flushNarrationTransition() {
    const pending = pendingNarrationTransition;
    if (!pending) return;
    if (!active || pending.revision !== revision) {
      pendingNarrationTransition = null;
      return;
    }
    if (openingPaused && pausablePhase()) return;
    if (currentClip?.loading) {
      element('narration-status').classList.add('is-loading');
      return;
    }
    if (currentClip?.playing) return;
    pendingNarrationTransition = null;
    pending.callback();
  }

  function afterNarration(callback, priority = 0) {
    if (!cinematicCampaign) {
      callback();
      return;
    }
    if (!pendingNarrationTransition || priority >= pendingNarrationTransition.priority) {
      pendingNarrationTransition = { callback, priority, revision };
    }
    flushNarrationTransition();
  }

  function scheduleOpening() {
    if (phase === 'homeworlds' && homeworldWaitForManual) return;
    if (phase === 'homeworlds' && homeworldTravel && homeworldTransitComplete) return;
    openingDeadline = Date.now() + openingRemaining;
    const version = revision;
    openingTimer = setTimeout(() => {
      if (active && timedPhase() && version === revision && !openingPaused) afterNarration(advanceOpening);
    }, openingRemaining);
  }

  function setOpeningPaused(paused) {
    if (!active || !pausablePhase() || paused === openingPaused) return;
    if (paused && timedPhase()) {
      openingRemaining = Math.max(0, openingDeadline - Date.now());
      stopOpening();
    }
    openingPaused = paused;
    if (paused && !audio.paused) {
      audio.pause();
      clearTimeout(playbackTimer);
      playbackTimer = null;
      narrationPausedForPrologue = true;
    } else if (!paused && narrationPausedForPrologue && currentClip) {
      narrationPausedForPrologue = false;
      const clip = currentClip;
      void audio.play().then(() => {
        if (currentClip === clip) clip.schedulePlaybackTimeout?.();
      }).catch((error) => {
        if (currentClip === clip) clip.unavailable?.(String(error?.message || error));
      });
    }
    if (paused) slideMotion.pause();
    else slideMotion.resume();
    onCamera?.pause(paused);
    if (['ready', 'paused'].includes(root.dataset.cameraState)) root.dataset.cameraState = paused ? 'paused' : 'ready';
    root.dataset.openingPaused = String(paused);
    setControlLabel(element('opening-pause'), paused ? 'Fortsetzen' : 'Pause');
    element('opening-pause').setAttribute('aria-pressed', String(paused));
    if (!paused && pendingNarrationTransition) flushNarrationTransition();
    else if (!paused && timedPhase()) scheduleOpening();
  }

  function cometVoice() {
    const voice = window.GQTTS?.getVoice?.() || 'de_DE-kerstin-low';
    return Object.hasOwn(cometNarration.voices, voice) ? voice : 'de_DE-kerstin-low';
  }

  function cometLanguage() {
    return cometNarration.voices[cometVoice()];
  }

  function cometClip(id) {
    const voice = cometVoice();
    const text = cometNarration.clips[id]?.[cometNarration.voices[voice]];
    if (typeof text !== 'string' || text === '') {
      throw new Error(`Missing localized comet narration clip: ${id}`);
    }
    return { id, text, voice, voiceProfile: true };
  }

  function cometMoment(key) {
    const id = `comet-moment-${key}`;
    return { ...cometClip(id), text: cometNarration.moments[key][cometLanguage()] };
  }

  function renderOpeningCue() {
    const slide = content.opening[chapter];
    const narrationSlide = cometNarration.opening[chapter];
    const cue = narrationSlide.cues[openingCueIndex];
    const clip = cometClip(cue.id);
    frame(narrationSlide.title[cometLanguage()], clip.text, narrationSlide.label[cometLanguage()],
      { preserveCamera: openingCueIndex > 0, narration: clip });
    root.dataset.beat = slide.id;
    root.dataset.transitionReady = 'true';
    element('opening-counter').textContent = `${String(chapter + 1).padStart(2, '0')} / ${String(content.opening.length).padStart(2, '0')}`;
    element('opening-source').hidden = chapter !== 0;
    next.hidden = false;
    setControlLabel(next, chapter + 1 < content.opening.length ? 'Weiter' : 'Reise beginnen');
    openingRemaining = cue.duration_ms;
    if (!openingPaused) scheduleOpening();
    const nextCue = narrationSlide.cues[openingCueIndex + 1] ?? cometNarration.opening[chapter + 1]?.cues[0];
    void narrate(clip, () => {}, nextCue ? cometClip(nextCue.id) : null);
  }

  function showOpening(index) {
    phase = 'opening';
    chapter = index;
    const slide = content.opening[index];
    openingCueIndex = 0;
    if (cinematicCampaign) {
      openingPaused = false;
      root.dataset.openingPaused = 'false';
      setControlLabel(element('opening-pause'), 'Pause');
      element('opening-pause').setAttribute('aria-pressed', 'false');
      renderOpeningCue();
      preview({ stage: 'opening', beat: slide.id }, slide.camera);
      if (document.hidden) setOpeningPaused(true);
      return;
    }
    frame(slide.title, slide.text, slide.label);
    root.dataset.beat = slide.id;
    root.dataset.transitionReady = 'true';
    openingPaused = false;
    root.dataset.openingPaused = 'false';
    element('opening-counter').textContent = `${String(index + 1).padStart(2, '0')} / ${String(content.opening.length).padStart(2, '0')}`;
    setControlLabel(element('opening-pause'), 'Pause');
    element('opening-pause').setAttribute('aria-pressed', 'false');
    element('opening-source').hidden = index !== 0;
    preview({ stage: 'opening', beat: slide.id }, slide.camera);
    next.hidden = false;
    setControlLabel(next, index + 1 < content.opening.length ? 'Weiter' : 'Reise beginnen');
    openingRemaining = slide.duration_ms;
    scheduleOpening();
    if (document.hidden) setOpeningPaused(true);
  }

  function finishOpening() {
    if (!active || !timedPhase()) return;
    stopOpening();
    if (cinematicCampaign) {
      if (phase === 'opening') void loadHomeworlds();
      else showMentorRoom();
      return;
    }
    const begin = beginJourney;
    beginJourney = null;
    begin();
  }

  function advanceOpening() {
    if (phase === 'homeworlds') {
      if (homeworldTravel) {
        if (cinematicCampaign) {
          if (homeworldTransitResting) {
            homeworldTransitResting = false;
            showHomeworldTransit(chapter, 1);
          } else if (homeworldCueIndex === 2) {
            homeworldTransitResting = true;
            openingRemaining = 2500;
            scheduleOpening();
          } else if (homeworldCueIndex < 5) {
            homeworldCueIndex++;
            renderHomeworldTransitCue(chapter);
          } else {
            homeworldTransitComplete = true;
            if (homeworldCameraArrived) showHomeworldArrival(chapter);
          }
        } else if (homeworldTransitBeat === 0) showHomeworldTransit(chapter, 1);
        return;
      }
      if (cinematicCampaign && homeworldArrivalCue === 0 && !homeworldWaitForManual) {
        homeworldArrivalCue = 1;
        renderHomeworldArrivalCue(chapter);
        return;
      }
      if (chapter + 1 < homeworldStops.length) showHomeworld(chapter + 1);
      else finishOpening();
    } else if (phase === 'opening') {
      const cues = cometNarration.opening[chapter]?.cues;
      if (cinematicCampaign && cues && openingCueIndex + 1 < cues.length) {
        openingCueIndex++;
        renderOpeningCue();
      } else if (chapter + 1 < content.opening.length) showOpening(chapter + 1);
      else finishOpening();
    }
  }

  function onVisibilityChange() {
    if (document.hidden) setOpeningPaused(true);
  }

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

  function matchesPrefetchedNarration(clip) {
    return !!clip && prefetchedNarration?.clip.id === clip.id
      && prefetchedNarration.clip.voice === clip.voice && prefetchedNarration.clip.text === clip.text;
  }

  function discardPrefetchedNarration() {
    prefetchedNarration?.controller.abort();
    prefetchedNarration = null;
  }

  function stopNarration({ keepPrefetch = false } = {}) {
    clearTimeout(timer);
    clearTimeout(playbackTimer);
    releaseDucking?.();
    releaseDucking = null;
    timer = null;
    narrationRequest?.abort();
    narrationRequest = null;
    if (!keepPrefetch) discardPrefetchedNarration();
    narrationPausedForPrologue = false;
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
    if (audio.muted) discardPrefetchedNarration();
    audio.volume = Math.max(0, Math.min(1, (state?.masterVolume ?? 0.8) * (state?.ttsVolume ?? 0.95)));
  }

  function fail(error) {
    element('error').textContent = error.message || 'Der Prolog konnte nicht geladen werden.';
    window.GQLog?.error?.('[registration-prologue]', element('error').textContent);
  }

  async function requestNarration(clip, signal) {
    const csrfResponse = await fetch('api/auth.php?action=csrf', { credentials: 'same-origin', signal });
    if (!csrfResponse.ok) throw new Error(`CSRF token request failed (HTTP ${csrfResponse.status}).`);
    const csrfData = await csrfResponse.json();
    if (typeof csrfData.token !== 'string' || csrfData.token.length === 0) {
      throw new Error('CSRF token missing.');
    }
    const requestBody = { clip: clip.id };
    if (clip.voiceProfile) requestBody.voice = clip.voice;
    const response = await fetch('api/registration_narration.php', {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfData.token,
      },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) throw new Error(`Sprachausgabe nicht verfügbar (HTTP ${response.status}).`);
    const data = await response.json();
    if (data.success !== true || data.text !== clip.text
      || (clip.voiceProfile && data.voice !== clip.voice)
      || typeof data.audio_url !== 'string'
      || !/^generated\/tts\/[a-f0-9]{64}\.mp3$/.test(data.audio_url)) {
      throw new Error('Die vorbereitete Sprachausgabe passt nicht zum Loretext.');
    }
    return data;
  }

  function prefetchNarration(clip) {
    discardPrefetchedNarration();
    if (!clip || muted() || window.GQTTS?.isAutoVoiceEnabled?.() === false) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 220000);
    const result = requestNarration(clip, controller.signal)
      .then((data) => ({ data }), (error) => ({ error }))
      .finally(() => clearTimeout(timeout));
    prefetchedNarration = { clip, controller, result };
  }

  async function narrate(clip, done, nextClip = null) {
    stopNarration({ keepPrefetch: matchesPrefetchedNarration(clip) });
    const clipState = { clip, done, nextClip, loading: false, playing: false };
    currentClip = clipState;
    const version = revision;
    const narration = ++narrationRevision;
    const isCurrent = () => active && version === revision && narration === narrationRevision;
    let reading = false;
    element('narration-retry').hidden = true;
    setStatus('narration-status', muted()
      ? 'Sprachausgabe ist stummgeschaltet.'
      : 'Sprachausgabe wird erzeugt oder aus dem Cache geladen. Der erste Abruf kann länger dauern.');
    const finishByReading = () => {
      if (reading) return;
      reading = true;
      timer = setTimeout(() => {
        if (isCurrent()) done();
      }, Math.max(8000, clip.text.split(/\s+/).length * 430));
    };
    const unavailable = (message) => {
      if (!isCurrent() || reading) return;
      clipState.loading = false;
      clipState.playing = false;
      stopNarration();
      setStatus('narration-status', 'Sprachausgabe nicht verfügbar. Der Prolog läuft als Text weiter.', true);
      element('narration-retry').hidden = false;
      window.GQLog?.warn?.('[registration-narration]', message);
      finishByReading();
      flushNarrationTransition();
    };
    const schedulePlaybackTimeout = () => {
      clearTimeout(playbackTimer);
      playbackTimer = setTimeout(() => unavailable('Die Wiedergabe des Sprachclips wurde nicht beendet.'),
        Math.max(30000, Number.isFinite(audio.duration) ? audio.duration * 1000 + 10000 : clip.text.split(/\s+/).length * 1000));
    };
    currentClip.unavailable = unavailable;
    currentClip.schedulePlaybackTimeout = schedulePlaybackTimeout;
    if (muted() || window.GQTTS?.isAutoVoiceEnabled?.() === false) {
      discardPrefetchedNarration();
      finishByReading();
      return;
    }
    clipState.loading = true;
    const prefetched = matchesPrefetchedNarration(clip) ? prefetchedNarration : null;
    prefetchedNarration = null;
    const controller = prefetched?.controller || new AbortController();
    narrationRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 220000);
    try {
      const prepared = prefetched ? await prefetched.result : { data: await requestNarration(clip, controller.signal) };
      if (prepared.error) throw prepared.error;
      const data = prepared.data;
      if (!isCurrent()) return;
      clipState.loading = false;
      audio.src = data.audio_url;
      applyAudioSettings();
      releaseDucking = window.__GQ_AUDIO_MANAGER?.trackTtsAudio?.(audio) ?? null;
      audio.onended = () => {
        if (isCurrent()) {
          clipState.playing = false;
          stopNarration({ keepPrefetch: true });
          setStatus('narration-status', '');
          done();
          flushNarrationTransition();
        }
      };
      audio.onerror = () => unavailable('Der Sprachclip konnte nicht abgespielt werden.');
      clipState.playing = true;
      playbackTimer = setTimeout(() => unavailable('Das Starten des Sprachclips hat zu lange gedauert.'), 10000);
      await audio.play();
      if (!isCurrent()) return;
      prefetchNarration(nextClip);
      clearTimeout(playbackTimer);
      playbackTimer = null;
      if (openingPaused && pausablePhase()) {
        audio.pause();
        narrationPausedForPrologue = true;
        setStatus('narration-status', '');
        return;
      }
      if (reading) return;
      schedulePlaybackTimeout();
      setStatus('narration-status', '');
    } catch (error) {
      unavailable(String(error.message));
    } finally {
      clearTimeout(timeout);
    }
  }

  function frame(title, text, label, { preserveCamera = false, narration = null } = {}) {
    stopOpening();
    pendingNarrationTransition = null;
    if (!preserveCamera) cancelCamera();
    let motionError = null;
    try {
      slideMotion.capture();
    } catch (error) {
      motionError = error;
      slideMotion.reset();
    }
    root.dataset.phase = phase;
    root.dataset.beat = '';
    for (const id of ['opening-hud', 'opening-pause']) element(id).hidden = !pausablePhase();
    element('opening-skip').hidden = !timedPhase();
    setControlLabel(element('opening-skip'), phase === 'homeworlds' ? 'Vorstellung überspringen' : 'Vorspann überspringen');
    element('opening-source').hidden = true;
    element('opening-source').open = false;
    updateProgress(title);
    heraldStage?.setVisible(active && phase === 'mentor-room');
    resetPortrait();
    revision++;
    stopNarration({ keepPrefetch: matchesPrefetchedNarration(narration) });
    currentClip = null;
    element('title').textContent = title;
    element('story').textContent = text;
    element('chapter').textContent = label;
    element('choices').replaceChildren();
    element('character').hidden = true;
    element('surface').hidden = true;
    element('review').hidden = true;
    element('draft-summary').hidden = true;
    element('error').textContent = '';
    element('status').textContent = '';
    setStatus('flight-status', '');
    setStatus('narration-status', '');
    element('narration-retry').hidden = true;
    element('retry').hidden = true;
    next.hidden = true;
    next.disabled = false;
    setControlLabel(next, 'Weiter');
    const version = revision;
    const reportMotionError = (error) => {
      if (!active || version !== revision) return;
      setStatus('flight-status', `Der Textwechsel wird ohne Animation fortgesetzt: ${error.message}`, true);
      window.GQLog?.warn?.('[registration-motion]', error.message);
    };
    queueMicrotask(() => {
      if (!active || version !== revision) return;
      if (motionError) { reportMotionError(motionError); return; }
      const animation = slideMotion.play({
        titleShot: root.dataset.beat === 'opening-title',
        paused: pausablePhase() && openingPaused,
      });
      void animation.catch(reportMotionError);
    });
    element('title').focus();
    root.scrollTop = 0;
  }

  function showTeaser(index) {
    phase = 'teaser';
    chapter = index;
    const clip = content.teaser[index];
    frame(clip.title, clip.text, 'Prolog / Die Kalytherion-Konvergenz');
    root.dataset.beat = clip.id;
    preview({ stage: 'galaxy', beat: clip.id }, clip.camera);
    next.hidden = false;
    setControlLabel(next, index + 1 < content.teaser.length ? 'Weiter' : 'Weiter zur Heroldkammer');
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

  function preview(value, shot) {
    cancelCamera();
    if (onPreview(value) === false && value) {
      setStatus('flight-status', 'Der WebGPU-Flug ist nicht verfügbar. Die Auswahl bleibt bedienbar.', true);
    } else {
      setStatus('flight-status', value
        ? ({ region: 'Anflug auf das Fraktionsgebiet.', system: 'Anflug auf dein reserviertes Startsystem. Umlaufbahnen schematisch.',
          planet: value.draft?.scene_key ? 'Anflug auf die öffentliche Heimatwelt.' : 'Anflug auf deinen reservierten Startplaneten.',
          surface: 'Sinkflug zur privaten Landeplatz-Vorschau. Noch kein Baututorial.' }[value.stage] || '')
        : '');
      const targetKind = ({ system: 'system', planet: 'planet', surface: 'colony' })[value?.stage];
      if (shot) directCamera(shot);
      else if (targetKind) directCamera({
        kind: 'target', target: { kind: targetKind, position: value.target?.position }, duration_ms: 4500,
      });
    }
  }

  function previewHomeworld(species, arrived, failed) {
    if (!species?.homeworld_scene) {
      setStatus('flight-status', 'Die echte Heimatwelt-Szene ist noch nicht verfügbar.', true);
      window.GQLog?.warn?.('[registration-homeworld]', 'Homeworld scene missing');
      failed?.();
      return;
    }
    const value = { stage: 'planet', target: species.target, stars: species.stars,
      draft: species.homeworld_scene, cometTour: true };
    cancelCamera();
    if (onPreview(value) === false) {
      setStatus('flight-status', 'Der WebGPU-Flug ist nicht verfügbar. Die Auswahl bleibt bedienbar.', true);
      failed?.();
      return;
    }
    homeworldCameraCode = species.code;
    setStatus('flight-status', 'Der Komet nähert sich der öffentlichen Heimatwelt.');
    directCamera({ kind: 'comet-world', destination: species.homeworld_scene,
      duration_ms: COMET_WORLD_DURATION_MS }, arrived, failed);
  }

  async function loadHomeworlds() {
    phase = 'homeworlds';
    frame('Die Welten der Konvergenz', 'Die Heimatwelten und ihre Herolde werden vorbereitet.', 'Heimatwelten');
    const version = revision;
    busy = true;
    try {
      catalog = catalog || await request('register_catalog');
      if (!active || version !== revision) return;
      if (catalog.species?.length !== 6) throw new Error('Die sechs Heimatwelten sind nicht vollständig verfügbar.');
      if (!Array.isArray(catalog.npc_homeworlds) || catalog.npc_homeworlds.length !== content.npc_tour.length
        || catalog.npc_homeworlds.some((entry, index) => entry.code !== content.npc_tour[index].code)) {
        throw new Error('Die NPC-Reiseziele sind im Katalog nicht vollständig verfügbar.');
      }
      homeworldStops = [
        ...catalog.species.map((species, index) => ({ ...species, transit: content.homeworld_transit[index], npc: false })),
        ...catalog.npc_homeworlds.map((npc, index) => ({ ...npc,
          transit: { title: content.npc_tour[index].transit_title, text: content.npc_tour[index].transit_text },
          npc: true })),
      ];
      busy = false;
      showHomeworld(0);
    } catch (error) {
      if (active && version === revision) { fail(error); element('retry').hidden = false; }
    } finally {
      if (active && version === revision) busy = false;
    }
  }

  function showHomeworldTransit(index, beat) {
    homeworldTransitBeat = beat;
    if (cinematicCampaign) {
      homeworldCueIndex = beat * 3;
      homeworldTransitResting = false;
      renderHomeworldTransitCue(index);
      return;
    }
    const species = homeworldStops[index];
    const info = species.transit;
    frame(beat === 0 ? info.title : `Unterwegs nach ${species.homeworld}`,
      beat === 0 ? info.text : `${species.name}\n${species.description}`,
      'Kometenreise / Zwischen den Sternen', { preserveCamera: true });
    root.dataset.beat = `homeworld-transit-${species.code}-${beat + 1}`;
    element('opening-counter').textContent = `${String(index + 1).padStart(2, '0')} / ${String(homeworldStops.length).padStart(2, '0')}`;
    setStatus('flight-status', `Der Komet fliegt nach ${species.homeworld}.`);
    next.hidden = beat === 1;
    setControlLabel(next, 'Weiterlesen');
    openingRemaining = COMET_WORLD_DURATION_MS / 2;
    if (!openingPaused) scheduleOpening();
  }

  function renderHomeworldTransitCue(index) {
    const species = homeworldStops[index];
    const stop = cometNarration.stops.find((entry) => entry.code === species.code);
    const cue = stop?.transit[homeworldCueIndex];
    if (!cue) throw new Error(`Missing comet transit cue for ${species.code}.`);
    const clip = cometClip(cue.id);
    homeworldTransitBeat = homeworldCueIndex < 3 ? 0 : 1;
    frame(species.homeworld, clip.text, `Kometenreise / ${species.name}`, { preserveCamera: true, narration: clip });
    root.dataset.beat = `homeworld-transit-${species.code}-${homeworldCueIndex + 1}`;
    element('opening-counter').textContent = `${String(index + 1).padStart(2, '0')} / ${String(homeworldStops.length).padStart(2, '0')}`;
    setStatus('flight-status', homeworldCameraArrived
      ? 'Der Komet ist angekommen. Die Vorstellung läuft weiter.'
      : `Der Komet fliegt nach ${species.homeworld}.`);
    next.hidden = homeworldTransitBeat === 1;
    setControlLabel(next, 'Weiterlesen');
    openingRemaining = cue.duration_ms;
    if (!openingPaused) scheduleOpening();
    const nextCue = stop.transit[homeworldCueIndex + 1] ?? stop.arrival[0];
    void narrate(clip, () => {}, nextCue ? cometClip(nextCue.id) : null);
  }

  function showHomeworldArrival(index, unavailable = false) {
    homeworldTravel = false;
    homeworldWaitForManual = unavailable;
    const species = homeworldStops[index];
    if (cinematicCampaign && !unavailable) {
      homeworldArrivalCue = 0;
      renderHomeworldArrivalCue(index);
      return;
    }
    const closing = species.npc ? 'Eine nicht spielbare Fraktion der Galaxie.'
      : 'Die Herolde dieser Heimatwelt laden dich ein, deine eigene Geschichte zu beginnen.';
    frame(species.homeworld, `${species.name}\n${species.description}\n${closing}`,
      species.npc ? 'Heimatwelten / NPC-Fraktionen' : 'Heimatwelten / Spezies und Herolde', { preserveCamera: true });
    root.dataset.beat = `homeworld-${species.code}`;
    element('opening-counter').textContent = `${String(index + 1).padStart(2, '0')} / ${String(homeworldStops.length).padStart(2, '0')}`;
    setStatus('flight-status', unavailable
      ? 'Der Kometenflug ist nicht verfügbar. Du kannst die Vorstellung ohne Darstellung fortsetzen.'
      : 'Oberflächenstrukturen und Orbitalstation sind schematische Vorschauen.', unavailable);
    next.hidden = false;
    setControlLabel(next, index === homeworldStops.length - 1 ? 'Herkunft wählen' : 'Nächste Heimatwelt');
    openingRemaining = 12000;
    if (!unavailable && !openingPaused) scheduleOpening();
  }

  function renderHomeworldArrivalCue(index) {
    const species = homeworldStops[index];
    const stop = cometNarration.stops.find((entry) => entry.code === species.code);
    const cue = stop?.arrival[homeworldArrivalCue];
    if (!cue) throw new Error(`Missing comet arrival cue for ${species.code}.`);
    const clip = cometClip(cue.id);
    frame(species.homeworld, clip.text, species.npc
      ? 'Heimatwelten / NPC-Fraktionen'
      : 'Heimatwelten / Spezies und Herolde', { preserveCamera: true, narration: clip });
    root.dataset.beat = `homeworld-${species.code}-${homeworldArrivalCue + 1}`;
    element('opening-counter').textContent = `${String(index + 1).padStart(2, '0')} / ${String(homeworldStops.length).padStart(2, '0')}`;
    setStatus('flight-status', 'Oberflächenstrukturen und Orbitalstation sind schematische Vorschauen.');
    next.hidden = false;
    setControlLabel(next, homeworldArrivalCue === 0
      ? 'Weiterlesen'
      : index === homeworldStops.length - 1 ? 'Herkunft wählen' : 'Nächste Heimatwelt');
    openingRemaining = cue.duration_ms;
    if (!openingPaused) scheduleOpening();
    const nextStop = cometNarration.stops.find((entry) => entry.code === homeworldStops[index + 1]?.code);
    const nextCue = stop.arrival[homeworldArrivalCue + 1] ?? nextStop?.transit[0];
    const nextClip = nextCue ? cometClip(nextCue.id)
      : index === homeworldStops.length - 1 ? cometMoment('tour-complete') : null;
    void narrate(clip, () => {}, nextClip);
  }

  function showHomeworld(index) {
    phase = 'homeworlds';
    chapter = index;
    openingPaused = false;
    homeworldTravel = true;
    homeworldWaitForManual = false;
    homeworldArrivalCue = 0;
    homeworldTransitResting = false;
    homeworldTransitComplete = false;
    homeworldCameraArrived = false;
    const species = homeworldStops[index];
    cancelCamera();
    showHomeworldTransit(index, 0);
    root.dataset.openingPaused = 'false';
    setControlLabel(element('opening-pause'), 'Pause');
    element('opening-pause').setAttribute('aria-pressed', 'false');
    previewHomeworld(species, () => {
      homeworldCameraArrived = true;
      if (!cinematicCampaign || homeworldTransitComplete) {
        afterNarration(() => showHomeworldArrival(index), 1);
      } else {
        setStatus('flight-status', 'Der Komet ist angekommen. Die Vorstellung läuft weiter.');
      }
    },
      () => showHomeworldArrival(index, true));
    if (document.hidden) setOpeningPaused(true);
  }

  function flyShuttle(landing = false) {
    phase = landing ? 'landing' : 'journey';
    openingPaused = false;
    const cinematicMoment = cinematicCampaign
      ? cometMoment(landing ? 'landing-confirmed' : 'shuttle-handoff')
      : null;
    frame(landing ? 'Ankunft auf deiner neuen Welt' : 'Aufbruch von deiner Heimatwelt',
      cinematicMoment?.text || (landing
        ? 'Dein Shuttle sinkt zum bestätigten Landeplatz. Danach übernimmt dein Kommandostand.'
        : 'Der Komet kreuzt den Kurs deines Shuttles. Im Vorbeiflug wechselst du an Bord und reist zu deinem privaten Sternsystem.'),
      landing ? 'Bestätigter Landeanflug' : 'Deine Reise');
    if (cinematicMoment) void narrate(cinematicMoment, () => {});
    setControlLabel(element('opening-pause'), 'Pause');
    element('opening-pause').setAttribute('aria-pressed', 'false');
    root.dataset.openingPaused = 'false';
    element('opening-counter').textContent = landing ? 'LANDUNG' : 'TRANSIT';
    const species = catalog.species.find((item) => item.code === selectedSpecies);
    setStatus('flight-status', landing ? 'Sinkflug zum bestätigten privaten Landeplatz.'
      : 'Der Komet trifft das Shuttle über deiner Heimatwelt.');
    next.hidden = false;
    setControlLabel(next, landing ? 'Landung überspringen' : 'Flug überspringen');
    directCamera({
      kind: landing ? 'landing' : 'journey',
      origin: landing ? draft : species.homeworld_scene,
      destination: draft,
      duration_ms: landing ? 6500 : 22000,
    }, () => {
      afterNarration(() => {
        if (landing) void enterDraft();
        else showSurface();
      }, 1);
    }, () => {
      setControlLabel(next, landing ? 'Ohne Kamera zum Tutorial' : 'Ohne Kamera zur Zielprüfung');
    });
    if (document.hidden) setOpeningPaused(true);
  }

  function showMentorRoom() {
    phase = 'mentor-room';
    selectedMentorDraft = null;
    selectedSpecies = '';
    const originPrompt = cinematicCampaign ? cometMoment('tour-complete') : null;
    frame(cinematicCampaign ? 'Deine Herkunft' : 'Die Heroldkammer',
      originPrompt?.text || 'Wähle die Spezies, deren Geschichte du weiterschreiben möchtest. Danach folgt dein Commander-Name.',
      'Herkunft / Entscheidung', { narration: originPrompt });
    if (originPrompt) void narrate(originPrompt, () => {
      if (!active || phase !== 'mentor-room' || selectedSpecies) return;
      const choicePrompt = cometMoment('choose-origin');
      element('story').textContent = choicePrompt.text;
      void narrate(choicePrompt, () => {});
    }, cometMoment('choose-origin'));
    if (!cinematicCampaign) preview({ stage: 'galaxy', beat: content.teaser.at(-1).id });
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
        catalog ? Promise.resolve(catalog) : request('register_catalog'),
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
      if (!cinematicCampaign) ensureHeraldStage(catalog.species);
    } catch (error) {
      if (!active || version !== revision) return;
      fail(error);
      element('retry').hidden = false;
    } finally {
      if (active && version === revision) busy = false;
    }
  }

  function activateMentor(species, candidate) {
    if (cinematicCampaign) stopNarration();
    selectedSpecies = species.code;
    selectedMentorDraft = candidate;
    element('choices').querySelectorAll('button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.choice === species.code));
    });
    heraldStage?.setSelected(species.code);
    const planet = candidate.planets?.find((item) => Number(item.position) === Number(candidate.target.position));
    const introduction = `Ich bin der Herold der ${species.name}. ${species.description}\n\nMein System heißt ${candidate.system_name}. Die mögliche Heimatwelt ist ${planet?.name || candidate.colony_name}.`;
    element('story').textContent = introduction;
    if (cinematicCampaign) {
      element('story').textContent = `${species.name} · ${species.homeworld}\n${species.description}`;
      previewHomeworld(species);
    } else {
      preview({ stage: 'planet', target: candidate.target, stars: candidate.stars, draft: candidate });
      void narrate({ id: `mentor-${species.code}`, text: introduction }, () => {});
    }
    next.hidden = false;
    next.disabled = false;
    setControlLabel(next, cinematicCampaign ? 'Herkunft bestätigen und Namen wählen' : 'System wählen und Tutorial starten');
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
      if (cinematicCampaign) await prepareCharacter();
      else showTutorial(0);
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
    element('story').textContent = `${planet.name} · ${planet.class}\n${Number(planet.diameter_km).toLocaleString('de-DE')} km Durchmesser · ${Number(planet.semi_major_axis_au).toFixed(2)} AU\nDies ist die für deinen privaten Draft reservierte Startwelt.`;
    preview({ stage: 'planet', target, stars: draft.stars, draft });
    next.hidden = false;
    next.disabled = false;
    setControlLabel(next, 'Planet scannen');
  }

  function showTutorial(index) {
    tutorialIndex = Math.max(0, Math.min(tutorialSteps.length - 1, index));
    phase = 'tutorial';
    const step = tutorialSteps[tutorialIndex];
    frame(step.title, step.text, `Schritt 3 / Tutorial ${tutorialIndex + 1} von ${tutorialSteps.length}`);
    if (tutorialIndex === 1 && selectedTutorialPlanet) {
      const planet = selectedTutorialPlanet;
      element('story').textContent = `${planet.name} · ${planet.class}\nDurchmesser: ${Number(planet.diameter_km).toLocaleString('de-DE')} km\nUmlaufbahn: ${Number(planet.semi_major_axis_au).toFixed(2)} AU\nStatus: kolonialisierbar · Reservierung: privat`;
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
      if (selectedTutorialPlanet) setControlLabel(next, 'Planet scannen');
    } else {
      setControlLabel(next, tutorialIndex === 1 ? 'Scan akzeptieren und Landeanflug starten' : 'Landeanflug bestätigen');
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
    const preserveCamera = cinematicCampaign && phase === 'mentor-room'
      && homeworldCameraCode === selectedSpecies;
    phase = 'character';
    frame('Wer übernimmt das Kommando?', 'Deine Identität entsteht in einem privaten Draft. Noch keine E-Mail, kein Passwort und keine aktive Welt.', 'Schritt 4 / Commander', { preserveCamera });
    element('character').hidden = false;
    element('character-form').inert = false;
    element('character-form').querySelector('button').disabled = false;
    element('name').value = draft.character?.name || '';
    element('background').value = draft.character?.background || '';
    element('draft-summary').hidden = false;
    element('draft-summary').textContent = `${draft.colony_name} [${draft.position.galaxy}:${draft.position.system}:${draft.position.position}] · Privat reserviert bis ${new Date(draft.expires_at).toLocaleString()}.`;
    if (cinematicCampaign && !preserveCamera) previewHomeworld(catalog.species.find((item) => item.code === selectedSpecies));
    else if (!cinematicCampaign) preview({ stage: 'planet', target: draft.target, stars: draft.stars, draft });
    setControlLabel(next, cinematicCampaign ? 'Shuttle starten' : 'Weiter zur Planetenoberfläche');
    next.hidden = !draft.character;
    root.dataset.beat = 'character-dossier';
    const narration = content.registration_steps?.find((clip) => clip.id === 'character-dossier');
    if (cinematicCampaign) void narrate(cometMoment('commander-name'), () => {});
    else if (narration) void narrate(narration, () => {});
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
      setControlLabel(next, cinematicCampaign ? 'Shuttle starten' : 'Startwelt-Vorschau anzeigen');
      next.hidden = false;
      void refreshPortrait();
      element('status').textContent = 'Charakter-Draft gespeichert. Deine private Welt ist reserviert und noch nicht aktiviert; du kannst die Reise starten.';
    } catch (error) {
      if (active && version === revision) fail(error);
    } finally {
      if (active && version === revision) { button.disabled = false; busy = false; }
    }
  }

  function close({ completed = false } = {}) {
    if (!active) return;
    active = false;
    busy = false;
    revision++;
    pendingNarrationTransition = null;
    stopOpening();
    slideMotion.reset();
    beginJourney = null;
    skipArrival = null;
    resetPortrait();
    stopNarration();
    root.hidden = true;
    root.dataset.transitionReady = 'true';
    document.body.classList.remove('registration-active');
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('gq:start-motion', onMotionChange);
    preview(null);
    heraldStage?.destroy();
    heraldStage = null;
    onClose({ completed });
  }

  function showSurface() {
    phase = 'surface';
    const destinationMoment = cinematicCampaign ? cometMoment('destination-orbit') : null;
    frame(cinematicCampaign ? 'Deine neue Welt' : 'Startwelt-Vorschau',
      destinationMoment?.text || 'Prüfe deinen Entwurf. Erst deine Bestätigung startet die Landung. Mit Zurück kannst du deine Angaben ändern.',
      'Zielprüfung / Bestätigung');
    element('surface').hidden = false;
    const species = catalog?.species.find((item) => item.code === draft.species_code);
    const planet = selectedTutorialPlanet
      || draft.planets.find((item) => Number(item.position) === Number(draft.position.position))
      || draft.planets[0];
    element('review-origin').textContent = species?.name || draft.species_code || 'Nicht festgelegt';
    element('review-system').textContent = draft.system_name || 'Nicht festgelegt';
    element('review-world').textContent = planet?.name || draft.colony_name || 'Nicht festgelegt';
    element('review-commander').textContent = draft.character?.name || 'Nicht festgelegt';
    element('review-background').textContent = draft.character?.background || 'Nicht festgelegt';
    element('review').hidden = false;
    element('status').textContent = 'Deine Startwelt ist bereit zum Spielen. Sie bleibt bis zur E-Mail-Bestätigung isoliert; dein Draft-Fortschritt läuft nicht ab.';
    preview({ stage: cinematicCampaign ? 'planet' : 'surface', target: draft.target, stars: draft.stars, draft });
    next.hidden = false;
    setControlLabel(next, cinematicCampaign ? 'Bestätigen und landen' : 'Draft-Welt betreten');
    root.dataset.beat = 'draft-review';
    const narration = content.registration_steps?.find((clip) => clip.id === 'draft-review');
    if (destinationMoment) void narrate(destinationMoment, () => {});
    else if (narration) void narrate(narration, () => {});
  }

  function back() {
    if (busy) { close(); return; }
    if (phase === 'opening') { if (chapter > 0) showOpening(chapter - 1); else close(); }
    else if (phase === 'homeworlds') { if (chapter > 0) showHomeworld(chapter - 1); else showOpening(content.opening.length - 1); }
    else if (phase === 'journey') showCharacter();
    else if (phase === 'landing') showSurface();
    else if (phase === 'arrival') close();
    else if (phase === 'teaser') { if (chapter > 0) showTeaser(chapter - 1); else close(); }
    else if (phase === 'mentor-room') showTeaser(content.teaser.length - 1);
    else if (phase === 'tutorial') {
      if (tutorialIndex > 0) showTutorial(tutorialIndex - 1);
      else showMentorRoom();
    }
    else if (phase === 'character') { if (cinematicCampaign) showMentorRoom(); else showTutorial(tutorialSteps.length - 1); }
    else if (phase === 'surface') showCharacter();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); back(); }
  }

  next.addEventListener('click', () => {
    if (busy) return;
    if (timedPhase()) advanceOpening();
    else if (phase === 'journey' || phase === 'landing') {
      if (root.dataset.cameraState === 'unavailable' || !onCamera) {
        if (phase === 'journey') showSurface();
        else void enterDraft();
      } else onCamera.finish();
    }
    else if (phase === 'arrival') {
      try {
        skipArrival?.();
      } catch (error) {
        window.GQLog?.warn?.('[registration-transition]', String(error?.message || error));
      }
      finishArrival(revision);
    } else if (phase === 'teaser') {
      if (chapter + 1 < content.teaser.length) showTeaser(chapter + 1);
      else showMentorRoom();
    }
    else if (phase === 'mentor-room') void selectMentorDraft();
    else if (phase === 'tutorial') {
      if (tutorialIndex + 1 < tutorialSteps.length) showTutorial(tutorialIndex + 1);
      else void prepareCharacter();
    }
    else if (phase === 'character') { if (cinematicCampaign) flyShuttle(); else showSurface(); }
    else if (phase === 'surface') { if (cinematicCampaign) flyShuttle(true); else void enterDraft(); }
  });
  async function enterDraft() {
    busy = true;
    next.disabled = true;
    element('error').textContent = '';
    const version = revision;
    try {
      if (typeof onEnterDraft !== 'function') throw new Error('Draft gameplay is not configured.');
      await onEnterDraft(draft.prolog_token);
      if (active && revision === version) {
        close({ completed: true });
        window.dispatchEvent(new Event('gq:draft-entered'));
      }
    } catch (error) {
      if (active && revision === version) fail(error);
    } finally {
      if (active && revision === version) { busy = false; next.disabled = false; }
    }
  }
  element('back').addEventListener('click', back);
  element('opening-pause').addEventListener('click', () => setOpeningPaused(!openingPaused));
  element('opening-skip').addEventListener('click', finishOpening);
  element('retry').addEventListener('click', () => { if (phase === 'homeworlds') void loadHomeworlds(); else void loadMentorDrafts(); });
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
    if (currentClip) void narrate(currentClip.clip, currentClip.done, currentClip.nextClip);
  });
  window.addEventListener('gq:audio-state', applyAudioSettings);
  const onMotionChange = (event) => {
    if (active && event.detail.reduced) {
      slideMotion.finish();
      onCamera?.finish();
    }
  };

  let skipArrival = null;
  function finishArrival(version) {
    if (!active || phase !== 'arrival' || revision !== version) return;
    skipArrival = null;
    root.dataset.transitionReady = 'true';
    showTeaser(0);
  }
  function failArrival(version, error) {
    if (!active || phase !== 'arrival' || revision !== version) return;
    window.GQLog?.warn?.('[registration-transition]', String(error?.message || error));
    finishArrival(version);
    setStatus('flight-status', 'Der Kamera-Anflug ist nicht verfügbar. Der Prolog wird ohne Anflug fortgesetzt.', true);
  }

  return {
    isActive: () => active,
    close,
    open({ transition, onSkipTransition, opening = false, campaign = false } = {}) {
      if (active) return;
      active = true;
      cinematicCampaign = campaign;
      catalog = null;
      homeworldStops = [];
      mentorDrafts = [];
      selectedMentorDraft = null;
      selectedTutorialPlanet = null;
      selectedSpecies = '';
      root.hidden = false;
      root.dataset.transitionReady = String(typeof transition !== 'function');
      document.body.classList.add('registration-active');
      document.addEventListener('keydown', onKeydown);
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('gq:start-motion', onMotionChange);
      beginJourney = () => {
        if (typeof transition !== 'function') {
          showTeaser(0);
          return;
        }
        phase = 'arrival';
        root.dataset.transitionReady = 'false';
        frame('Deine Reise beginnt', 'Ein neuer Kurs führt dich zu den Sternen der Konvergenz.', 'Anflug');
        root.dataset.beat = 'arrival';
        next.hidden = false;
        setControlLabel(next, 'Anflug überspringen');
        skipArrival = onSkipTransition;
        const version = revision;
        try {
          Promise.resolve(transition(() => {
            if (active && phase === 'arrival' && revision === version) root.dataset.transitionReady = 'true';
          })).then(
            (result) => result === false ? failArrival(version, 'Kamera-Anflug nicht verfügbar') : finishArrival(version),
            (error) => failArrival(version, error),
          );
        } catch (error) {
          failArrival(version, error);
        }
      };
      if (opening) showOpening(0);
      else {
        const begin = beginJourney;
        beginJourney = null;
        begin();
      }
    },
  };
}
