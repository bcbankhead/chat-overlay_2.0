// Whisper state on the message box, replacing the engine's Whisper To field. While a user is
// whispered to, the box gets a blue border and a "Whisper <name> ×" chip on its top border at
// the right; × clears the whisper.
//
// whisperUser() and clearWhisper() are the only writers of #whisperID and assign .value with
// no event, so both globals are wrapped to re-read it — by this slice alone (TDF-0009 Shared
// Contract, Single wrappers). Inline handlers and the engine's own calls resolve them by
// global name and get the wrappers.

/**
 * @param {HTMLTextAreaElement} bar
 * @param {HTMLElement} host positioned ancestor the chip is placed in
 */
export function installWhisper(bar, host) {
  const field = /** @type {HTMLInputElement | null} */ (document.getElementById('whisperID'));
  if (!field) return;
  const win = /** @type {any} */ (window);

  const chip = document.createElement('span');
  chip.className = 'tdf-whisper-chip';
  chip.hidden = true;
  const label = document.createElement('span');
  label.className = 'tdf-whisper-label';
  label.textContent = 'Whisper';
  const name = document.createElement('span');
  name.className = 'tdf-whisper-name';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'tdf-whisper-clear';
  clear.title = 'Stop whispering';
  clear.setAttribute('aria-label', 'Stop whispering');
  clear.textContent = '×';
  chip.append(label, name, clear);
  host.appendChild(chip);

  const place = () => {
    if (chip.hidden) return;
    chip.style.left = `${bar.offsetLeft + bar.offsetWidth - chip.offsetWidth - 10}px`;
    chip.style.top = `${bar.offsetTop - chip.offsetHeight / 2}px`;
  };

  const sync = () => {
    const user = field.value;
    bar.classList.toggle('tdf-whisper', Boolean(user));
    chip.hidden = !user;
    name.textContent = user;
    place();
  };

  for (const fn of ['whisperUser', 'clearWhisper']) {
    const original = win[fn];
    if (typeof original !== 'function') continue;
    win[fn] = function (/** @type {unknown[]} */ ...args) {
      const result = original.apply(this, args);
      sync();
      return result;
    };
  }

  clear.addEventListener('click', () => {
    if (typeof win.clearWhisper === 'function') win.clearWhisper();
    bar.focus();
  });
  window.addEventListener('resize', place);
  if (typeof ResizeObserver === 'function') new ResizeObserver(place).observe(bar);
  sync();
}
