// Loaded first by harness.html. The engine polls and posts through XMLHttpRequest; here
// every request opens and sends nothing and never completes, so the captured page stays
// as it was saved and nothing reaches the chat server. Then, once the engine's own
// window.onload (initAll) has run, the overlay is injected as a document-idle userscript.
(function () {
  function OfflineXHR() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.responseXML = null;
  }
  OfflineXHR.prototype.open = function () {};
  OfflineXHR.prototype.send = function () {};
  OfflineXHR.prototype.abort = function () {};
  OfflineXHR.prototype.addEventListener = function () {};
  OfflineXHR.prototype.removeEventListener = function () {};
  OfflineXHR.prototype.setRequestHeader = function () {};
  OfflineXHR.prototype.getResponseHeader = function () { return null; };
  window.XMLHttpRequest = OfflineXHR;

  function loadScript(src, done) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false; // run in the order inserted: thumbs.js before sidebar.js uses it
    if (done) s.onload = done;
    document.body.appendChild(s);
  }

  // ?mock=0 shows the overlay alone: no seeded history, no UI mockups.
  var mocks = new URLSearchParams(location.search).get('mock') !== '0';

  function injectOverlay() {
    loadScript('/tdf-chat.user.js');
    if (!mocks) return;
    loadScript('mockup/thumbs.js');
    loadScript('mockup/ink.js');
    loadScript('mockup/gallery.js');
    loadScript('mockup/profile.js');
    loadScript('mockup/style.js');
    loadScript('mockup/smilies.js');
    loadScript('mockup/reactions.js');
    ['sidebar', 'messages', 'scrollbars', 'whisper', 'attach'].forEach(function (name) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'mockup/' + name + '.css';
      document.head.appendChild(css);
      loadScript('mockup/' + name + '.js');
    });
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!mocks) return injectOverlay();
      // The saved page's messages go into the overlay's history first, so it replays them.
      // Then the history limit is applied, as the product would on start.
      loadScript('mockup/limits.js');
      loadScript('mockup/seed-history.js', function () {
        window.__seedHistory()
          .then(function () { return window.__limits.pruneHistory(); })
          .then(injectOverlay, function (err) {
            console.error('seed-history failed', err);
            injectOverlay();
          });
      });
    }, 0);
  });
})();
