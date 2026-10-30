// Image attach on the message box (harness only). An image dropped on the box, or chosen
// with the + button on its right edge, waits as a small thumbnail at the box's left,
// where the text starts, until the message is sent (Enter or Send); the x on the
// thumbnail drops it. One image at a time.
//
// Sending: the harness has no server, so the image is posted as your own message in the
// view, locally. How the product uploads it (the engine's Share Files plugin, or its own
// store) is not decided; this mockup only settles the interaction.
(function () {
  var bar = document.getElementById('optionsBar');
  var send = document.getElementById('optionsSend');
  if (!bar) return;
  var host = bar.offsetParent || bar.parentElement;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;

  var plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'at-plus';
  plus.title = 'Add an image';
  plus.setAttribute('aria-label', 'Add an image');
  plus.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>';

  // Instruction line, always shown in the box's lower right (a textarea's own
  // placeholder cannot sit in a corner, and would hide while typing). The box keeps a
  // bottom margin clear for it (attach.css).
  var hint = document.createElement('div');
  hint.className = 'at-hint';
  hint.textContent = 'Shift+Enter for newline · Drag and drop images';

  var thumb = document.createElement('div');
  thumb.className = 'at-thumb';
  thumb.hidden = true;
  thumb.innerHTML = '<img alt=""><button type="button" class="at-drop" title="Remove image" aria-label="Remove image">×</button>';

  host.append(input, plus, thumb, hint);
  bar.classList.add('at-bar');

  var pending = null; // { file, url }

  function place() {
    var h = bar.offsetHeight;
    // Slightly above centre, leaving air above the instruction line.
    plus.style.top = bar.offsetTop + (h - plus.offsetHeight) / 2 - 8 + 'px';
    plus.style.left = bar.offsetLeft + bar.offsetWidth - plus.offsetWidth - 8 + 'px';
    hint.style.top = bar.offsetTop + h - hint.offsetHeight - 5 + 'px';
    hint.style.left = bar.offsetLeft + bar.offsetWidth - hint.offsetWidth - 10 + 'px';
    // The thumbnail sits where the text starts, at the box's top left; the text moves
    // over to make room (attach.css, .at-has).
    thumb.style.top = bar.offsetTop + 8 + 'px';
    thumb.style.left = bar.offsetLeft + 8 + 'px';
  }

  function attach(file) {
    if (!file || !/^image\//.test(file.type)) return;
    if (pending) URL.revokeObjectURL(pending.url);
    pending = { file: file, url: URL.createObjectURL(file) };
    thumb.querySelector('img').src = pending.url;
    thumb.title = file.name;
    thumb.hidden = false;
    bar.classList.add('at-has');
    place();
    bar.focus();
  }

  function clear(revoke) {
    if (pending && revoke) URL.revokeObjectURL(pending.url);
    pending = null;
    thumb.hidden = true;
    bar.classList.remove('at-has');
  }

  /** Post the pending image as your own message in the view (harness stand-in for upload). */
  function postImage() {
    var list = document.querySelector('#tdf-chat .tdf-list');
    if (!pending || !list) return;
    var me = decodeURI(String(window.userName || ''));
    var msg = document.createElement('div');
    msg.className = 'tdf-msg tdf-kind-public';
    msg.dataset.mtime = String(Math.floor(Date.now() / 1000));
    var line = document.createElement('span');
    line.className = 'tdf-line';
    line.style.color = window.textColor || '';
    var name = document.createElement('span');
    name.className = 'tdf-user tdf-sep';
    name.dataset.user = me;
    name.textContent = me;
    var body = document.createElement('span');
    body.className = 'tdf-body';
    var img = document.createElement('img');
    img.src = pending.url;
    img.alt = pending.file.name;
    body.appendChild(img);
    line.append(name, body);
    msg.appendChild(line);
    list.appendChild(msg);
    list.scrollTop = list.scrollHeight;
    clear(false); // the posted message keeps using the object URL
  }

  plus.addEventListener('click', function () { input.click(); });
  input.addEventListener('change', function () {
    attach(input.files && input.files[0]);
    input.value = '';
  });
  thumb.querySelector('.at-drop').addEventListener('click', function () { clear(true); bar.focus(); });

  // Drop anywhere on the box; the outline shows while an image is over it.
  bar.addEventListener('dragover', function (e) {
    if (!e.dataTransfer || ![].some.call(e.dataTransfer.items || [], function (i) { return i.kind === 'file'; })) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    bar.classList.add('at-over');
  });
  bar.addEventListener('dragleave', function () { bar.classList.remove('at-over'); });
  bar.addEventListener('drop', function (e) {
    bar.classList.remove('at-over');
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    attach(file);
  });

  // Enter (without Shift) or Send posts the image first; any typed text then goes
  // through the engine as usual. With no text, the engine is left nothing to send.
  bar.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && pending) {
      postImage();
      if (!bar.value.trim()) e.preventDefault();
    }
  }, true);
  if (send) {
    send.addEventListener('click', function (e) {
      if (!pending) return;
      postImage();
      if (!bar.value.trim()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  // The box's size and position come from the engine and our CSS, which can land after
  // this runs; follow it rather than placing once.
  window.addEventListener('resize', function () { place(); });
  if (window.ResizeObserver) new ResizeObserver(function () { place(); }).observe(bar);
  setTimeout(place, 300);
  place();
})();
