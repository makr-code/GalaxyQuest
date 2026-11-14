import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animate } from 'motion/mini';
import { createStartScreenMotion } from '../../js/network/start-screen-motion.js';

vi.mock('motion/mini', () => ({ animate: vi.fn() }));

let animations;
let menu;
let motion;
let reduced;

beforeEach(() => {
  animations = [];
  reduced = false;
  document.body.innerHTML = `<div id="start-menu">
    <p class="start-eyebrow">Archive</p><h1 class="start-title">GalaxyQuest</h1>
    <nav class="start-navigation"><div>Login</div><div>Campaign</div><button hidden>Resume</button></nav>
    <div class="start-music-player">Music</div><p class="start-session-status">Ready</p>
  </div><section id="boot-terminal">Log</section>`;
  animate.mockReset().mockImplementation(() => {
    let resolve;
    const finished = new Promise((done) => { resolve = done; });
    const control = { then: finished.then.bind(finished), stop: vi.fn(), complete: vi.fn(resolve), resolve };
    animations.push(control);
    return control;
  });
  menu = document.getElementById('start-menu');
  motion = createStartScreenMotion({ menu, isReduced: () => reduced });
});

describe('Start-screen motion', () => {
  it('flies visible controls in from all four edges and waits for every exit before continuing', async () => {
    const entered = motion.enter();
    expect(new Set(animate.mock.calls.map(([node]) => node.dataset.motionDirection)))
      .toEqual(new Set(['left', 'right', 'top', 'bottom']));
    expect(animate.mock.calls.some(([node]) => node.hidden)).toBe(false);
    expect(animate.mock.calls.every(([, frames]) => frames.opacity[0] === 0 && frames.opacity[1] === 1)).toBe(true);
    animations.forEach((animation) => animation.resolve());
    expect(await entered).toBe(true);
    expect(menu.dataset.motionState).toBe('visible');
    const firstExit = animations.length;
    const exited = motion.exit();
    const finished = vi.fn();
    exited.then(finished);
    animations.slice(firstExit, -1).forEach((animation) => animation.resolve());
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    animations.at(-1).resolve();
    expect(await exited).toBe(true);
    expect(menu.dataset.motionState).toBe('hidden');
  });

  it('cancels a pending exit on return and ignores late completion', async () => {
    const exiting = motion.exit();
    const stale = [...animations];
    const entering = motion.enter();
    expect(await exiting).toBe(false);
    expect(stale.every((animation) => animation.stop.mock.calls.length === 1)).toBe(true);
    stale.forEach((animation) => animation.resolve());
    await Promise.resolve();
    expect(menu.dataset.motionState).toBe('entering');
    animations.forEach((animation) => animation.resolve());
    expect(await entering).toBe(true);
    expect(menu.dataset.motionState).toBe('visible');
  });

  it('uses no animated movement with reduced motion and can complete animations on preference changes', async () => {
    reduced = true;
    expect(await motion.enter()).toBe(true);
    expect(await motion.exit()).toBe(true);
    expect(animate).not.toHaveBeenCalled();
    reduced = false;
    const entering = motion.enter();
    motion.finish();
    expect(await entering).toBe(true);
    expect(animations.every((animation) => animation.complete.mock.calls.length === 1)).toBe(true);
  });
});
