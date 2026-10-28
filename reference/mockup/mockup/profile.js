// Profile flyout (harness only): the gallery's width, only as tall as its content. Your
// avatar and name, eCredits (left the engine's bottom bar; still bound to the engine's
// own hidden control), then your text style (style.js). Auto-scroll is in the gear.
window.__profileFlyout = function () {
  var panel = document.createElement('div');
  panel.className = 'side-flyout side-profile';
  panel.addEventListener('transitionend', function (e) {
    if (e.target === panel && e.propertyName === 'transform' && panel.classList.contains('open')) {
      panel.classList.add('settled');
    }
  });
  panel.innerHTML =
    '<div class="p-head"><img class="p-avatar" alt=""><span class="p-name"></span></div>' +
    '<button type="button" class="p-row p-credits" title="About eCredits">' +
    '<span>eCredits</span><span class="p-value"></span></button>';

  var name = decodeURI(String(window.userName || ''));
  panel.querySelector('.p-name').textContent = name;
  var own = document.getElementById('avatar_' + window.uID);
  if (own) panel.querySelector('.p-avatar').src = own.getAttribute('src');

  // eCredits: the engine's #eCreditsID, kept current; the row opens the engine's own box.
  var credits = document.getElementById('eCreditsID');
  var value = panel.querySelector('.p-value');
  function syncCredits() { value.textContent = credits ? credits.textContent : '–'; }
  syncCredits();
  if (credits) new MutationObserver(syncCredits).observe(credits, { childList: true, characterData: true, subtree: true });
  panel.querySelector('.p-credits').addEventListener('click', function () {
    var icon = document.getElementById('iconeCredits');
    if (icon) icon.click();
  });

  // Your text style (style.js) belongs with your profile.
  if (typeof window.__textStyleSection === 'function') panel.appendChild(window.__textStyleSection());

  return panel;
};
