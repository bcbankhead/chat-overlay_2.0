// Whisper state on the message box (harness only), replacing the engine's Whisper To field.
// While a user is whispered to, textarea#optionsBar gets a blue border and a chip with
// their name sits on its top edge, at the right; the chip's x clears the whisper. With no whisper,
// no chip and the usual border.
//
// The engine sets #whisperID only through whisperUser() and clearWhisper(), assigning
// .value directly (no input event), so both globals are wrapped to re-read it. Inline
// handlers and the engine's own calls resolve these by global name and get the wrappers.
(function () {
  var bar = document.getElementById('optionsBar');
  var field = document.getElementById('whisperID');
  if (!bar || !field) return;

  var chip = document.createElement('span');
  chip.className = 'w-chip';
  chip.hidden = true;
  chip.innerHTML = '<span class="w-label">Whisper</span><span class="w-name"></span>' +
    '<button type="button" class="w-clear" title="Stop whispering" aria-label="Stop whispering">×</button>';
  var host = bar.offsetParent || bar.parentElement;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(chip);

  function place() {
    chip.style.left = bar.offsetLeft + bar.offsetWidth - chip.offsetWidth - 10 + 'px';
    chip.style.top = bar.offsetTop - chip.offsetHeight / 2 + 'px';
  }

  function sync() {
    var name = field.value;
    bar.classList.toggle('w-active', Boolean(name));
    chip.hidden = !name;
    chip.querySelector('.w-name').textContent = name;
    if (name) place();
  }

  ['whisperUser', 'clearWhisper'].forEach(function (fn) {
    var original = window[fn];
    if (typeof original !== 'function') return;
    window[fn] = function () {
      var result = original.apply(this, arguments);
      sync();
      return result;
    };
  });

  chip.querySelector('.w-clear').addEventListener('click', function () {
    window.clearWhisper();
    bar.focus();
  });
  window.addEventListener('resize', function () { if (!chip.hidden) place(); });
  if (window.ResizeObserver) new ResizeObserver(function () { if (!chip.hidden) place(); }).observe(bar);
  sync();
})();
