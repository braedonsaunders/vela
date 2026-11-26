// Measurement-only JS-thread attribution for Android TV performance runs (tools/perf/tv-nav.ts),
// bundled beside react-commits.js only with VELA_PERF_PROBE=1 (apps/vela/metro.config.js).
//
// Times what the JS thread runs on the app's behalf and, every 200 ms that saw any, logs
//
//   VELAPERF js ev=<event>:<count>:<ms>,... timer=<callback>:<count>:<ms>,... commit=<count>:<ms>
//
// ev: Fabric events from native (topScroll, topFocus, topLayout ...), including the React work
// they flush synchronously; timer: setTimeout / setInterval / requestAnimationFrame callbacks by
// function name (build the bundle unminified); commit: completeRoot (Fabric applying a commit).
(function () {
  var g = globalThis;
  var now = g.performance && typeof g.performance.now === 'function'
    ? function () { return g.performance.now(); }
    : function () { return Date.now(); };
  var log = typeof g.nativeLoggingHook === 'function'
    ? function (line) { g.nativeLoggingHook(line, 1); }
    : function (line) { if (g.console) g.console.log(line); };
  var buckets = { ev: {}, timer: {} };
  var commit = { n: 0, ms: 0 };
  var pending = false;
  function add(kind, name, ms) {
    var bucket = buckets[kind][name] || (buckets[kind][name] = { n: 0, ms: 0 });
    bucket.n++;
    bucket.ms += ms;
    schedule();
  }
  function format(table) {
    return Object.keys(table)
      .sort(function (a, b) { return table[b].ms - table[a].ms; })
      .slice(0, 8)
      .map(function (name) { return name + ':' + table[name].n + ':' + table[name].ms.toFixed(1); })
      .join(',');
  }
  var originalSetTimeout = g.setTimeout;
  function flush() {
    pending = false;
    var line = 'VELAPERF js ev=' + format(buckets.ev) + ' timer=' + format(buckets.timer) + ' commit=' + commit.n + ':' + commit.ms.toFixed(1);
    buckets = { ev: {}, timer: {} };
    commit = { n: 0, ms: 0 };
    log(line);
  }
  function schedule() {
    if (pending || !originalSetTimeout) return;
    pending = true;
    originalSetTimeout(flush, 200);
  }
  var hermes = g.HermesInternal;
  function nameOf(fn) {
    var name = (fn && (fn.displayName || fn.name)) || 'anon';
    var at = hermes && typeof hermes.getFunctionLocation === 'function' ? hermes.getFunctionLocation(fn) : null;
    return at && at.lineNumber ? name + '@' + at.lineNumber : name;
  }
  function wrapTimer(key, kind) {
    var original = g[key];
    if (typeof original !== 'function') return;
    g[key] = function (callback) {
      if (typeof callback !== 'function') return original.apply(this, arguments);
      var args = Array.prototype.slice.call(arguments);
      var name = kind + ':' + nameOf(callback);
      args[0] = function () {
        var t = now();
        try { return callback.apply(this, arguments); } finally { add('timer', name, now() - t); }
      };
      return original.apply(this, args);
    };
  }
  wrapTimer('setTimeout', 'timeout');
  wrapTimer('setInterval', 'interval');
  wrapTimer('requestAnimationFrame', 'raf');
  var fabric = g.nativeFabricUIManager;
  if (fabric) {
    var wrapped = {
      registerEventHandler: function (handler) {
        // React has taken what it needs by now; native code finds its binding through the global,
        // which must be the HostObject again before the first surface starts.
        g.nativeFabricUIManager = fabric;
        return fabric.registerEventHandler(function (instance, type, payload) {
          var t = now();
          try { return handler.apply(this, arguments); } finally { add('ev', String(type), now() - t); }
        });
      },
      completeRoot: function () {
        var t = now();
        try { return fabric.completeRoot.apply(fabric, arguments); } finally { commit.n++; commit.ms += now() - t; schedule(); }
      },
    };
    g.nativeFabricUIManager = new Proxy({}, {
      // Only string keys reach the HostObject (a Symbol lookup crashes it).
      get: function (_target, key) { return typeof key !== 'string' ? undefined : key in wrapped ? wrapped[key] : fabric[key]; },
      has: function (_target, key) { return typeof key === 'string' && (key in wrapped || fabric[key] !== undefined); },
    });
  }
})();
