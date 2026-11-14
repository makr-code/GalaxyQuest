import { animate } from 'motion/mini';

export function createStartScreenMotion({ menu, isReduced }) {
  const groups = [
    ['.start-eyebrow', 'top'],
    ['.start-title, .start-tagline', 'left'],
    ['.start-navigation > *', 'left'],
    ['.start-music-player', 'right'],
    ['.start-session-status, .start-galaxy-source, .start-credits', 'bottom'],
  ];
  const targets = groups.flatMap(([selector, direction]) =>
    [...menu.querySelectorAll(selector)].map((element) => ({ element, direction })));
  const terminal = document.getElementById('boot-terminal');
  if (terminal) targets.push({ element: terminal, direction: 'bottom' });
  let controls = [];
  let finishPending = null;
  let revision = 0;
  let initialized = false;

  function stop() {
    revision++;
    controls.forEach((control) => control.stop());
    controls = [];
    finishPending?.(false);
    finishPending = null;
  }

  function clearStyles() {
    targets.forEach(({ element }) => {
      element.style.removeProperty('opacity');
      element.style.removeProperty('transform');
    });
  }

  function offset(element, direction) {
    const rect = element.getBoundingClientRect();
    const transform = getComputedStyle(element).transform;
    const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null;
    const left = rect.left - (matrix?.m41 || 0);
    const top = rect.top - (matrix?.m42 || 0);
    const horizontal = direction === 'left' || direction === 'right';
    const distance = horizontal
      ? direction === 'left' ? -left - rect.width - 32 : window.innerWidth - left + 32
      : direction === 'top' ? -top - rect.height - 32 : window.innerHeight - top + 32;
    return horizontal ? `translateX(${distance}px)` : `translateY(${distance}px)`;
  }

  function run(entering) {
    stop();
    const version = revision;
    menu.dataset.motionState = entering ? 'entering' : 'exiting';
    if (isReduced()) {
      clearStyles();
      menu.dataset.motionState = entering ? 'visible' : 'hidden';
      initialized = true;
      return Promise.resolve(true);
    }
    const visible = targets.filter(({ element }) =>
      !element.hidden && !element.closest('[hidden]') && getComputedStyle(element).display !== 'none');
    const firstEntrance = entering && !initialized;
    initialized = true;
    const completion = new Promise((resolve) => { finishPending = resolve; });
    try {
      controls = visible.map(({ element, direction }, index) => {
        element.dataset.motionDirection = direction;
        const displaced = offset(element, direction);
        return animate(element, {
          transform: entering ? firstEntrance ? [displaced, 'none'] : 'none' : displaced,
          opacity: entering ? firstEntrance ? [0, 1] : 1 : 0,
        }, {
          duration: entering ? 0.8 : 0.5,
          delay: index * (entering ? 0.045 : 0.018),
          ease: entering ? [0.16, 1, 0.3, 1] : [0.7, 0, 0.84, 0],
        });
      });
    } catch (error) {
      stop();
      clearStyles();
      menu.dataset.motionState = 'visible';
      throw error;
    }
    Promise.all(controls.map((control) => Promise.resolve(control))).then(() => {
      if (revision !== version) return;
      controls = [];
      if (entering) clearStyles();
      menu.dataset.motionState = entering ? 'visible' : 'hidden';
      const finish = finishPending;
      finishPending = null;
      finish(true);
    });
    return completion;
  }

  return {
    enter: () => run(true),
    exit: () => run(false),
    finish: () => controls.forEach((control) => control.complete()),
  };
}
