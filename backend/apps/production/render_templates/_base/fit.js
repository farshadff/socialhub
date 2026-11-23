// Text fitting (E06-S02 rules 11-12). Each [data-slot] carries data-max-font, data-min-font
// and data-max-lines (0 = no line limit, used by lists). Sizes shrink in 2 px steps until every
// slot respects its line limit and the content box does not overflow; whatever still does not
// fit at the minimum size is clamped with an ellipsis and reported as overflowing.
(function () {
  function lineHeightPx(el) {
    var cs = getComputedStyle(el);
    var lh = parseFloat(cs.lineHeight);
    if (isNaN(lh)) { lh = parseFloat(cs.fontSize) * 1.4; }
    return lh;
  }
  function textHeight(el) {
    var cs = getComputedStyle(el);
    return el.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  }
  function lineCount(el) { return Math.round(textHeight(el) / lineHeightPx(el)); }
  function size(el) { return parseFloat(el.style.fontSize); }
  function setSize(el, px) { el.style.fontSize = px + "px"; }

  window.__fit = function () {
    var content = document.querySelector(".content");
    var slots = Array.prototype.slice.call(document.querySelectorAll("[data-slot]"));
    var report = { fit: {}, overflow: [] };
    function overflowing() { return content.scrollHeight > content.clientHeight + 1; }

    slots.forEach(function (el) { setSize(el, +el.dataset.maxFont); });

    slots.forEach(function (el) {
      var maxLines = +el.dataset.maxLines, minFont = +el.dataset.minFont;
      while (maxLines > 0 && lineCount(el) > maxLines && size(el) - 2 >= minFont) {
        setSize(el, size(el) - 2);
      }
    });

    var guard = 0;
    while (overflowing() && guard++ < 400) {
      var shrunk = false;
      slots.forEach(function (el) {
        if (size(el) - 2 >= +el.dataset.minFont) { setSize(el, size(el) - 2); shrunk = true; }
      });
      if (!shrunk) { break; }
    }

    slots.forEach(function (el) {
      var maxLines = +el.dataset.maxLines;
      if (maxLines > 0 && lineCount(el) > maxLines) {
        el.classList.add("is-clamped");
        el.style.webkitLineClamp = String(maxLines);
        if (report.overflow.indexOf(el.dataset.slot) < 0) { report.overflow.push(el.dataset.slot); }
      }
    });

    // Still too tall at minimum sizes: clamp the tallest slot one line at a time.
    guard = 0;
    while (overflowing() && guard++ < 200) {
      var tallest = null;
      slots.forEach(function (el) {
        if (!tallest || el.scrollHeight > tallest.scrollHeight) { tallest = el; }
      });
      if (!tallest) { break; }
      var current = lineCount(tallest);
      if (current <= 1) { break; }
      tallest.classList.add("is-clamped");
      tallest.style.webkitLineClamp = String(current - 1);
      if (report.overflow.indexOf(tallest.dataset.slot) < 0) { report.overflow.push(tallest.dataset.slot); }
    }

    slots.forEach(function (el) { report.fit[el.dataset.slot] = size(el); });
    return report;
  };
})();
