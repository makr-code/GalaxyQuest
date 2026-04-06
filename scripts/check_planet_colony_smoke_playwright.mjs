import { chromium } from 'playwright';

const BASE_URL = String(process.env.GQ_BASE_URL || 'http://localhost:8080');
const DEFAULT_USER = String(process.env.GQ_USER || 'default_user');
const DEFAULT_PASS = String(process.env.GQ_PASS || 'User!23456');
const STRICT_NATIVE_ONLY = String(process.env.GQ_PLANET_COLONY_STRICT || '0').toLowerCase() === '1';

async function installRendererFriendlyCdnStubs(page) {
  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/dexie@')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: [
          'window.Dexie = class Dexie {',
          '  constructor() {}',
          '  version() { return this; }',
          '  stores() { return this; }',
          '  table() { return { put: async()=>{}, get: async()=>null, toArray: async()=>[], clear: async()=>{} }; }',
          '  open() { return Promise.resolve(this); }',
          '  close() {}',
          '  static delete() { return Promise.resolve(); }',
          '};',
        ].join('\n'),
      });
      return;
    }
    if (url.includes('/three@')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.THREE = window.THREE || {};',
      });
      return;
    }
    if (url.includes('/mustache@')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.Mustache = window.Mustache || { render: function(tpl){ return String(tpl || ""); } };',
      });
      return;
    }
    await route.continue();
  });
}

async function getCsrfToken(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth.php?action=csrf', {
      method: 'GET',
      credentials: 'include',
    });
    const body = await response.json();
    return String(body?.token || '');
  });
}

async function hasAuthenticatedSession(page) {
  return page.evaluate(async () => {
    try {
      const response = await fetch('/api/auth.php?action=me', {
        method: 'GET',
        credentials: 'include',
      });
      const body = await response.json();
      return response.ok && body?.success === true;
    } catch (_) {
      return false;
    }
  });
}

async function devResetPassword(page, username, password) {
  const csrf = await getCsrfToken(page);
  if (!csrf) return { ok: false, reason: 'missing-csrf' };
  return page.evaluate(async ({ csrfToken, user, pass }) => {
    const response = await fetch('/api/auth.php?action=dev_reset_password', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ username: user, password: pass }),
    });
    let body = null;
    try {
      body = await response.json();
    } catch (_) {}
    return {
      ok: response.ok && body?.success === true,
      status: response.status,
      error: String(body?.error || ''),
    };
  }, { csrfToken: csrf, user: username, pass: password });
}

async function loginViaUi(page, username, password) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#login-username').waitFor({ state: 'visible', timeout: 20000 });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('#login-form button[type="submit"]');

  const started = Date.now();
  while ((Date.now() - started) < 30000) {
    const ok = await hasAuthenticatedSession(page);
    if (ok) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function openHomeSystem(page) {
  const result = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const wm = window.WM;
    const runConsoleHome = async () => {
      const cmd = window.GQUIConsoleCommandController;
      if (!cmd || typeof cmd.execute !== 'function') return false;
      try {
        await cmd.execute('home');
        return true;
      } catch (_) {
        return false;
      }
    };

    if (!wm || typeof wm.open !== 'function' || typeof wm.body !== 'function') {
      return { ok: false, reason: 'wm-missing' };
    }

    wm.open('galaxy');
    let root = wm.body('galaxy');
    for (let i = 0; i < 40 && !root; i += 1) {
      await wait(100);
      root = wm.body('galaxy');
    }
    if (!root) {
      return { ok: false, reason: 'galaxy-root-missing' };
    }

    let galaxyController = window.GQGalaxyController;
    for (let i = 0; i < 40 && (!galaxyController || typeof galaxyController.focusHomeSystem !== 'function'); i += 1) {
      await wait(100);
      galaxyController = window.GQGalaxyController;
    }

    if (galaxyController && typeof galaxyController.focusHomeSystem === 'function') {
      await galaxyController.focusHomeSystem(root, {
        silent: true,
        cinematic: false,
        enterSystem: true,
        focusPlanet: true,
      });
      return { ok: true, path: 'controller' };
    }

    const okHome = await runConsoleHome();
    return okHome ? { ok: true, path: 'console-home' } : { ok: false, reason: 'home-failed' };
  });

  if (!result?.ok) {
    throw new Error(`openHomeSystem failed: ${result?.reason || 'unknown'}`);
  }
  return result;
}

