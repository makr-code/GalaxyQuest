import { animate } from 'motion/mini';

export function createRegistrationSlideMotion({ root, elements, isReduced }) {
  let controls = [];
  let ghosts = [];
  let revision = 0;
  let hasSlide = false;
  const properties = ['opacity', 'transform', 'letter-spacing'];

  function clearStyles() {
    elements.forEach((element) => properties.forEach((property) => element.style.removeProperty(property)));
  }

  function stop() {
    revision++;
    controls.forEach((control) => control.stop());
    controls = [];
    ghosts.forEach((ghost) => ghost.remove());
    ghosts = [];
  }

  function reset() {
    stop();
    clearStyles();
    hasSlide = false;
    root.dataset.slideMotion = 'idle';
  }

  function capture() {
    stop();
    if (hasSlide && !isReduced()) {
      for (const element of elements) {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (!element.textContent || !bounds.width || !bounds.height || Number.parseFloat(style.opacity) === 0) continue;
        const ghost = document.createElement(element.tagName);
        ghost.className = 'registration-slide-ghost';
        ghost.textContent = element.textContent;
        ghost.setAttribute('aria-hidden', 'true');
        ghost.inert = true;
        Object.assign(ghost.style, {
          position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`,
          width: `${bounds.width}px`, height: `${bounds.height}px`, margin: '0',
          font: style.font, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight,
          textAlign: style.textAlign, whiteSpace: style.whiteSpace,
          color: style.color, textShadow: style.textShadow, opacity: style.opacity,
        });
        root.append(ghost);
        ghosts.push(ghost);
      }
    }
    clearStyles();
  }

  async function play({ titleShot = false, paused = false } = {}) {
    const version = revision;
    hasSlide = true;
    if (isReduced() || paused) {
      reset();
      hasSlide = true;
      if (paused) root.dataset.slideMotion = 'paused';
      return;
    }
    root.dataset.slideMotion = 'running';
    try {
      controls = ghosts.map((ghost) => animate(ghost, {
        opacity: 0, transform: ['translateY(0)', 'translateY(-8px)'],
      }, { duration: 0.2, ease: [0.4, 0, 1, 1] }));
      elements.filter((element) => element.textContent).forEach((element, index) => {
        const cinematicTitle = titleShot && element.id === 'registration-title';
        controls.push(animate(element, {
          opacity: [0, 1],
          transform: cinematicTitle
            ? ['perspective(800px) translate3d(0, -55px, -600px)', 'perspective(800px) translate3d(0, 0, 0)']
            : ['translateY(10px)', 'translateY(0)'],
          ...(cinematicTitle ? { letterSpacing: ['.18em', '.04em'] } : {}),
        }, {
          duration: cinematicTitle ? 2.4 : 0.5,
          delay: (ghosts.length ? 0.12 : 0) + index * 0.05,
          ease: [0.16, 1, 0.3, 1],
        }));
      });
      await Promise.all(controls.map((control) => Promise.resolve(control)));
      if (revision !== version) return;
      controls = [];
      ghosts.forEach((ghost) => ghost.remove());
      ghosts = [];
      clearStyles();
      root.dataset.slideMotion = 'idle';
    } catch (error) {
      if (revision === version) reset();
      throw error;
    }
  }

  function activeControls() {
    return controls.filter((control) => control.state !== 'finished');
  }

  return {
    capture,
    play,
    reset,
    pause: () => { activeControls().forEach((control) => control.pause()); root.dataset.slideMotion = 'paused'; },
    resume: () => { const active = activeControls(); active.forEach((control) => control.play()); root.dataset.slideMotion = active.length ? 'running' : 'idle'; },
    finish: () => { activeControls().forEach((control) => control.complete()); },
  };
}
