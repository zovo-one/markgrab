/* MarkGrab onboarding controller - 3 steps, dots, skip. External file only
 * (MV3 CSP: no inline scripts). */
(function () {
  'use strict';

  var TOTAL = 3;
  var current = 0;

  var steps = [
    document.getElementById('step1'),
    document.getElementById('step2'),
    document.getElementById('step3')
  ];
  var dots = Array.prototype.slice.call(document.querySelectorAll('.ob-dot'));
  var counter = document.getElementById('stepCounter');

  function msg(key, subs) {
    try { return chrome.i18n.getMessage(key, subs) || key; } catch (e) { return key; }
  }

  function closeTab() {
    try {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.getCurrent) {
        chrome.tabs.getCurrent(function (tab) {
          if (tab && tab.id !== undefined) {
            chrome.tabs.remove(tab.id);
          } else {
            window.close();
          }
        });
        return;
      }
    } catch (e) { /* fall through */ }
    window.close();
  }

  function render() {
    for (var i = 0; i < TOTAL; i++) {
      var active = i === current;
      steps[i].classList.toggle('is-active', active);
      steps[i].hidden = !active;
      dots[i].classList.toggle('is-active', active);
      dots[i].classList.toggle('is-done', i < current);
      dots[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
    counter.textContent = msg('obStepOf', [String(current + 1)]);
    var heading = steps[current].querySelector('.ob-h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: false });
    }
  }

  function goTo(index) {
    if (index < 0 || index >= TOTAL || index === current) { return; }
    current = index;
    render();
  }

  function init() {
    var nextButtons = document.querySelectorAll('[data-next]');
    for (var i = 0; i < nextButtons.length; i++) {
      nextButtons[i].addEventListener('click', function () { goTo(current + 1); });
    }
    for (var j = 0; j < dots.length; j++) {
      (function (idx) {
        dots[idx].addEventListener('click', function () { goTo(idx); });
      })(j);
    }
    document.getElementById('skipLink').addEventListener('click', closeTab);
    document.getElementById('btnStart').addEventListener('click', closeTab);

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight') { goTo(current + 1); }
      if (ev.key === 'ArrowLeft') { goTo(current - 1); }
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
