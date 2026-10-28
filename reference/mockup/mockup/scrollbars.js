// Floating scrollbars (harness only). The native bars are hidden (scrollbars.css) and each
// scroll area gets a thin thumb drawn over its content: it takes no width, shows while
// scrolling or hovering, fades out after, and can be dragged. Areas are found by selector
// when first scrolled or hovered, so ones rebuilt by a re-render are picked up again.
(function () {
  var AREAS = ['#tdf-chat .tdf-list', '#tdf-side .side-flyout', '#tdf-side .side-users'].join(',');
  var HIDE_AFTER_MS = 900;
  var MIN_THUMB = 24;
  var INSET = 3;
  var bars = new WeakMap();

  function bar(area) {
    var existing = bars.get(area);
    if (existing) return existing;
    if (getComputedStyle(area).position === 'static') area.style.position = 'relative';
    var thumb = document.createElement('div');
    thumb.className = 'fs-thumb';
    area.appendChild(thumb);
    var state = { thumb: thumb, timer: 0, dragging: false };
    bars.set(area, state);

    thumb.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      state.dragging = true;
      thumb.classList.add('dragging');
      var startY = e.clientY;
      var startTop = area.scrollTop;
      var ratio = area.scrollHeight / area.clientHeight;
      function move(ev) {
        area.scrollTop = startTop + (ev.clientY - startY) * ratio;
      }
      function up() {
        state.dragging = false;
        thumb.classList.remove('dragging');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        show(area);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    return state;
  }

  function place(area, state) {
    var view = area.clientHeight;
    var total = area.scrollHeight;
    if (total <= view + 1) {
      state.thumb.style.display = 'none';
      return false;
    }
    state.thumb.style.display = '';
    var track = view - INSET * 2;
    var h = Math.max(MIN_THUMB, (track * view) / total);
    var y = INSET + ((track - h) * area.scrollTop) / (total - view);
    state.thumb.style.height = h + 'px';
    // The thumb lives inside the scrolled content, so offset it by scrollTop.
    state.thumb.style.transform = 'translateY(' + (area.scrollTop + y) + 'px)';
    return true;
  }

  function show(area) {
    var state = bar(area);
    if (!place(area, state)) return;
    state.thumb.classList.add('visible');
    clearTimeout(state.timer);
    state.timer = setTimeout(function () {
      if (!state.dragging && !area.matches(':hover')) state.thumb.classList.remove('visible');
    }, HIDE_AFTER_MS);
  }

  document.addEventListener('scroll', function (e) {
    var area = e.target instanceof Element && e.target.closest(AREAS);
    if (area === e.target) show(area);
  }, true);

  document.addEventListener('mouseover', function (e) {
    var area = e.target instanceof Element && e.target.closest(AREAS);
    if (area) show(area);
  });

  document.addEventListener('mouseout', function (e) {
    var area = e.target instanceof Element && e.target.closest(AREAS);
    if (area && !area.contains(e.relatedTarget)) show(area); // restart the fade-out timer
  });
})();
