/* MarkGrab - shared i18n applier for all extension surfaces.
 * Replaces text/attributes on [data-i18n], [data-i18n-title],
 * [data-i18n-placeholder] and [data-i18n-label] with chrome.i18n messages.
 * No inline scripts anywhere (MV3 CSP); include this file before the
 * surface's own script. */
(function () {
  'use strict';

  var BINDINGS = [
    ['data-i18n', function (el, msg) { el.textContent = msg; }],
    ['data-i18n-title', function (el, msg) { el.setAttribute('title', msg); }],
    ['data-i18n-placeholder', function (el, msg) { el.setAttribute('placeholder', msg); }],
    ['data-i18n-label', function (el, msg) { el.setAttribute('aria-label', msg); }]
  ];

  function apply(root) {
    var scope = root || document;
    if (!(typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage)) { return; }
    for (var i = 0; i < BINDINGS.length; i++) {
      var attr = BINDINGS[i][0];
      var setter = BINDINGS[i][1];
      var nodes = scope.querySelectorAll('[' + attr + ']');
      for (var j = 0; j < nodes.length; j++) {
        var key = nodes[j].getAttribute(attr);
        if (!key) { continue; }
        var msg = chrome.i18n.getMessage(key);
        if (msg) { setter(nodes[j], msg); }
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { apply(document); });
  } else {
    apply(document);
  }

  /* Exposed so surface scripts can re-apply after dynamic DOM changes. */
  window.__mgI18n = { apply: apply };
})();
