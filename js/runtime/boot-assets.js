(function () {
  function resolveAssetVersion(path, versionKey, fallbackVersion) {
    const versions = window.__GQ_ASSET_VERSIONS || {};
    const version = String((versionKey && versions[versionKey]) || fallbackVersion || '').trim();
    return version ? `${path}?v=${version}` : path;
  }

  function resolveAssetSpec(spec) {
    if (!spec || !spec.path) return null;
    return Object.assign({}, spec, {
      resolvedSrc: resolveAssetVersion(spec.path, spec.versionKey, spec.fallbackVersion)
    });
  }

  function auditDirectBootScripts(declaredScripts) {
    try {
      const declared = Array.isArray(declaredScripts) ? declaredScripts : [];
      if (!declared.length) return;
      const scriptNodes = Array.from(document.querySelectorAll('script[src]'));
      const actualByPath = new Map();
      scriptNodes.forEach(function (node) {
        const raw = node.getAttribute('src');
        if (!raw || /^https?:\/\//i.test(raw)) return;
        const parts = String(raw).split('?v=');
        actualByPath.set(parts[0], parts.length > 1 ? parts[1] : '');
      });
      declared.forEach(function (entry) {
        if (!entry || !entry.src) return;
        const actualVersion = actualByPath.get(entry.src);
        if (typeof actualVersion === 'undefined') {
          console.warn('[GQ Boot] Direct boot script missing from HTML:', entry.src);
          return;
        }
        if (String(actualVersion) !== String(entry.version || '')) {
          console.warn('[GQ Boot] Direct boot script version drift:', {
            src: entry.src,
            declared: entry.version || '',
            actual: actualVersion
          });
        }
      });
    } catch (error) {
      console.warn('[GQ Boot] Direct boot script audit failed:', error);
    }
  }

  function auditLazyLocalScripts(specs, bootConfig) {
    try {
      const declared = Array.isArray(specs) ? specs : [];
      if (!declared.length) return;
      const manifestPaths = new Set(((bootConfig && bootConfig.gameScripts) || []).filter(function (src) {
        return typeof src === 'string' && !/^https?:\/\//i.test(src);
      }).map(function (src) {
        return String(src).split('?')[0];
      }));
      const seenResolved = new Map();
      declared.forEach(function (spec) {
        const resolved = resolveAssetSpec(spec);
        if (!resolved || !resolved.path || !resolved.resolvedSrc) {
          console.warn('[GQ Boot] Lazy local script spec invalid:', spec);
          return;
        }
        const previous = seenResolved.get(resolved.resolvedSrc);
        if (previous && previous !== resolved.path) {
          console.warn('[GQ Boot] Lazy local script resolves to duplicate src:', {
            src: resolved.resolvedSrc,
            current: resolved.path,
            previous: previous
          });
        } else {
          seenResolved.set(resolved.resolvedSrc, resolved.path);
        }
        if (!resolved.standalone && !manifestPaths.has(resolved.path)) {
          console.warn('[GQ Boot] Lazy local script missing from boot manifest:', {
            path: resolved.path,
            consumer: resolved.consumer || 'unknown',
            resolvedSrc: resolved.resolvedSrc
          });
        }
      });
    } catch (error) {
      console.warn('[GQ Boot] Lazy local script audit failed:', error);
    }
  }

  window.GQBootAssets = Object.assign({}, window.GQBootAssets || {}, {
    resolveAssetVersion,
    resolveAssetSpec,
    auditDirectBootScripts,
    auditLazyLocalScripts
  });
  window.GQResolveAssetVersion = resolveAssetVersion;
  window.GQResolveAssetSpec = resolveAssetSpec;
})();