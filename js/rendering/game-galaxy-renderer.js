import { Quaternion, Ray, Sphere, Spherical, Vector3 } from 'three';
import { createGameColonyZoom } from './game-colony-zoom.js';

export async function createGameGalaxyRenderer(host, options) {
  const control = window.GQAuthGalaxyBackgroundControl;
  if (!control?.acquireGameView) throw new Error('Die gemeinsame Galaxieansicht ist nicht verfügbar.');
  const renderer = await control.acquireGameView();
  options.signal?.throwIfAborted();
  const canvas = renderer.renderer.domElement;
  renderer.setFlightScene({ stage: 'galaxy' });
  if (!renderer.getSpaceView()) throw new Error('Die gemeinsame räumliche Galaxieansicht ist nicht verfügbar.');
  let stars = [];
  let starsBySystem = new Map();
  let system = null;
  const menuTarget = control.getViewTarget?.();
  let firstSystem = true;
  let pointer = null;
  const touches = new Map();
  let touchGesture = false;
  let level = 'galaxy';
  let planetPosition = null;
  let selectedStar = null;
  let enteringSystem = false;
  let leavingSystem = false;
  const pivot = view().origin.clone().negate();
  let minimum = 1;
  let maximum = 200000;
  let zoomRuntime = null;
  let zoomPending = null;
  let zoomController = new AbortController();
  let zoomRevision = 0;
  let disposed = false;
  let colonyPending = false;
  let galaxyPose = null;
  let systemPose = null;
  let returningToGalaxy = false;
  let removeCameraFrame = null;
  let cameraMoveGeneration = 0;
  const endpointObservers = new Set();
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const listeners = new AbortController();
  function view() { return renderer.getSpaceView(); }
  function capturePose() {
    const space = view();
    return { position: space.camera.position.clone(), target: pivot.clone(), origin: space.origin.clone() };
  }
  function stopCameraMove() {
    const remove = removeCameraFrame;
    removeCameraFrame = null;
    cameraMoveGeneration++;
    remove?.();
  }
  function moveCamera(to, from = capturePose()) {
    stopCameraMove();
    if (disposed) return;
    const generation = cameraMoveGeneration;
    const space = view();
    const start = from.position.clone().sub(from.target);
    const end = to.position.clone().sub(to.target);
    const startDistance = start.length();
    const endDistance = end.length();
    const rotation = new Quaternion().setFromUnitVectors(start.clone().normalize(), end.clone().normalize());
    const direction = start.clone().normalize();
    const fromTarget = from.target.clone().add(from.origin.clone().sub(space.origin));
    const toShift = to.origin.clone().sub(space.origin);
    const toTarget = to.target.clone().add(toShift);
    const apply = (t) => {
      if (disposed || generation !== cameraMoveGeneration) return false;
      if (t === 1) {
        pivot.copy(toTarget);
        space.camera.position.copy(to.position).add(toShift);
      } else {
        pivot.copy(fromTarget).lerp(toTarget, t);
        const offset = direction.clone().applyQuaternion(new Quaternion().slerp(rotation, t))
          .multiplyScalar(Math.exp(Math.log(startDistance) * (1 - t) + Math.log(endDistance) * t));
        space.camera.position.copy(pivot).add(offset);
      }
      updateCamera();
      return !disposed && generation === cameraMoveGeneration;
    };
    if (reducedMotion() || !startDistance || !endDistance) { apply(1); return; }
    let elapsed = 0;
    apply(0);
    if (disposed || generation !== cameraMoveGeneration) return;
    try {
      removeCameraFrame = renderer.getSharedZoomBackend().addFrameHook((dt) => {
        if (disposed || generation !== cameraMoveGeneration) return;
        try {
          if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
            throw new TypeError('Galaxy camera move frame time must be finite and non-negative');
          }
          elapsed += dt;
          const t = Math.min(1, elapsed / 1.2);
          if (!apply(t * t * (3 - 2 * t))) return;
          if (t === 1 && generation === cameraMoveGeneration) stopCameraMove();
        } catch (error) {
          const errors = [error];
          try { stopCameraMove(); } catch (cleanupError) { errors.push(cleanupError); }
          report(errors.length === 1 ? error : new AggregateError(errors, 'Galaxy camera move failed'));
        }
      });
    } catch (error) {
      cameraMoveGeneration++;
      report(error);
    }
  }
  function cameraState() {
    const space = view();
    return { level, planetPosition, distance: space.camera.position.distanceTo(pivot),
      minimum, maximum, target: pivot.toArray(), position: space.camera.position.toArray(),
      quaternion: space.camera.quaternion.toArray(), transitioning: !!removeCameraFrame };
  }
  function notify() { options.onViewChange?.(cameraState()); }
  function report(error) {
    if (!disposed && error.name !== 'AbortError') options.onError?.(error);
  }
  function recoverZoom(error) {
    if (disposed || error.name === 'AbortError' || level === 'system' || !system) return error;
    if (zoomRuntime && zoomRuntime.getStats()?.level !== null) return error;
    try { frameSystem(); } catch (cleanupError) {
      return new AggregateError([error, cleanupError], 'Zoom failure and system recovery failed');
    }
    return error;
  }
  function reportZoom(error) {
    report(recoverZoom(error));
  }
  function planetCamera() {
    const body = planet();
    if (!body) return null;
    const offset = view().camera.position.clone().sub(body.getWorldPosition(new Vector3()))
      .divideScalar(body.userData.radius);
    return { position: { x: offset.x, y: offset.z, z: -offset.y },
      target: { x: 0, y: 0, z: 0 }, t: 1 };
  }
  function planetData() {
    const slot = system.planets.find((entry) => Number(entry.position) === planetPosition);
    return { focusPlanet: { ...slot.generated_planet, ...slot.player_planet,
      position: planetPosition, __slot: slot }, systemPayload: system };
  }
  function getZoom() {
    if (zoomRuntime) return Promise.resolve(zoomRuntime);
    if (zoomPending) return zoomPending;
    const signal = zoomController.signal;
    zoomPending = (options.createZoomRuntime || createGameColonyZoom)({
      renderer, canvas, signal, getCameraState: planetCamera,
      onLevel(next) {
        if (disposed || signal.aborted) return;
        level = next;
        notify();
      },
      onReturn: () => { frameSystem(); },
      onError: reportZoom,
    }).then((runtime) => {
      if (disposed || signal.aborted) { runtime.dispose(); throw new DOMException('Zoom cancelled.', 'AbortError'); }
      zoomRuntime = runtime;
      return runtime;
    }).finally(() => {
      if (!signal.aborted) zoomPending = null;
    });
    return zoomPending;
  }
  function stopZoom() {
    zoomRevision++;
    const controller = zoomController;
    zoomController = new AbortController();
    const runtime = zoomRuntime;
    zoomRuntime = null;
    zoomPending = null;
    colonyPending = false;
    try { runtime?.dispose(); } finally { controller.abort(); }
  }
  function approachPlanet(from = null) {
    const version = ++zoomRevision;
    const data = planetData();
    void getZoom().then((runtime) => {
      if (version === zoomRevision) return runtime.approach(data, from);
    }).catch((error) => { if (version === zoomRevision) reportZoom(error); });
  }
  function planet(position = planetPosition) {
    return view().bodies.find((body) => body.userData.type === 'planet'
      && Number(body.userData.data.position) === Number(position));
  }
  function systemRadius() {
    return Math.max(...view().bodies.map((body) =>
      body.getWorldPosition(new Vector3()).length() + body.userData.radius), 1e-10);
  }
  function updateCamera() {
    const space = view();
    // Keep the eye outside physical bodies, including while panning at surface scale.
    for (const body of space.bodies) {
      const center = body.getWorldPosition(new Vector3());
      const offset = space.camera.position.clone().sub(center);
      const clearance = body.userData.radius * 1.04;
      if (offset.length() < clearance) {
        if (!offset.lengthSq()) offset.copy(space.camera.up);
        space.camera.position.copy(center).add(offset.setLength(clearance));
      }
    }
    space.camera.lookAt(pivot);
    space.camera.updateMatrixWorld(true);
    notify();
  }
  function setLevel(next, target, min, max) {
    stopCameraMove();
    renderer.cancelCameraFlight();
    if (next !== 'system') renderer.setFlightHover?.(null);
    level = next;
    pivot.copy(target);
    minimum = min;
    maximum = max;
    view().camera.up.set(0, 0, 1);
  }
  function focusPlanet(position) {
    const body = planet(position);
    if (!body) return false;
    if (level === 'system') systemPose = capturePose();
    stopCameraMove();
    stopZoom();
    planetPosition = Number(position);
    const from = planetCamera();
    const target = view().resolveTarget({ kind: 'planet', position });
    setLevel('planet', target.focus, body.userData.radius * 1.04, systemRadius() * 12);
    view().camera.position.copy(target.destination);
    updateCamera();
    approachPlanet(from);
    return true;
  }
  function focusColony(position) {
    if (colonyPending) return true;
    const body = planet(position);
    if (!body?.userData.inhabited || !options.loadColonyData) {
      options.onError?.(new Error('Für diesen Planeten ist keine sichtbare Kolonie geladen.'));
      return false;
    }
    if (planetPosition !== Number(position) || level === 'system') focusPlanet(position);
    const version = ++zoomRevision;
    const data = planetData();
    const signal = zoomController.signal;
    colonyPending = true;
    void getZoom().then((runtime) => {
      if (version !== zoomRevision) return;
      return runtime.surface(() => options.loadColonyData(Number(position), data, signal));
    }).catch((error) => { if (version === zoomRevision) reportZoom(error); })
      .finally(() => { if (!signal.aborted) colonyPending = false; });
    return true;
  }
  function frameSystem(restore = true) {
    if (!system) return false;
    const from = capturePose();
    let cleanupError = null;
    try { stopZoom(); } catch (error) { cleanupError = error; }
    const target = view().resolveTarget({ kind: 'system' });
    planetPosition = null;
    setLevel('system', target.focus, 1e-12, systemRadius() * 20);
    moveCamera(restore && systemPose ? systemPose : {
      position: target.destination.clone(), target: target.focus.clone(), origin: view().origin.clone(),
    }, from);
    if (cleanupError) throw cleanupError;
    return true;
  }
  function back() {
    if (['colony', 'building'].includes(level)) { zoomRuntime?.back(); return true; }
    if (level === 'planet') return frameSystem();
    if (level === 'system') leaveSystem();
    return false;
  }
  async function returnTo(target) {
    const hierarchy = ['galaxy', 'system', 'planet', 'colony', 'building'];
    const depth = hierarchy.indexOf(target);
    if (disposed || depth < 0 || depth >= hierarchy.indexOf(level)) return false;
    const runtime = zoomRuntime;
    const signal = zoomController.signal;
    if (['colony', 'building'].includes(level)) {
      try {
        if (!await runtime.returnTo(target === 'colony' ? 'colony' : 'planet')) return false;
      } catch (error) {
        if (signal.aborted) throw error;
        throw recoverZoom(error);
      }
      if (disposed || signal.aborted) return false;
    }
    if (target === 'system') return frameSystem();
    if (target === 'galaxy') {
      await options.onOverview?.();
      return !disposed && level === 'galaxy';
    }
    return level === target;
  }
  function leaveSystem() {
    if (leavingSystem) return;
    leavingSystem = true;
    Promise.resolve(options.onOverview?.()).finally(() => { leavingSystem = false; });
  }
  function pick(event) {
    view().camera.updateMatrixWorld(true);
    const rect = canvas.getBoundingClientRect();
    let best = null;
    let distance = 24;
    const candidates = system ? view().bodies.filter((body) => body.userData.type === 'planet')
      .map((body) => ({ data: { ...body.userData.data, inhabited: body.userData.inhabited, __kind: 'planet' },
        local: body.getWorldPosition(new Vector3()), radius: body.userData.radius }))
      : stars.map((star) => ({ data: star, local: new Vector3(Number(star.x_ly), Number(star.y_ly), Number(star.z_ly))
        .sub(view().origin), radius: 0 }));
    const ray = new Ray(view().camera.position, new Vector3(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2, 0.5)
      .unproject(view().camera).sub(view().camera.position).normalize());
    let hitDistance = Infinity;
    let hitBody = null;
    for (const candidate of candidates) {
      if (candidate.radius) {
        const hit = ray.intersectSphere(new Sphere(candidate.local, candidate.radius), new Vector3());
        if (hit && hit.distanceTo(view().camera.position) < hitDistance) {
          hitDistance = hit.distanceTo(view().camera.position);
          hitBody = candidate.data;
        }
      }
      const point = candidate.local.clone().project(view().camera);
      if (point.z < -1 || point.z > 1) continue;
      const current = Math.hypot(rect.left + (point.x + 1) * rect.width / 2 - event.clientX,
        rect.top + (1 - point.y) * rect.height / 2 - event.clientY);
      if (current < distance) { best = candidate.data; distance = current; }
    }
    return hitBody || best;
  }
  function rotate(dx, dy) {
    if (['colony', 'building'].includes(level)) { zoomRuntime?.rotateView(dx, dy); return; }
    stopCameraMove();
    renderer.cancelCameraFlight();
    const space = view();
    const toY = new Quaternion().setFromUnitVectors(space.camera.up, new Vector3(0, 1, 0));
    const offset = space.camera.position.clone().sub(pivot).applyQuaternion(toY);
    const spherical = new Spherical().setFromVector3(offset);
    spherical.theta -= dx * 2 * Math.PI / Math.max(1, canvas.clientHeight);
    spherical.phi = Math.max(0.02, Math.min(Math.PI - 0.02,
      spherical.phi - dy * 2 * Math.PI / Math.max(1, canvas.clientHeight)));
    spherical.radius = Math.max(minimum, Math.min(maximum, spherical.radius));
    space.camera.position.copy(pivot).add(offset.setFromSpherical(spherical).applyQuaternion(toY.invert()));
    updateCamera();
  }
  function pan(dx, dy) {
    if (['colony', 'building'].includes(level)) { zoomRuntime?.panView(dx, dy); return; }
    stopCameraMove();
    renderer.cancelCameraFlight();
    const space = view();
    const distance = Math.max(minimum, space.camera.position.distanceTo(pivot));
    const offset = new Vector3(-dx, dy, 0).multiplyScalar(
      2 * distance * Math.tan(space.camera.fov * Math.PI / 360) / Math.max(1, canvas.clientHeight))
      .applyQuaternion(space.camera.quaternion);
    pivot.add(offset);
    space.camera.position.add(offset);
    updateCamera();
  }
  const listen = (type, handler, extra = {}) => canvas.addEventListener(type, handler, { ...extra, signal: listeners.signal });
  function selectAt(event) {
    if (['colony', 'building'].includes(level)) {
      zoomRuntime?.selectAt(event.clientX, event.clientY);
      return;
    }
    selectObject(pick(event));
  }
  function selectObject(object) {
    if (!object) {
      renderer.setFlightSelection?.(null);
      renderer.setFlightHover?.(null);
      return;
    }
    if (!system) selectedStar = object;
    renderer.setFlightSelection?.(object.__kind === 'planet'
      ? { kind: 'planet', position: Number(object.position) } : null);
    renderer.setFlightHover?.(null);
    options.onClick?.(object);
  }
  function activatePlanet(position) {
    const body = planet(position);
    if (!body) return;
    if (['planet', 'colony'].includes(level) && planetPosition === Number(position) && body.userData.inhabited) {
      focusColony(position);
    } else {
      focusPlanet(position);
    }
  }
  renderer.setSpatialLabelCallbacks?.({
    onWheel(label, event) {
      if (disposed) return;
      const target = level === 'galaxy' && label?.kind === 'system' ? label.data
        : label?.kind === 'planet' && planet(label.data?.position)
          ? { ...label.data, __kind: 'planet' } : null;
      handleWheel(event, target);
    },
    onHover(label) {
      if (disposed) return;
      renderer.setFlightHover?.(level === 'system' && label?.kind === 'planet' && planet(label.data?.position)
        ? { kind: 'planet', position: Number(label.data.position) } : null);
    },
    onActivate(label) {
      if (disposed || !label?.data) return;
      const object = label.kind === 'planet' ? { ...label.data, __kind: 'planet' } : label.data;
      selectObject(object);
    },
    onDoubleActivate(label) {
      if (disposed || !label?.data) return;
      if (label.kind === 'system') {
        options.onDoubleClick?.(label.data);
      } else if (label.kind === 'planet') {
        activatePlanet(Number(label.data.position));
      }
    },
  });
  function touchPose() {
    const [a, b] = [...touches.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  const touchOptions = { capture: true, passive: false };
  function consumeTouch(event) {
    if (event.pointerType !== 'touch') return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
  listen('pointerdown', (event) => {
    if (!consumeTouch(event)) return;
    canvas.focus({ preventScroll: true });
    stopCameraMove();
    renderer.cancelCameraFlight();
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, moved: false });
    if (touches.size > 1) touchGesture = true;
    canvas.setPointerCapture(event.pointerId);
  }, touchOptions);
  listen('pointermove', (event) => {
    if (!consumeTouch(event)) return;
    const touch = touches.get(event.pointerId);
    if (!touch) return;
    const before = touches.size === 2 ? touchPose() : null;
    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;
    touch.x = event.clientX;
    touch.y = event.clientY;
    touch.moved ||= Math.hypot(touch.x - touch.startX, touch.y - touch.startY) > 3;
    if (before) {
      const after = touchPose();
      pan(after.x - before.x, after.y - before.y);
      if (before.distance > 0 && after.distance > 0) {
        const amount = Math.max(-1, Math.min(1, Math.log(after.distance / before.distance)));
        if (['colony', 'building'].includes(level)) zoomRuntime?.zoomBy(amount);
        else if (amount) zoom(amount > 0 ? 'in' : 'out', Math.abs(amount),
          { clientX: after.x, clientY: after.y });
      }
    } else if (touches.size === 1 && touch.moved) rotate(dx, dy);
  }, touchOptions);
  function endTouch(event, cancelled = false) {
    if (!consumeTouch(event)) return;
    const touch = touches.get(event.pointerId);
    if (!touch) return;
    const tap = !cancelled && !touchGesture && !touch.moved
      && Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY) <= 3;
    touches.delete(event.pointerId);
    if (!touches.size) touchGesture = false;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (tap) selectAt(event);
  }
  listen('pointerup', (event) => endTouch(event), touchOptions);
  listen('pointercancel', (event) => endTouch(event, true), touchOptions);
  listen('lostpointercapture', (event) => endTouch(event, true), touchOptions);
  listen('pointerdown', (event) => {
    if (pointer || ![0, 1, 2].includes(event.button)) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    stopCameraMove();
    renderer.cancelCameraFlight();
    renderer.setFlightHover?.(null);
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, moved: false,
      button: event.button, pan: event.button !== 0 || event.shiftKey };
    canvas.setPointerCapture(event.pointerId);
  });
  listen('pointermove', (event) => {
    if (!pointer) {
      if (event.pointerType !== 'touch' && system && level === 'system') {
        const object = pick(event);
        renderer.setFlightHover?.(object?.__kind === 'planet'
          ? { kind: 'planet', position: Number(object.position) } : null);
      }
      return;
    }
    if (pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 3) pointer.moved = true;
    if (pointer.moved) {
      if (pointer.pan) pan(dx, dy);
      else rotate(dx, dy);
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });
  listen('pointerup', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!pointer.moved && pointer.button === 0) {
      selectAt(event);
    }
    pointer = null;
    canvas.releasePointerCapture(event.pointerId);
  });
  listen('pointercancel', () => { pointer = null; });
  listen('lostpointercapture', () => { pointer = null; });
  listen('pointerleave', () => {
    if (!pointer) renderer.setFlightHover?.(null);
  });
  listen('contextmenu', (event) => event.preventDefault());
  listen('dblclick', (event) => {
    if (event.button !== 0) return;
    const object = pick(event);
    if (!object) return;
    if (!system) options.onDoubleClick?.(object);
    else activatePlanet(object.position);
  });
  function zoom(direction, amount = 0.22, event = null, target = null) {
    if (['colony', 'building'].includes(level)) { zoomRuntime?.nudgeZoom(direction); return; }
    stopCameraMove();
    renderer.cancelCameraFlight();
    const space = view();
    const inward = direction === 'in';
    const object = inward ? target || (event ? pick(event) : null) : null;
    if (level === 'galaxy' && inward && (object || selectedStar)) {
      const star = object || selectedStar;
      selectedStar = star;
      const target = new Vector3(star.x_ly, star.y_ly, star.z_ly).sub(space.origin);
      const offset = pivot.clone().sub(target);
      pivot.copy(target);
      space.camera.position.sub(offset);
    } else if (level === 'system' && object) {
      if (!systemPose) systemPose = capturePose();
      planetPosition = Number(object.position);
      const body = planet();
      pivot.copy(body.getWorldPosition(new Vector3()));
      minimum = body.userData.radius * 1.04;
    }
    const offset = space.camera.position.clone().sub(pivot);
    const distance = Math.max(minimum, Math.min(maximum, offset.length() * Math.exp(inward ? -amount : amount)));
    if (!offset.lengthSq()) offset.copy(space.camera.up);
    space.camera.position.copy(pivot).add(offset.setLength(distance));
    updateCamera();
    if (inward && level === 'galaxy' && selectedStar && distance <= 100 && !enteringSystem) {
      enteringSystem = true;
      Promise.resolve(options.onDoubleClick?.(selectedStar)).finally(() => { enteringSystem = false; });
    } else if (inward && level === 'system' && planet() && distance <= planet().userData.radius * 4) {
      level = 'planet';
      notify();
      approachPlanet();
    } else if (inward && level === 'planet' && planet()?.userData.inhabited
      && distance <= planet().userData.radius * 1.7) {
      focusColony(planetPosition);
    } else if (!inward && level === 'planet' && distance > planet().userData.radius * 12) {
      frameSystem();
    } else if (!inward && level === 'system' && distance >= maximum) {
      leaveSystem();
    }
  }
  function handleWheel(event, target = null) {
    event.preventDefault();
    if (!event.deltaY) return;
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    zoom(event.deltaY < 0 ? 'in' : 'out', Math.min(1, Math.abs(pixels) * 0.0022), target ? null : event, target);
  }
  listen('wheel', handleWheel, { passive: false });
  listen('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === '+' || event.key === '=') { zoom('in'); event.preventDefault(); }
    if (event.key === '-') { zoom('out'); event.preventDefault(); }
    if (event.key === 'Escape' || event.key === 'Backspace') { back(); event.preventDefault(); }
    if (event.key === 'Home') { resetView(); event.preventDefault(); }
    const arrows = { ArrowLeft: [-30, 0], ArrowRight: [30, 0], ArrowUp: [0, -30], ArrowDown: [0, 30] };
    if (arrows[event.key]) {
      if (event.shiftKey) pan(...arrows[event.key]);
      else rotate(...arrows[event.key]);
      event.preventDefault();
    }
  });
  function resetView() {
    if (['colony', 'building'].includes(level)) zoomRuntime?.reset();
    else if (level === 'planet') focusPlanet(planetPosition);
    else if (system) frameSystem(false);
    else fitGalaxy();
  }
  function fitGalaxy() {
    if (system) return;
    stopZoom();
    const from = capturePose();
    planetPosition = null;
    selectedStar = null;
    enteringSystem = false;
    const space = view();
    setLevel('galaxy', space.origin.clone().negate(), 1, 200000);
    const destination = returningToGalaxy && galaxyPose ? galaxyPose : {
      position: new Vector3(0, -45000, 45000).sub(space.origin),
      target: space.origin.clone().negate(), origin: space.origin.clone(),
    };
    const animate = returningToGalaxy;
    returningToGalaxy = false;
    if (animate) moveCamera(destination, from);
    else {
      pivot.copy(destination.target);
      space.camera.position.copy(destination.position);
      updateCamera();
    }
  }
  return {
    getRenderStats: () => ({ ...renderer.getRenderStats(), systemMode: !!system,
      systemPlanets: system?.planets.length || 0, cameraControl: cameraState(), colonySurface: zoomRuntime?.getStats() || null }),
    focusPlanet, focusColony, resetView, back, returnTo,
    setSystemVisualizationOptions(options) {
      return renderer.setSystemVisualizationOptions?.(options) ?? false;
    },
    setSpatialLabelMode(mode) {
      return renderer.setSpatialLabelMode?.(mode) ?? false;
    },
    playBattleEncounter(encounter) {
      if (disposed || level !== 'system') {
        throw new Error('Das Schlachtreplay kann nur in einer geöffneten Systemansicht starten.');
      }
      return renderer.startBattleEncounterPresentation(encounter);
    },
    refreshColony: (colonyId) => zoomRuntime?.refreshColony(colonyId),
    observeFleetEndpoints(getFleets, onProjection) {
      if (disposed) return () => {};
      let active = true;
      let removeFrame = null;
      const current = () => active && !disposed;
      function project() {
        if (!current()) return;
        const points = new Map();
        if (['galaxy', 'system'].includes(level)) {
          const space = view();
          space.camera.updateMatrixWorld(true);
          const rect = canvas.getBoundingClientRect();
          for (const fleet of getFleets()) {
            for (const prefix of ['origin', 'target']) {
              const galaxy = Number(fleet[`${prefix}_galaxy`]);
              const systemId = Number(fleet[`${prefix}_system`]);
              const position = system ? Number(fleet[`${prefix}_position`]) : null;
              let local;
              if (system) {
                if (galaxy !== Number(system.galaxy) || systemId !== Number(system.system)) continue;
                const body = planet(position);
                if (!body) continue;
                local = body.getWorldPosition(new Vector3());
              } else {
                const star = starsBySystem.get(`${galaxy}:${systemId}`);
                if (!star) continue;
                local = new Vector3(star.x_ly, star.y_ly, star.z_ly).sub(space.origin);
              }
              const projected = local.project(space.camera);
              if (![projected.x, projected.y, projected.z].every(Number.isFinite)
                || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || Math.abs(projected.z) > 1) continue;
              const key = `${galaxy}:${systemId}:${position ?? '*'}`;
              if (!points.has(key)) points.set(key, { key, galaxy, system: systemId, position, fleetIds: [],
                x: rect.left + (projected.x + 1) * rect.width / 2,
                y: rect.top + (1 - projected.y) * rect.height / 2 });
              const point = points.get(key);
              if (!point.fleetIds.includes(Number(fleet.id))) point.fleetIds.push(Number(fleet.id));
            }
          }
        }
        if (current()) onProjection([...points.values()]);
      }
      const remove = () => {
        if (!active && !removeFrame) return;
        active = false;
        const detach = removeFrame;
        detach?.();
        removeFrame = null;
        endpointObservers.delete(remove);
      };
      const frame = () => {
        if (!current()) return;
        try {
          project();
        } catch (error) {
          const errors = [error];
          try { remove(); } catch (cleanupError) { errors.push(cleanupError); }
          report(errors.length === 1 ? error
            : new AggregateError(errors, 'Fleet endpoint projection and cleanup failed'));
        }
      };
      removeFrame = renderer.getSharedZoomBackend().addFrameHook(frame);
      endpointObservers.add(remove);
      if (disposed) {
        remove();
        return remove;
      }
      try {
        project();
      } catch (error) {
        try { remove(); } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Fleet endpoint registration and cleanup failed');
        }
        throw error;
      }
      return remove;
    },
    rotateView: rotate, panView: pan,
    setStars(next) {
      stars = next;
      starsBySystem = new Map(next.map((star) => [`${Number(star.galaxy_index)}:${Number(star.system_index)}`, star]));
      renderer.setStars([...control.getVisualStars(), ...stars], { preserveScale: true, preserveView: true });
      renderer.setSpatialLabelStars(stars);
    },
    fitCameraToStars: fitGalaxy,
    enterSystemView(star, payload) {
      const previousSystem = system;
      const from = capturePose();
      if (!previousSystem) galaxyPose = from;
      const sameSystem = Number(previousSystem?.galaxy) === Number(payload.galaxy)
        && Number(previousSystem?.system) === Number(payload.system);
      if (!sameSystem) { stopZoom(); systemPose = null; }
      system = payload;
      renderer.setFlightSelection?.(null);
      renderer.setFlightHover?.(null);
      const children = payload.planets.flatMap((slot) => {
        const body = slot.generated_planet || slot.player_planet
          ? { ...slot.generated_planet, ...slot.player_planet } : null;
        return body ? [{ type: 'planet', data: { ...body, position: slot.position ?? body.position,
          inhabited: !!slot.player_planet, texture: payload.planet_texture_manifest?.planets?.[String(slot.position)] },
        children: (body.moons || []).map((moon) => ({ type: 'moon', data: moon })) }] : [];
      });
      if (Array.isArray(payload.special_bodies)) {
        children.push(...payload.special_bodies
          .filter((body) => body?.body_type === 'asteroid_belt')
          .map((body) => ({ type: 'asteroid_belt', data: body, children: [] })));
      }
      renderer.setFlightScene({ stage: 'system', target: star,
        sceneGraph: { type: 'galaxy', children: [{ type: 'system', data: star, children }] } });
      if (sameSystem && planetPosition !== null) {
        const focused = planet();
        if (!focused || ((colonyPending || ['colony', 'building'].includes(level)) && !focused.userData.inhabited)) {
          frameSystem();
          enteringSystem = false;
          notify();
          return;
        }
      }
      const space = view();
      const target = space.resolveTarget({ kind: 'system' });
      const preserveCamera = (Number(previousSystem?.galaxy) === Number(payload.galaxy)
        && Number(previousSystem?.system) === Number(payload.system))
        || (firstSystem && Number(menuTarget?.galaxy) === Number(payload.galaxy)
          && Number(menuTarget?.system) === Number(payload.system));
      firstSystem = false;
      if (!preserveCamera || level === 'galaxy') {
        planetPosition = null;
        setLevel('system', new Vector3(), 1e-12, systemRadius() * 20);
      }
      if (target && !preserveCamera) {
        moveCamera({ position: target.destination.clone(), target: target.focus.clone(),
          origin: space.origin.clone() }, from);
      }
      enteringSystem = false;
      notify();
    },
    exitSystemView() {
      stopCameraMove();
      returningToGalaxy = !!system;
      stopZoom();
      system = null;
      renderer.setFlightSelection?.(null);
      renderer.setFlightHover?.(null);
      enteringSystem = false;
      const space = view();
      space.clearSystem();
      renderer.setGalaxyFleets([]);
    },
    setGalaxyFleets(fleets) { renderer.setGalaxyFleets(fleets); },
    nudgeZoom: zoom,
    resize() { renderer.resize(); },
    destroy() {
      if (disposed) {
        const errors = [];
        for (const remove of [...endpointObservers]) {
          try { remove(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Game galaxy observer cleanup failed');
        return;
      }
      disposed = true;
      const errors = [];
      const attempt = (cleanup) => {
        try { cleanup(); } catch (error) { errors.push(error); }
      };
      [...endpointObservers].forEach((remove) => attempt(remove));
      const captures = new Set([...touches.keys(), ...(pointer ? [pointer.id] : [])]);
      pointer = null;
      touches.clear();
      touchGesture = false;
      attempt(() => listeners.abort());
      captures.forEach((id) => attempt(() => {
        if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
      }));
      attempt(stopCameraMove);
      attempt(stopZoom);
      attempt(() => renderer.setSpatialLabelCallbacks?.(null));
      attempt(() => renderer.cancelCameraFlight());
      attempt(() => renderer.setGalaxyFleets([]));
      attempt(() => control.returnToMenu());
      if (errors.length) throw new AggregateError(errors, 'Game galaxy view cleanup failed');
    },
  };
}
