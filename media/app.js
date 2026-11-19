/* Regex Deck — webview UI */
(function () {
  'use strict';

  const Core = window.RegexCore;
  const MAX_MATCHES = 5000;

  const FLAGS = [
    ['g', 'Global — find all matches'],
    ['i', 'Ignore case'],
    ['m', 'Multiline — ^ and $ match at line breaks'],
    ['s', 'Dotall — . matches newlines'],
    ['u', 'Unicode mode'],
    ['v', 'Unicode sets mode'],
    ['y', 'Sticky — match only at lastIndex'],
    ['d', 'Has indices'],
  ];

  const SAMPLE = {
    pattern: '(?<user>[\\w.+-]+)@(?<host>[\\w-]+(?:\\.[\\w-]+)+)',
    flags: 'g',
    text: [
      'Contact us:',
      '  alice@example.com — support',
      '  bob.smith@mail.co.uk',
      'nothing here',
      '  carol@sub.domain.io',
      '',
    ].join('\n'),
    wrap: true,
  };

  const api = typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { getState: () => null, setState: () => {}, postMessage: () => {} };

  const state = {
    pattern: SAMPLE.pattern,
    flags: SAMPLE.flags,
    text: SAMPLE.text,
    wrap: SAMPLE.wrap,
  };

  const view = {
    matches: [],
    activeIndex: -1,
    groupCount: 0,
    groupNames: {},
    error: '',
    truncated: false,
    lineStarts: null,
  };

  const el = {};
  let renderQueued = false;
  let lastCaret = -1;
  let persistTimer = 0;

  /* ------------------------------------------------------------------ boot */

  function $(id) { return document.getElementById(id); }

  function boot() {
    el.patternField = $('patternField');
    el.pattern = $('pattern');
    el.patternInner = $('patternInner');
    el.editor = $('editor');
    el.text = $('text');
    el.textInner = $('textInner');
    el.flags = $('flags');
    el.status = $('status');
    el.stats = $('stats');
    el.legend = $('legend');
    el.matches = $('matches');
    el.matchCount = $('matchCount');
    el.wrapBtn = $('wrapBtn');

    const saved = api.getState();
    if (saved && typeof saved === 'object') {
      if (typeof saved.pattern === 'string') state.pattern = saved.pattern;
      if (typeof saved.flags === 'string') state.flags = saved.flags;
      if (typeof saved.text === 'string') state.text = saved.text;
      if (typeof saved.wrap === 'boolean') state.wrap = saved.wrap;
    }

    buildFlags();
    el.pattern.value = state.pattern;
    el.text.value = state.text;
    updateWrapLabel();
    bind();
    render();
    api.postMessage({ type: 'ready' });

    el.pattern.focus();
    el.pattern.setSelectionRange(state.pattern.length, state.pattern.length);
    syncPatternScroll();
  }

  function bind() {
    el.pattern.addEventListener('input', scheduleRender);
    el.text.addEventListener('input', scheduleRender);
    el.pattern.addEventListener('scroll', syncPatternScroll);
    el.text.addEventListener('scroll', syncScroll);

    ['keyup', 'mouseup', 'click', 'focus', 'select'].forEach(function (ev) {
      el.text.addEventListener(ev, function () { syncActive(false); });
    });
    document.addEventListener('selectionchange', function () {
      if (document.activeElement === el.text) syncActive(false);
    });

    el.flags.addEventListener('click', onFlagClick);
    el.wrapBtn.addEventListener('click', toggleWrap);
    el.matches.addEventListener('click', onMatchClick);

    window.addEventListener('resize', applyWrap);
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(applyWrap).observe(el.editor);
    }

    window.addEventListener('message', function (event) {
      const msg = event.data;
      if (!msg || msg.type !== 'seed' || !msg.payload) return;
      const seed = msg.payload;
      if (typeof seed.pattern === 'string') state.pattern = seed.pattern;
      if (typeof seed.flags === 'string') state.flags = seed.flags;
      if (typeof seed.text === 'string') state.text = seed.text;
      if (typeof seed.wrap === 'boolean') state.wrap = seed.wrap;
      el.pattern.value = state.pattern;
      el.text.value = state.text;
      syncFlagButtons();
      updateWrapLabel();
      applyWrap();
      render();
    });
  }

  /* ---------------------------------------------------------------- flags */

  function buildFlags() {
    el.flags.innerHTML = '';
    FLAGS.forEach(function (def) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'flag';
      b.dataset.flag = def[0];
      b.textContent = def[0];
      b.title = def[0] + ' — ' + def[1];
      b.setAttribute('aria-label', def[1]);
      b.setAttribute('aria-pressed', 'false');
      el.flags.appendChild(b);
    });
    syncFlagButtons();
  }

  function syncFlagButtons() {
    const buttons = el.flags.querySelectorAll('button.flag');
    for (let i = 0; i < buttons.length; i++) {
      const on = state.flags.indexOf(buttons[i].dataset.flag) >= 0;
      buttons[i].classList.toggle('on', on);
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function onFlagClick(event) {
    const btn = event.target.closest ? event.target.closest('button.flag') : null;
    if (!btn) return;
    const flag = btn.dataset.flag;
    let flags = state.flags;
    if (flags.indexOf(flag) >= 0) {
      flags = flags.split('').filter(function (c) { return c !== flag; }).join('');
    } else {
      flags = flags + flag;
      if (flag === 'v') flags = flags.replace(/u/g, '');
      if (flag === 'u') flags = flags.replace(/v/g, '');
      flags = flags.split('').filter(function (c, i, all) { return all.indexOf(c) === i; }).sort().join('');
    }
    state.flags = flags;
    syncFlagButtons();
    scheduleRender();
  }

  /* -------------------------------------------------------------- wrapping */

  function updateWrapLabel() {
    el.wrapBtn.textContent = 'wrap: ' + (state.wrap ? 'on' : 'off');
  }

  function toggleWrap() {
    state.wrap = !state.wrap;
    updateWrapLabel();
    applyWrap();
    persist();
  }

  function applyWrap() {
    if (!el.editor) return;
    el.editor.classList.toggle('wrapped', !!state.wrap);
    if (state.wrap) {
      const width = el.text.clientWidth;
      if (width > 0) el.textInner.style.width = width + 'px';
    } else {
      el.textInner.style.width = '';
    }
    syncScroll();
  }

  function syncScroll() {
    if (!el.text) return;
    const x = Math.round(el.text.scrollLeft);
    const y = Math.round(el.text.scrollTop);
    el.textInner.style.transform = 'translate(' + (-x) + 'px,' + (-y) + 'px)';
  }

  function syncPatternScroll() {
    if (!el.pattern) return;
    el.patternInner.style.transform = 'translate(' + (-Math.round(el.pattern.scrollLeft)) + 'px,0)';
  }

  /* ---------------------------------------------------------------- render */

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      render();
    });
  }

  function render() {
    state.pattern = el.pattern.value;
    state.text = el.text.value;

    const tokenized = Core.tokenizePattern(state.pattern, state.flags);
    el.patternInner.innerHTML = Core.renderPattern(tokenized.tokens, state.pattern) + '\u200b';
    view.groupNames = tokenized.groupNames;

    let re = null;
    view.error = '';
    if (state.pattern) {
      try {
        re = new RegExp(state.pattern, state.flags);
      } catch (err) {
        view.error = String((err && err.message) || err);
      }
    }

    if (re) {
      const result = Core.scan(re, state.text, MAX_MATCHES);
      view.matches = result.matches;
      view.truncated = result.truncated;
    } else {
      view.matches = [];
      view.truncated = false;
    }

    let fromIndices = 0;
    if (view.matches.length && view.matches[0].indices) {
      fromIndices = view.matches[0].indices.length - 1;
    }
    view.groupCount = Math.max(tokenized.groupCount, fromIndices);

    view.lineStarts = null;
    lastCaret = el.text.selectionStart;
    view.activeIndex = activeAt(lastCaret);

    paintText();
    updateStatus();
    updateLegend();
    buildList();
    applyWrap();
    persist();
  }

  function activeAt(caret) {
    for (let i = 0; i < view.matches.length; i++) {
      const m = view.matches[i];
      if (caret >= m.index && caret <= m.index + m[0].length) return i;
    }
    return -1;
  }

  function syncActive(force) {
    const caret = el.text.selectionStart;
    if (!force && caret === lastCaret) return;
    lastCaret = caret;
    const idx = activeAt(caret);
    if (idx === view.activeIndex) return;
    view.activeIndex = idx;
    paintText();
    markActive();
  }

  function paintText() {
    const html = Core.buildHighlight(state.text, view.matches, view.activeIndex);
    el.textInner.innerHTML = html + '\u200b';
    el.editor.classList.toggle('has-match', view.matches.length > 0);
    syncScroll();
  }

  function updateStatus() {
    if (view.error) {
      el.status.className = 'status err';
      el.status.textContent = '\u2716 ' + view.error;
      el.status.title = view.error;
      el.patternField.classList.add('invalid');
      el.stats.textContent = '';
      return;
    }
    el.patternField.classList.remove('invalid');
    el.status.className = 'status ok';
    const n = view.matches.length;
    let msg;
    if (!state.pattern) msg = 'Type a regular expression, then edit the test string below.';
    else if (!n) msg = 'No matches.';
    else msg = n + (n === 1 ? ' match' : ' matches');
    if (view.truncated) msg += ' (first ' + MAX_MATCHES + ' shown)';
    el.status.textContent = msg;
    el.status.title = msg;
    el.stats.textContent = state.text.length + ' chars · ' + lineCount() + ' lines · ' +
      view.groupCount + (view.groupCount === 1 ? ' group' : ' groups');
  }

  function lineCount() {
    const starts = getLineStarts();
    return starts.length;
  }

  function getLineStarts() {
    if (view.lineStarts) return view.lineStarts;
    const starts = [0];
    const text = state.text;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    view.lineStarts = starts;
    return starts;
  }

  function locate(index) {
    const starts = getLineStarts();
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: index - starts[lo] + 1 };
  }

  function updateLegend() {
    const n = view.groupCount;
    if (!n) {
      el.legend.innerHTML = '<span class="dim">No capture groups</span>';
      return;
    }
    const out = [];
    for (let i = 1; i <= n; i++) {
      const cls = Core.groupClass(i);
      const name = view.groupNames[i];
      out.push('<span class="chip ' + cls + '" title="Group ' + i + (name ? ' — ' + Core.escHtml(name) : '') +
        '"><i></i>' + i + (name ? ' ' + Core.escHtml(name) : '') + '</span>');
    }
    el.legend.innerHTML = out.join('');
  }

  function buildList() {
    if (view.error) {
      el.matches.innerHTML = '<div class="empty">The pattern has an error.</div>';
      el.matchCount.textContent = '';
      return;
    }
    if (!view.matches.length) {
      el.matches.innerHTML = '<div class="empty">' + (state.pattern ? 'No matches.' : 'Type a pattern above.') + '</div>';
      el.matchCount.textContent = '';
      return;
    }

    const out = [];
    for (let i = 0; i < view.matches.length; i++) {
      const m = view.matches[i];
      const where = locate(m.index);
      const snippet = clip(m[0].replace(/\r?\n/g, '\u21b5').replace(/\t/g, '\u2192'), 180);
      out.push(
        '<div class="match" data-k="' + i + '">' +
          '<div class="m-top">' +
            '<span class="m-num">' + (i + 1) + '</span>' +
            '<span class="m-loc">' + where.line + ':' + where.col + '</span>' +
            '<span class="m-len">' + m[0].length + '</span>' +
          '</div>' +
          '<div class="m-snippet">' +
            (snippet ? Core.escHtml(snippet) : '<span class="dim">(empty match)</span>') +
          '</div>' +
          groupChips(m) +
        '</div>'
      );
    }
    el.matches.innerHTML = out.join('');
    el.matchCount.textContent = view.matches.length + (view.truncated ? '+' : '');
    markActive();
  }

  function markActive() {
    const items = el.matches.querySelectorAll('.match');
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', Number(items[i].dataset.k) === view.activeIndex);
    }
  }

  function groupChips(m) {
    const ind = m.indices;
    if (!ind || ind.length < 2) return '';
    const chips = [];
    for (let gi = 1; gi < ind.length; gi++) {
      const range = ind[gi];
      if (!range) continue;
      const value = m[gi];
      const name = view.groupNames[gi];
      const label = name ? gi + ' ' + name : gi;
      const text = value === undefined
        ? '<span class="dim">undefined</span>'
        : Core.escHtml(clip(value.replace(/\r?\n/g, '\u21b5').replace(/\t/g, '\u2192'), 90));
      chips.push(
        '<span class="chip ' + Core.groupClass(gi) + '" title="' + Core.escHtml(label) + '"><i></i>' +
        Core.escHtml(label) + ': ' + text + '</span>'
      );
    }
    return chips.length ? '<div class="m-groups">' + chips.join('') + '</div>' : '';
  }

  function clip(value, limit) {
    const flat = String(value);
    return flat.length > limit ? flat.slice(0, limit) + '\u2026' : flat;
  }

  /* ------------------------------------------------------------ match list */

  function onMatchClick(event) {
    const item = event.target.closest ? event.target.closest('.match') : null;
    if (!item) return;
    const k = Number(item.dataset.k);
    const m = view.matches[k];
    if (!m) return;
    el.text.focus();
    el.text.setSelectionRange(m.index, m.index + m[0].length);
    syncActive(true);
    reveal(m);
  }

  /** Locates a text offset inside the rendered mirror via a DOM Range. */
  function mirrorRangeAt(offset) {
    const walker = document.createTreeWalker(el.textInner, NodeFilter.SHOW_TEXT, null);
    let acc = 0;
    let node = walker.nextNode();
    let last = null;
    while (node) {
      const len = node.nodeValue.length;
      if (offset >= acc && offset < acc + len) {
        const start = offset - acc;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, Math.min(len, start + 1));
        return range;
      }
      last = node;
      acc += len;
      node = walker.nextNode();
    }
    if (last && last.nodeValue.length) {
      const range = document.createRange();
      const len = last.nodeValue.length;
      range.setStart(last, len - 1);
      range.setEnd(last, len);
      return range;
    }
    return null;
  }

  /** Scrolls the (invisible) textarea so that the mirrored match is visible. */
  function reveal(m) {
    const range = mirrorRangeAt(m.index);
    if (!range) return;
    const rect = range.getBoundingClientRect();
    const innerRect = el.textInner.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(el.text).lineHeight) || 19;
    const box = el.text;
    const contentTop = rect.top - innerRect.top;
    const contentLeft = rect.left - innerRect.left;
    box.scrollTop = clamp(contentTop - box.clientHeight / 2 + lh / 2, 0, box.scrollHeight - box.clientHeight);
    if (!state.wrap) {
      box.scrollLeft = clamp(contentLeft - box.clientWidth / 3, 0, box.scrollWidth - box.clientWidth);
    }
    syncScroll();
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  /* ---------------------------------------------------------------- persist */

  function persist() {
    const snapshot = {
      pattern: state.pattern,
      flags: state.flags,
      text: state.text,
      wrap: state.wrap,
    };
    api.setState(snapshot);
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      api.postMessage({ type: 'state', payload: snapshot });
    }, 350);
  }

  boot();
})();
