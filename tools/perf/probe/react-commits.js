// Measurement-only React commit probe for Android TV performance runs (tools/perf/tv-nav.ts).
//
// Metro adds this as a polyfill only when the bundle is built with VELA_PERF_PROBE=1
// (apps/vela/metro.config.js); release bundles never contain it. It stands in for React DevTools'
// global hook, so the production renderer reports each commit, and logs one line per commit:
//
//   VELAPERF commit t=<ms since start> comps=<function/class components rendered> hosts=<host
//     components rendered> top=<name:count,...> upd=<host type:count,...>
//
// src names the components where each update started (rendered under a parent that did not).
// upd counts host components whose props changed in the commit (React's Update flag; each is a
// shadow node clone, and a Text's re-measures its layout) or that mounted (+type).
//
// A fiber counts as rendered when it mounted (no alternate) or performed work in this commit
// (PerformedWork flag). Subtrees React reused untouched (prev.child === next.child) are skipped,
// which is DevTools' own rule. Component names come from the bundle, so build it unminified.
(function () {
  if (typeof globalThis === 'undefined' || globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
  var COMPONENT_TAGS = { 0: 1, 1: 1, 11: 1, 14: 1, 15: 1 };
  var HOST_TAGS = { 5: 1, 26: 1, 27: 1 };
  var PERFORMED_WORK = 1;
  // Update, or Cloned (persistent renderers such as Fabric re-create a changed host node).
  var UPDATE = 4 | 8;
  var start = Date.now();
  var log = typeof nativeLoggingHook === 'function'
    ? function (line) { nativeLoggingHook(line, 1); }
    : function (line) { if (globalThis.console) globalThis.console.log(line); };
  function nameOf(fiber) {
    var type = fiber.type;
    if (!type) return '?';
    if (typeof type === 'function') return type.displayName || type.name || 'anon';
    if (type.displayName) return type.displayName;
    if (type.render) return type.render.displayName || type.render.name || 'forwardRef';
    if (type.type) return nameOf({ type: type.type });
    return '?';
  }
  function walk(fiber, counts) {
    var stack = [fiber];
    var above = [false];
    while (stack.length) {
      var node = stack.pop();
      var parentRendered = above.pop();
      var prev = node.alternate;
      var rendered = !prev || (node.flags & PERFORMED_WORK) !== 0;
      var component = !!COMPONENT_TAGS[node.tag];
      if (rendered) {
        if (component) {
          counts.comps++;
          var name = nameOf(node);
          counts.names[name] = (counts.names[name] || 0) + 1;
          // Where an update started: a component that rendered under one that did not.
          if (!parentRendered && prev) counts.src[name] = (counts.src[name] || 0) + 1;
        } else if (HOST_TAGS[node.tag]) counts.hosts++;
      }
      var below = component ? rendered : parentRendered;
      if (HOST_TAGS[node.tag] || node.tag === 6) {
        var key = node.tag === 6 ? '#text' : String(node.type);
        if (!prev) key = '+' + key;
        if (!prev || (node.flags & UPDATE) !== 0) counts.upd[key] = (counts.upd[key] || 0) + 1;
      }
      // Descend only where this commit touched the subtree.
      if (node.child && (!prev || prev.child !== node.child)) { stack.push(node.child); above.push(below); }
      if (node.sibling && node !== fiber) { stack.push(node.sibling); above.push(parentRendered); }
    }
  }
  var nextId = 1;
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject: function (renderer) { var id = nextId++; this.renderers.set(id, renderer); return id; },
    checkDCE: function () {},
    onScheduleFiberRoot: function () {},
    onCommitFiberUnmount: function () {},
    onPostCommitFiberRoot: function () {},
    onCommitFiberRoot: function (_id, root) {
      try {
        var current = root && root.current;
        if (!current) return;
        var counts = { comps: 0, hosts: 0, names: {}, upd: {}, src: {} };
        if (current.child) walk(current.child, counts);
        if (!counts.comps && !counts.hosts) return;
        var top = Object.keys(counts.names)
          .sort(function (a, b) { return counts.names[b] - counts.names[a]; })
          .slice(0, 8)
          .map(function (name) { return name + ':' + counts.names[name]; })
          .join(',');
        var upd = Object.keys(counts.upd)
          .sort(function (a, b) { return counts.upd[b] - counts.upd[a]; })
          .slice(0, 8)
          .map(function (name) { return name + ':' + counts.upd[name]; })
          .join(',');
        var src = Object.keys(counts.src).slice(0, 6).map(function (name) { return name + ':' + counts.src[name]; }).join(',');
        log('VELAPERF commit t=' + (Date.now() - start) + ' comps=' + counts.comps + ' hosts=' + counts.hosts + ' top=' + top + ' upd=' + upd + ' src=' + src);
      } catch (error) {
        log('VELAPERF probe-error ' + (error && error.message));
      }
    },
  };
})();