async function evaluatePlanetColonyState(page, opts = {}) {
  return page.evaluate(async (config) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const strictNativeOnly = !!config?.strictNativeOnly;
    const wm = window.WM;
    const openBuildingsWindowFallback = async () => {
      if (strictNativeOnly) return false;
      if (!wm || typeof wm.open !== 'function') return false;
      try {
        wm.open('colony');
        await wait(120);
        wm.open('buildings');
        await wait(120);
      } catch (_) {}
      return !!(wm && typeof wm.isOpen === 'function' && (wm.isOpen('colony') || wm.isOpen('buildings')));
    };

    const state = {
      colonyActionVisible: false,
      colonyWindowOpen: false,
      buildingsWindowOpen: false,
      planetApproachSignal: false,
      planetApproachNativeSignal: false,
      selectionKind: String(window.GQGalaxyController?.getSelectionState?.()?.active?.kind || ''),
      rendererBackend: String(window.__GQ_ACTIVE_RENDERER_BACKEND || ''),
      fallbackPath: 'none',
      strictNativeOnly,
      diagnostics: {
        wmPresent: !!wm,
        galaxyControllerPresent: !!window.GQGalaxyController,
        galaxyControllerMethods: {
          focusHomeSystem: typeof window.GQGalaxyController?.focusHomeSystem === 'function',
          getSelectionState: typeof window.GQGalaxyController?.getSelectionState === 'function',
        },
      },
    };

    const detectPlanetSignal = () => {
      const selectionKind = String(window.GQGalaxyController?.getSelectionState?.()?.active?.kind || state.selectionKind || '');
      const detailPanelVisible = !!document.querySelector('[data-colony-action="colony"], #colony-open-buildings-btn, .planet-detail-3d');
      return selectionKind === 'planet' || detailPanelVisible;
    };

    const detectNativePlanetSignal = () => {
      const selectionKind = String(window.GQGalaxyController?.getSelectionState?.()?.active?.kind || state.selectionKind || '');
      const colonyActionVisible = !!document.querySelector('[data-colony-action="colony"]');
      return selectionKind === 'planet' || colonyActionVisible;
    };

    state.planetApproachSignal = detectPlanetSignal();
    state.planetApproachNativeSignal = detectNativePlanetSignal();

    for (let i = 0; i < 50; i += 1) {
      const colonyAction = document.querySelector('[data-colony-action="colony"]');
      const isVisible = !!(colonyAction && colonyAction.offsetParent !== null);
      if (isVisible) {
        state.colonyActionVisible = true;
        colonyAction.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        state.planetApproachSignal = true;
        break;
      }
      await wait(120);
      if (!state.planetApproachSignal) {
        state.planetApproachSignal = detectPlanetSignal();
      }
      if (!state.planetApproachNativeSignal) {
        state.planetApproachNativeSignal = detectNativePlanetSignal();
      }
    }

    state.diagnostics.colonyActionButtonExists = !!document.querySelector('[data-colony-action="colony"]');
    state.diagnostics.colonyOpenBuildingsBtnExists = !!document.querySelector('#colony-open-buildings-btn');
    state.diagnostics.planetDetailVisible = !!document.querySelector('.planet-detail-3d');
    state.diagnostics.nativeSignalProbe = {
      selectionKind: String(window.GQGalaxyController?.getSelectionState?.()?.active?.kind || ''),
      colonyActionVisible: !!document.querySelector('[data-colony-action="colony"]'),
    };

    if (!strictNativeOnly && !state.colonyActionVisible) {
      const colonyOpenBtn = document.querySelector('#colony-open-buildings-btn');
      if (colonyOpenBtn) {
        colonyOpenBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        state.fallbackPath = 'colony-open-buildings-btn';
      }
    }

    for (let i = 0; i < 30; i += 1) {
      state.colonyWindowOpen = !!(wm && typeof wm.isOpen === 'function' && wm.isOpen('colony'));
      if (state.colonyWindowOpen) break;
      await wait(100);
    }

    if (state.colonyWindowOpen) {
      const openBuildingsBtn = document.querySelector('[data-colony-action="buildings"], #colony-open-buildings-btn');
      if (openBuildingsBtn) {
        openBuildingsBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    } else {
      const fallbackOk = await openBuildingsWindowFallback();
      if (fallbackOk) state.fallbackPath = 'wm-open-fallback';
    }

    for (let i = 0; i < 30; i += 1) {
      state.colonyWindowOpen = state.colonyWindowOpen || !!(wm && typeof wm.isOpen === 'function' && wm.isOpen('colony'));
      state.buildingsWindowOpen = !!(wm && typeof wm.isOpen === 'function' && wm.isOpen('buildings'));
      if (state.buildingsWindowOpen) break;
      await wait(100);
    }

    state.diagnostics.windowState = {
      colonyOpen: !!(wm && typeof wm.isOpen === 'function' && wm.isOpen('colony')),
      buildingsOpen: !!(wm && typeof wm.isOpen === 'function' && wm.isOpen('buildings')),
      galaxyOpen: !!(wm && typeof wm.isOpen === 'function' && wm.isOpen('galaxy')),
    };

    const selectionSnapshot = window.GQGalaxyController?.getSelectionState?.() || {};
    state.diagnostics.selectionSnapshot = {
      mode: String(selectionSnapshot?.mode || ''),
      source: String(selectionSnapshot?.source || ''),
      activeKind: String(selectionSnapshot?.active?.kind || ''),
      hoverKind: String(selectionSnapshot?.hover?.kind || ''),
      groupKind: String(selectionSnapshot?.group?.kind || ''),
      groupSize: Number(selectionSnapshot?.group?.size || 0),
      multiSelectionSize: Array.isArray(selectionSnapshot?.multiSelection) ? selectionSnapshot.multiSelection.length : 0,
    };

    return state;
  }, { strictNativeOnly: !!opts.strictNativeOnly });
}

