import { BabylonColonyAdapter, colonyFixture } from './BabylonColonyAdapter.js';
import { FrameCapture, environmentMetadata } from './benchmark.js';
import { createNativeColony } from './native-colony.js';

const $ = id => document.getElementById(id);
let renderer, capture, raf, previous, epoch = 0, switching = false;
const results = [];
const data = colonyFixture();
const status = message => { $('status').textContent = message; };

function freshCanvas() {
  const old = $('view');
  const canvas = old.cloneNode(false);
  canvas.width = 960;
  canvas.height = 600;
  old.replaceWith(canvas);
  return canvas;
}

function stop() {
  epoch++;
  cancelAnimationFrame(raf);
  capture?.cancel('Renderer changed or page closed');
  capture = null;
  renderer?.dispose();
  renderer = null;
  $('measure').disabled = true;
}

async function switchRenderer() {
  if (switching) return;
  switching = true;
  $('start').disabled = true;
  stop();
  const token = epoch;
  const started = performance.now();
  status('Loading isolated renderer…');
  let candidate;
  try {
    const canvas = freshCanvas();
    candidate = $('backend').value === 'native' ? await createNativeColony(canvas) :
      new BabylonColonyAdapter({
        forceWebGL: $('backend').value === 'webgl',
        onSelect: id => { $('selection').textContent = `Selected ${id}`; },
        onInvalidated: message => {
          if (token !== epoch) return;
          capture?.cancel(message);
          stop();
          candidate?.dispose();
          status(message);
        },
      });
    if (candidate instanceof BabylonColonyAdapter) await candidate.initialize(canvas);
    if (token !== epoch) { candidate.dispose(); return; }
    candidate.setSceneData(data);
    await candidate.enter(null, data);
    if (token !== epoch) { candidate.dispose(); return; }
    renderer = candidate;
    renderer.render(0);
    renderer.startupMs = performance.now() - started;
    renderer.resourceStart = started;
    status(`${renderer.backend}${renderer.fallbackReason ? ` — ${renderer.fallbackReason}` : ''}. Ready.`);
    $('selection').textContent = $('backend').value === 'native'
      ? 'Native simplified reference: rows overlap (z ignored); no camera navigation or picking. Not matched visual work.' : 'Drag to orbit, wheel to zoom, right-drag to pan; click a building.';
    $('measure').disabled = document.hidden;
    candidate.lost?.then(info => {
      if (renderer === candidate) {
        const message = `Native GPU device lost: ${info.message}. Reload the renderer before measuring.`;
        capture?.cancel(message);
        stop();
        status(message);
      }
    });
    previous = performance.now();
    const tick = time => {
      if (token !== epoch) return;
      try {
        if (!document.hidden) {
          const begin = performance.now();
          renderer.render((time - previous) / 1000);
          capture?.observe(begin, performance.now() - begin);
        }
        previous = time;
        raf = requestAnimationFrame(tick);
      } catch (error) { stop(); status(`Render failed: ${error.message}`); }
    };
    raf = requestAnimationFrame(tick);
  } catch (error) {
    candidate?.dispose();
    status(`Initialization failed: ${error.message || error}`);
  } finally {
    switching = false;
    $('start').disabled = false;
  }
}

$('start').addEventListener('click', switchRenderer);
$('measure').addEventListener('click', async () => {
  if (!renderer || capture || document.hidden) return;
  const current = capture = new FrameCapture({
    warmup: 60, samples: 240, startupMs: renderer.startupMs, resourceStart: renderer.resourceStart,
    metadata: environmentMetadata(renderer.canvas, {
      source: 'synthetic-same-data-colony', scene: 'colony', backend: renderer.backend,
      fixture: data.fixture, slots: data.slots.length, babylonVersion: '9.33.1',
      visualParity: false, camera: 'interactive; leave unchanged during capture',
    }),
  });
  $('measure').disabled = true;
  $('cancel').disabled = false;
  status('Warming up 60 calls, sampling 240 intervals (30 second limit)…');
  try {
    results.push(await current.promise);
    $('results').textContent = JSON.stringify(results, null, 2);
    $('export').disabled = false;
    status('Capture complete. These are local synthetic measurements, not live-game baselines.');
  } catch (error) { status(error.message); } finally {
    if (capture === current) capture = null;
    $('measure').disabled = !renderer || document.hidden;
    $('cancel').disabled = true;
  }
});
$('cancel').addEventListener('click', () => capture?.cancel());
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'gq-colony-evaluation.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('visibilitychange', () => {
  $('measure').disabled = document.hidden || !renderer || !!capture;
});
window.addEventListener('pagehide', stop);
