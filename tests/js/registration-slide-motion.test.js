import { beforeEach, describe, expect, it, vi } from 'vitest';
import { animate } from 'motion/mini';
import { createRegistrationSlideMotion } from '../../js/network/registration-slide-motion.js';

vi.mock('motion/mini', () => ({ animate: vi.fn() }));

let root;
let elements;
let motion;
let reduced;
let animations;

beforeEach(() => {
  document.body.innerHTML = `<section id="registration-prologue">
    <p id="registration-chapter">Chapter</p><h2 id="registration-title">Old title</h2>
    <p id="registration-story">Old story</p>
  </section>`;
  root = document.getElementById('registration-prologue');
  elements = [...root.children];
  elements.forEach((element) => {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 600, width: 400, height: 40 });
  });
  reduced = false;
  animations = [];
  animate.mockReset().mockImplementation(() => {
    let resolve;
    const finished = new Promise((done) => { resolve = done; });
    const complete = () => { control.state = 'finished'; resolve(); };
    const control = {
      state: 'running',
      then: finished.then.bind(finished), stop: vi.fn(), pause: vi.fn(), play: vi.fn(),
      complete: vi.fn(complete), resolve: complete,
    };
    animations.push(control);
    return control;
  });
  motion = createRegistrationSlideMotion({ root, elements, isReduced: () => reduced });
});

describe('Registration slide motion', () => {
  it('crossfades an inert visual copy of outgoing text while the actual slide is immediately current', async () => {
    motion.capture();
    const first = motion.play();
    animations.forEach((control) => control.resolve());
    await first;
    motion.capture();
    elements[1].textContent = 'New title';
    const next = motion.play({ titleShot: true });
    const ghosts = [...root.querySelectorAll('.registration-slide-ghost')];
    expect(ghosts).toHaveLength(3);
    expect(ghosts[1].textContent).toBe('Old title');
    expect(ghosts.every((ghost) => ghost.inert && ghost.getAttribute('aria-hidden') === 'true' && !ghost.id)).toBe(true);
    expect(elements[1].textContent).toBe('New title');
    expect(animate).toHaveBeenCalledWith(elements[1],
      expect.objectContaining({ letterSpacing: ['.18em', '.04em'] }), expect.objectContaining({ duration: 2.4 }));
    motion.pause();
    expect(root.dataset.slideMotion).toBe('paused');
    expect(animations.slice(3).every((control) => control.pause.mock.calls.length === 1)).toBe(true);
    motion.resume();
    expect(animations.slice(3).every((control) => control.play.mock.calls.length === 1)).toBe(true);
    animations.forEach((control) => control.resolve());
    await next;
    expect(root.querySelectorAll('.registration-slide-ghost')).toHaveLength(0);
    expect(root.dataset.slideMotion).toBe('idle');
  });

  it('ignores late completion after navigation and clears visual copies on close', async () => {
    const first = motion.play();
    const old = [...animations];
    motion.capture();
    const second = motion.play();
    old.forEach((control) => control.resolve());
    await first;
    expect(root.dataset.slideMotion).toBe('running');
    motion.reset();
    expect(root.querySelectorAll('.registration-slide-ghost')).toHaveLength(0);
    animations.forEach((control) => control.resolve());
    await second;
    expect(root.dataset.slideMotion).toBe('idle');
    expect(animations.every((control) => control.stop.mock.calls.length === 1)).toBe(true);
  });

  it('skips animation with reduced motion and immediately finishes an active transition', async () => {
    reduced = true;
    motion.capture();
    await motion.play({ titleShot: true });
    expect(animate).not.toHaveBeenCalled();
    reduced = false;
    const playing = motion.play();
    motion.finish();
    await playing;
    expect(animations.every((control) => control.complete.mock.calls.length === 1)).toBe(true);
    expect(root.dataset.slideMotion).toBe('idle');
  });

  it('shows manually advanced text immediately while the prologue is paused', async () => {
    motion.capture();
    const first = motion.play();
    animations.forEach((control) => control.resolve());
    await first;
    motion.capture();
    elements[2].textContent = 'New story';
    await motion.play({ paused: true });
    expect(animate).toHaveBeenCalledTimes(3);
    expect(root.querySelectorAll('.registration-slide-ghost')).toHaveLength(0);
    expect(elements[2].style.opacity).toBe('');
    expect(root.dataset.slideMotion).toBe('paused');
    motion.resume();
    expect(root.dataset.slideMotion).toBe('idle');
  });

  it('does not restart completed text effects while controlling the longer title shot', async () => {
    const playing = motion.play({ titleShot: true });
    const [chapter, title, story] = animations;
    chapter.resolve();
    story.resolve();
    motion.pause();
    motion.resume();
    motion.finish();
    await playing;
    for (const control of [chapter, story]) {
      expect(control.pause).not.toHaveBeenCalled();
      expect(control.play).not.toHaveBeenCalled();
      expect(control.complete).not.toHaveBeenCalled();
    }
    expect(title.pause).toHaveBeenCalledOnce();
    expect(title.play).toHaveBeenCalledOnce();
    expect(title.complete).toHaveBeenCalledOnce();
  });
});