async function evaluateMinimapInteractionState(page) {
  const prepared = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const wm = window.WM;
    if (!wm || typeof wm.open !== 'function' || typeof wm.body !== 'function') {
      return { ok: false, reason: 'wm-missing' };
    }

    // Only open galaxy if not already open — wm.open on an existing window
    // triggers a full re-render that clears galaxyStars and reloads async.
    if (!wm.isOpen('galaxy')) wm.open('galaxy');
    wm.open('minimap');
    if (typeof wm.refresh === 'function') {
      try { wm.refresh('minimap'); } catch (_) {}
    }

    let minimapRoot = wm.body('minimap');
    for (let i = 0; i < 40 && !minimapRoot; i += 1) {
      await wait(100);
      minimapRoot = wm.body('minimap');
    }
    if (!minimapRoot) {
      return { ok: false, reason: 'minimap-root-missing' };
    }

    let canvas = minimapRoot.querySelector('.minimap-canvas');
    for (let i = 0; i < 40 && !canvas; i += 1) {
      await wait(100);
      canvas = minimapRoot.querySelector('.minimap-canvas');
    }
    if (!(canvas instanceof HTMLCanvasElement)) {
      return { ok: false, reason: 'minimap-canvas-missing' };
    }

    for (let i = 0; i < 80 && (!canvas.__minimapState || !canvas.__minimapState.stars?.length); i += 1) {
      if (typeof wm.refresh === 'function') {
        try { wm.refresh('minimap'); } catch (_) {}
      }
      await wait(100);
      minimapRoot = wm.body('minimap') || minimapRoot;
      canvas = minimapRoot?.querySelector('.minimap-canvas') || canvas;
    }

    const state = canvas.__minimapState;
    if (!state || !Array.isArray(state.stars) || !state.stars.length) {
      return { ok: false, reason: 'minimap-state-missing' };
    }

    const rect = canvas.getBoundingClientRect();
    const activeSystemIndex = Number(window.uiState?.activeStar?.system_index || window.pinnedStar?.system_index || 0);
    const projectedPoint = (star) => ({
      x: state.offX + (Number(star?.x_ly || 0) - state.minX) * state.scale,
      y: state.offY + (Number(star?.y_ly || 0) - state.minY) * state.scale,
    });

    let clickStar = null;
    let clickPoint = null;
    for (const star of state.stars) {
      const systemIndex = Number(star?.system_index || 0);
      if (!systemIndex || systemIndex === activeSystemIndex) continue;
      const point = projectedPoint(star);
      if (point.x < 16 || point.x > (rect.width - 16) || point.y < 16 || point.y > (rect.height - 16)) continue;
      clickStar = star;
      clickPoint = point;
      break;
    }

    if (!clickStar || !clickPoint) {
      return {
        ok: false,
        reason: 'minimap-click-star-missing',
        diagnostics: {
          starCount: Number(state.stars.length || 0),
          activeSystemIndex,
        },
      };
    }

    return {
      ok: true,
      canvasRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      initialPose: state.pose || null,
      activeSystemIndex,
      clickTarget: {
        systemIndex: Number(clickStar.system_index || 0),
        galaxyIndex: Number(clickStar.galaxy_index || 0),
        canvasX: clickPoint.x,
        canvasY: clickPoint.y,
        clientX: rect.left + clickPoint.x,
        clientY: rect.top + clickPoint.y,
      },
      diagnostics: {
        rendererBackend: String(window.__GQ_ACTIVE_RENDERER_BACKEND || ''),
        minimapHudBackend: String(minimapRoot.querySelector('.minimap-hud')?.dataset?.backend || ''),
        starCount: Number(state.stars.length || 0),
        galaxyStarCount: Number(Array.isArray(window.galaxyStars) ? window.galaxyStars.length : -1),
      },
    };
  });

  if (!prepared?.ok) {
    return Object.assign({
      canvasPresent: false,
      clickNavigationOk: false,
      dragChangedPose: false,
      zoomChanged: false,
      diagnostics: {},
    }, prepared || {});
  }

  const canvasX = prepared.clickTarget.clientX;
  const canvasY = prepared.clickTarget.clientY;

  // Register an event listener before the click so we can detect the
  // gq:minimap-navigate event that the minimap fires on star-click.
  await page.evaluate(() => {
    window.__minimapNavFired = null;
    window.addEventListener('gq:minimap-navigate', (e) => {
      window.__minimapNavFired = { galaxy: e.detail?.galaxy, system: e.detail?.system };
    }, { once: true });
  });

  await page.mouse.move(canvasX, canvasY);
  await page.mouse.click(canvasX, canvasY);
  await page.waitForTimeout(400);

  const afterClick = await page.evaluate(({ expectedSystemIndex }) => {
    const navFired = window.__minimapNavFired || null;
    const canvas = document.querySelector('.minimap-canvas');
    const state = canvas?.__minimapState || null;
    return {
      navSystem: Number(navFired?.system || 0),
      navGalaxy: Number(navFired?.galaxy || 0),
      pose: state?.pose || null,
      ok: navFired !== null && Number(navFired.system || 0) === Number(expectedSystemIndex || 0),
    };
  }, { expectedSystemIndex: prepared.clickTarget.systemIndex });

  // Use the canvas visual centre as drag origin — reliable regardless of
  // where the virtual camera target currently sits.
  const dragStart = await page.evaluate(() => {
    const canvas = document.querySelector('.minimap-canvas');
    const state = canvas?.__minimapState || null;
    if (!canvas || !state) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return { clientX: cx, clientY: cy, pose: state.pose || null };
  });

  let afterDrag = null;
  if (dragStart) {
    await page.mouse.move(dragStart.clientX, dragStart.clientY);
    await page.mouse.down();
    await page.mouse.move(dragStart.clientX + 34, dragStart.clientY + 18, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(180);
    afterDrag = await page.evaluate(() => {
      const canvas = document.querySelector('.minimap-canvas');
      const state = canvas?.__minimapState || null;
      return { pose: state?.pose || null };
    });
  }

  const beforeZoom = await page.evaluate(() => {
    const canvas = document.querySelector('.minimap-canvas');
    return canvas?.__minimapState?.pose || null;
  });

  await page.mouse.move(canvasX, canvasY);
  await page.mouse.wheel(0, -140);
  await page.waitForTimeout(180);

  const afterZoom = await page.evaluate(() => {
    const canvas = document.querySelector('.minimap-canvas');
    return canvas?.__minimapState?.pose || null;
  });

  const dragDeltaX = afterDrag?.pose && dragStart?.pose
    ? Math.abs(Number(afterDrag.pose.targetX || 0) - Number(dragStart.pose.targetX || 0))
    : 0;
  const dragDeltaY = afterDrag?.pose && dragStart?.pose
    ? Math.abs(Number(afterDrag.pose.targetY || 0) - Number(dragStart.pose.targetY || 0))
    : 0;
  const zoomDelta = afterZoom && beforeZoom
    ? Math.abs(Number(afterZoom.zoom || 0) - Number(beforeZoom.zoom || 0))
    : 0;

  return {
    ok: true,
    canvasPresent: true,
    clickNavigationOk: !!afterClick?.ok,
    dragChangedPose: (dragDeltaX > 0.2) || (dragDeltaY > 0.2),
    zoomChanged: zoomDelta > 0.02,
    initialPose: prepared.initialPose || null,
    diagnostics: Object.assign({}, prepared.diagnostics || {}, {
      clickTargetSystemIndex: Number(prepared.clickTarget.systemIndex || 0),
      clickNavSystem: Number(afterClick?.navSystem || 0),
      clickNavGalaxy: Number(afterClick?.navGalaxy || 0),
      dragDeltaX,
      dragDeltaY,
      zoomBefore: Number(beforeZoom?.zoom || 0),
      zoomAfter: Number(afterZoom?.zoom || 0),
    }),
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

await installRendererFriendlyCdnStubs(page);

let exitCode = 0;

try {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log(`PLANET_COLONY_STRICT_NATIVE_ONLY=${STRICT_NATIVE_ONLY}`);
  const resetResult = await devResetPassword(page, DEFAULT_USER, DEFAULT_PASS);
  console.log(`PLANET_COLONY_RESET_OK=${resetResult.ok}`);

  const loginOk = await loginViaUi(page, DEFAULT_USER, DEFAULT_PASS);
  console.log(`PLANET_COLONY_LOGIN_OK=${loginOk}`);
  if (!loginOk) {
    throw new Error('login failed');
  }

  const homePath = await openHomeSystem(page);
  console.log(`PLANET_COLONY_HOME_PATH=${homePath.path || 'unknown'}`);

  const minimapState = await evaluateMinimapInteractionState(page);
  console.log(`MINIMAP_CANVAS_PRESENT=${!!minimapState.canvasPresent}`);
  console.log(`MINIMAP_CLICK_NAV_OK=${!!minimapState.clickNavigationOk}`);
  console.log(`MINIMAP_DRAG_POSE_CHANGED=${!!minimapState.dragChangedPose}`);
  console.log(`MINIMAP_ZOOM_CHANGED=${!!minimapState.zoomChanged}`);
  try {
    console.log(`MINIMAP_DIAGNOSTICS=${JSON.stringify(minimapState.diagnostics || {})}`);
  } catch (_) {
    console.log('MINIMAP_DIAGNOSTICS={}');
  }

  const state = await evaluatePlanetColonyState(page, { strictNativeOnly: STRICT_NATIVE_ONLY });
  console.log(`PLANET_APPROACH_ACTION_VISIBLE=${state.colonyActionVisible}`);
  console.log(`PLANET_APPROACH_SIGNAL=${state.planetApproachSignal}`);
  console.log(`PLANET_APPROACH_NATIVE_SIGNAL=${state.planetApproachNativeSignal}`);
  console.log(`COLONY_SURFACE_WINDOW_OPEN=${state.colonyWindowOpen}`);
  console.log(`COLONY_BUILDINGS_WINDOW_OPEN=${state.buildingsWindowOpen}`);
  console.log(`SELECTION_ACTIVE_KIND=${state.selectionKind || 'unknown'}`);
  console.log(`RENDER_BACKEND=${state.rendererBackend || 'unknown'}`);
  console.log(`PLANET_COLONY_FALLBACK_PATH=${state.fallbackPath || 'none'}`);
  try {
    console.log(`PLANET_COLONY_DIAGNOSTICS=${JSON.stringify(state.diagnostics || {})}`);
  } catch (_) {
    console.log('PLANET_COLONY_DIAGNOSTICS={}');
  }

  if (STRICT_NATIVE_ONLY && !state.planetApproachNativeSignal) {
    const strictHint = state?.diagnostics?.selectionSnapshot?.activeKind
      ? `active=${state.diagnostics.selectionSnapshot.activeKind}`
      : (state?.diagnostics?.planetDetailVisible ? 'planet-detail-visible-without-native-action' : 'no-planet-selection-native-signal');
    console.log(`PLANET_COLONY_STRICT_HINT=${strictHint}`);
    console.log('CHECK_RESULT=PLANET_APPROACH_NATIVE_SIGNAL_MISSING');
    exitCode = 1;
  } else if (!minimapState.canvasPresent) {
    console.log(`MINIMAP_HINT=${String(minimapState.reason || 'canvas-missing')}`);
    console.log('CHECK_RESULT=MINIMAP_CANVAS_MISSING');
    exitCode = 1;
  } else if (!minimapState.clickNavigationOk) {
    console.log('CHECK_RESULT=MINIMAP_CLICK_NAV_FAILED');
    exitCode = 1;
  } else if (!minimapState.dragChangedPose) {
    console.log('CHECK_RESULT=MINIMAP_DRAG_POSE_UNCHANGED');
    exitCode = 1;
  } else if (!minimapState.zoomChanged) {
    console.log('CHECK_RESULT=MINIMAP_ZOOM_UNCHANGED');
    exitCode = 1;
  } else if (STRICT_NATIVE_ONLY && state.fallbackPath !== 'none') {
    console.log('CHECK_RESULT=PLANET_COLONY_STRICT_FALLBACK_USED');
    exitCode = 1;
  } else if (!state.planetApproachSignal) {
    console.log('CHECK_RESULT=PLANET_APPROACH_SIGNAL_MISSING');
    exitCode = 1;
  } else if (!state.colonyWindowOpen) {
    console.log('CHECK_RESULT=COLONY_SURFACE_NOT_REACHED');
    exitCode = 1;
  } else if (!state.buildingsWindowOpen) {
    console.log('CHECK_RESULT=COLONY_BUILDINGS_NOT_REACHED');
    exitCode = 1;
  } else if (state.fallbackPath !== 'none') {
    console.log('CHECK_RESULT=PLANET_COLONY_SMOKE_OK_WITH_FALLBACK');
  } else {
    console.log('CHECK_RESULT=PLANET_COLONY_SMOKE_OK');
  }
} catch (err) {
  console.error('[planet-colony-smoke] failed', err);
  console.log('CHECK_RESULT=PLANET_COLONY_SMOKE_ERROR');
  exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}

process.exit(exitCode);
