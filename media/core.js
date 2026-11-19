/*
 * Regex Deck — core logic (no DOM dependencies).
 *
 * Pure helpers shared by the webview UI and the Node test harness:
 *  - tokenizePattern(): a lenient JavaScript-flavour regex tokenizer used for
 *    syntax highlighting of the pattern itself.
 *  - scan(): collects matches (with group indices) honoring the user's flags.
 *  - buildHighlight(): turns matches + capture groups into nested HTML spans.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.RegexCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const GROUP_COLORS = 12;
  const FLAG_CHARS = 'dgimsuvy';

  function escHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) =>
      c === '&' ? '&amp;' :
      c === '<' ? '&lt;' :
      c === '>' ? '&gt;' :
      c === '"' ? '&quot;' : '&#39;'
    );
  }

  function colorIndex(n) {
    return ((n - 1) % GROUP_COLORS + GROUP_COLORS) % GROUP_COLORS + 1;
  }

  function groupClass(n) {
    return 'g' + colorIndex(n);
  }

  function isHex(src, start, len) {
    if (start + len > src.length) return false;
    for (let i = start; i < start + len; i++) {
      if (!/[0-9a-fA-F]/.test(src[i])) return false;
    }
    return true;
  }

  /** Returns the index just past the escape sequence starting at `start`. */
  function scanEscape(src, start) {
    const n = src.length;
    let i = start + 1;
    if (i >= n) return n;
    const d = src[i];
    if ((d === 'p' || d === 'P') && src[i + 1] === '{') {
      const e = src.indexOf('}', i + 2);
      return e < 0 ? n : e + 1;
    }
    if (d === 'k' && src[i + 1] === '<') {
      const e = src.indexOf('>', i + 2);
      return e < 0 ? n : e + 1;
    }
    if (d === 'u' && src[i + 1] === '{') {
      const e = src.indexOf('}', i + 2);
      return e < 0 ? n : e + 1;
    }
    if (d === 'x' && isHex(src, i + 1, 2)) return i + 3;
    if (d === 'u' && isHex(src, i + 1, 4)) return i + 5;
    if (d === 'c' && i + 1 < n) return i + 2;
    if (d >= '0' && d <= '9') {
      let j = i;
      while (j < n && src[j] >= '0' && src[j] <= '9') j++;
      return j;
    }
    return i + 1;
  }

  function escapeClass(seq) {
    if (seq[0] !== '\\') return 'p-escape';
    const d = seq[1];
    if (d >= '0' && d <= '9') return 'p-backref';
    if (d === 'k') return 'p-backref';
    if (d === 'p' || d === 'P') return 'p-property';
    if (d === 'b' || d === 'B') return 'p-anchor';
    return 'p-escape';
  }

  /**
   * Tokenizes a regex pattern. Never throws: malformed input produces tokens
   * that simply colour up to the end of the string.
   *
   * @param {string} pattern
   * @param {string} [flags]
   * @returns {{tokens: Array<{s:number,e:number,cls:string}>, groupCount:number, groupNames:Object<number,string>}}
   */
  function tokenizePattern(pattern, flags) {
    pattern = String(pattern || '');
    flags = String(flags || '');

    const tokens = [];
    const groupNames = {};
    const stack = [];
    const n = pattern.length;
    const nestedClasses = flags.indexOf('v') >= 0;
    let groupCount = 0;
    let i = 0;

    const add = (s, e, cls) => {
      if (e > s) tokens.push({ s: Math.max(0, s), e: Math.min(n, e), cls });
    };

    while (i < n) {
      const c = pattern[i];

      /* ---------- escapes ---------- */
      if (c === '\\') {
        const end = scanEscape(pattern, i);
        add(i, end, escapeClass(pattern.slice(i, end)));
        i = end;
        continue;
      }

      /* ---------- groups ---------- */
      if (c === '(') {
        const next = pattern[i + 1];
        if (next !== '?') {
          groupCount++;
          const cls = 'p-g p-g' + colorIndex(groupCount);
          add(i, i + 1, cls);
          stack.push(cls);
          i++;
          continue;
        }
        const d = pattern[i + 2];
        if (d === ':') {
          add(i, i + 3, 'p-nc');
          stack.push('p-nc');
          i += 3;
          continue;
        }
        if (d === '=' || d === '!') {
          add(i, i + 3, 'p-look');
          stack.push('p-look');
          i += 3;
          continue;
        }
        if (d === '<' && (pattern[i + 3] === '=' || pattern[i + 3] === '!')) {
          add(i, i + 4, 'p-look');
          stack.push('p-look');
          i += 4;
          continue;
        }
        if (d === '<' || (d === 'P' && pattern[i + 3] === '<')) {
          groupCount++;
          const cls = 'p-g p-g' + colorIndex(groupCount);
          const nameStart = d === '<' ? i + 3 : i + 4;
          let nameEnd = pattern.indexOf('>', nameStart);
          if (nameEnd < 0) nameEnd = n;
          const name = pattern.slice(nameStart, nameEnd);
          if (name) groupNames[groupCount] = name;
          add(i, nameStart, cls);
          add(nameStart, nameEnd, cls + ' p-name');
          add(nameEnd, nameEnd + 1, cls);
          stack.push(cls);
          i = Math.min(nameEnd + 1, n);
          continue;
        }
        // inline modifiers: (?ims) or (?ims-ims:…)  (JS never allows both u and v)
        let j = i + 2;
        let sawMinus = false;
        while (j < n) {
          const ch = pattern[j];
          if (FLAG_CHARS.indexOf(ch) >= 0) { j++; continue; }
          if (ch === '-' && !sawMinus) { sawMinus = true; j++; continue; }
          break;
        }
        if (j > i + 2 && j < n && (pattern[j] === ')' || pattern[j] === ':')) {
          add(i, i + 2, 'p-flags');
          add(i + 2, j, 'p-flagchar');
          add(j, j + 1, 'p-flags');
          if (pattern[j] === ':') stack.push('p-flags');
          i = j + 1;
          continue;
        }
        // Anything else is a syntax error; keep colouring neutrally.
        add(i, Math.min(i + 2, n), 'p-unmatched');
        stack.push('p-unmatched');
        i += 2;
        continue;
      }

      if (c === ')') {
        const cls = stack.pop();
        add(i, i + 1, cls || 'p-unmatched');
        i++;
        continue;
      }

      /* ---------- character classes ---------- */
      if (c === '[') {
        let j = i + 1;
        let depth = 1;
        let closed = false;
        if (pattern[j] === '^') j++;
        while (j < n) {
          const ch = pattern[j];
          if (ch === '\\') { j = scanEscape(pattern, j); continue; }
          if (nestedClasses && ch === '[') { depth++; j++; continue; }
          if (ch === ']') {
            depth--;
            j++;
            if (depth <= 0) { closed = true; break; }
            continue;
          }
          j++;
        }
        const end = Math.min(j, n);
        const closeAt = closed ? end - 1 : end;
        add(i, i + 1, 'p-classb');
        let k = i + 1;
        if (pattern[k] === '^') { add(k, k + 1, 'p-classb'); k++; }
        while (k < closeAt) {
          const ch = pattern[k];
          if (ch === '\\') {
            const escEnd = Math.min(scanEscape(pattern, k), closeAt);
            const cls = escapeClass(pattern.slice(k, escEnd));
            tokens.push({ s: k, e: escEnd, cls: cls + ' p-inclass' });
            k = escEnd;
            continue;
          }
          if (ch === '[' || ch === ']') { add(k, k + 1, 'p-classb'); k++; continue; }
          if (k + 1 < closeAt &&
              ((ch === '&' && pattern[k + 1] === '&') ||
               (ch === '-' && pattern[k + 1] === '-') ||
               (ch === '~' && pattern[k + 1] === '~'))) {
            add(k, k + 2, 'p-setop');
            k += 2;
            continue;
          }
          add(k, k + 1, 'p-classlit');
          k++;
        }
        if (closed) add(closeAt, end, 'p-classb');
        i = end;
        continue;
      }

      /* ---------- quantifiers ---------- */
      if (c === '{') {
        const m = /^\{\d+(?:,\d*)?\}/.exec(pattern.slice(i));
        if (m) {
          add(i, i + m[0].length, 'p-quant');
          i += m[0].length;
          continue;
        }
        add(i, i + 1, 'p-lit');
        i++;
        continue;
      }
      if (c === '*' || c === '+' || c === '?') {
        let j = i + 1;
        if (pattern[j] === '?') j++;
        add(i, j, 'p-quant');
        i = j;
        continue;
      }

      /* ---------- single characters ---------- */
      if (c === '|') { add(i, i + 1, 'p-alt'); i++; continue; }
      if (c === '^' || c === '$') { add(i, i + 1, 'p-anchor'); i++; continue; }
      if (c === '.') { add(i, i + 1, 'p-dot'); i++; continue; }

      add(i, i + 1, 'p-lit');
      i++;
    }

    // Merge contiguous tokens sharing a class to keep the markup small.
    const merged = [];
    for (let t = 0; t < tokens.length; t++) {
      const token = tokens[t];
      const last = merged[merged.length - 1];
      if (last && last.cls === token.cls && last.e === token.s) last.e = token.e;
      else merged.push({ s: token.s, e: token.e, cls: token.cls });
    }

    return { tokens: merged, groupCount, groupNames };
  }

  function renderPattern(tokens, pattern) {
    let html = '';
    let cursor = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.s > cursor) html += escHtml(pattern.slice(cursor, t.s));
      html += '<span class="' + t.cls + '">' + escHtml(pattern.slice(t.s, t.e)) + '</span>';
      cursor = t.e;
    }
    if (cursor < pattern.length) html += escHtml(pattern.slice(cursor));
    return html;
  }

  function isUnicodeMode(flags) {
    return flags.indexOf('u') >= 0 || flags.indexOf('v') >= 0;
  }

  /** Advances past one code point (keeps surrogate pairs intact in u/v mode). */
  function advanceIndex(text, index, unicode) {
    if (!unicode) return index + 1;
    const hi = text.charCodeAt(index);
    if (hi >= 0xd800 && hi <= 0xdbff) {
      const lo = text.charCodeAt(index + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) return index + 2;
    }
    return index + 1;
  }

  /**
   * Collects matches, always scanning with `g`/`d` internally while respecting
   * the user's own flags for the "show only the first match" behaviour.
   */
  function scan(re, text, maxMatches) {
    const limit = maxMatches || 5000;
    const flags = re.flags;
    const unicode = isUnicodeMode(flags);
    const withExtras = (extra) => {
      const set = {};
      (flags + extra).split('').forEach((c) => { set[c] = true; });
      return Object.keys(set).sort().join('');
    };
    const build = (extra) => {
      try { return new RegExp(re.source, withExtras(extra)); } catch (e) { return null; }
    };

    let engine = build('gd');
    let withIndices = true;
    if (!engine) { engine = build('g'); withIndices = false; }
    if (!engine) { engine = build(''); withIndices = false; }
    if (!engine) engine = re;

    const matches = [];
    let truncated = false;
    let m;
    try {
      while ((m = engine.exec(text)) !== null) {
        matches.push(m);
        const all = re.global || re.sticky;
        if (!all) break;
        if (m[0] === '') {
          if (m.index >= text.length) break;
          engine.lastIndex = advanceIndex(text, m.index, unicode);
        }
        if (matches.length >= limit) { truncated = true; break; }
      }
    } catch (e) {
      // Defensive: a pathological pattern should never freeze the UI.
      truncated = true;
    }
    if (!withIndices) {
      for (let i = 0; i < matches.length; i++) matches[i].indices = null;
    }
    return { matches, truncated };
  }

  function rank(cls) {
    if (cls === 'ln') return -1;
    if (cls === 'm' || cls === 'm act') return 0;
    return 1;
  }

  /**
   * Builds the highlighted HTML for the test string.
   *
   * Renders every match (and the overlapping capture-group ranges) by sweeping
   * span boundaries, so arbitrary nesting, lookbehind/lookahead captures and
   * zero-width matches all work.
   */
  function buildHighlight(text, matches, activeIndex) {
    const spans = [];
    const markers = [];
    const lineRanges = [];

    const lineStartOf = (pos) => {
      if (pos <= 0) return 0;
      return text.lastIndexOf('\n', pos - 1) + 1;
    };

    for (let k = 0; k < matches.length; k++) {
      const m = matches[k];
      const act = k === activeIndex;
      const start = m.index;
      const end = start + m[0].length;
      if (end > start) {
        spans.push({ s: start, e: end, cls: act ? 'm act' : 'm', rank: 0 });
        const ind = m.indices;
        if (ind && ind.length > 1) {
          for (let gi = 1; gi < ind.length; gi++) {
            const r = ind[gi];
            if (!r || r[1] <= r[0]) continue;
            spans.push({
              s: r[0],
              e: r[1],
              cls: 'grp ' + groupClass(gi) + (act ? ' act' : ''),
              rank: 1,
            });
          }
        }
      } else {
        markers.push({ pos: start, act, rank: act ? 0 : 1 });
      }

      // Weak "this line took part in a match" tint, limited to the lines the
      // match actually touches (so with `m` only matching lines get tinted).
      const last = m[0].length ? end - 1 : start;
      const firstLineStart = lineStartOf(start);
      const lastLineStart = lineStartOf(last);
      let lastLineEnd = text.indexOf('\n', lastLineStart);
      if (lastLineEnd < 0) lastLineEnd = text.length;
      if (lastLineEnd > firstLineStart) lineRanges.push([firstLineStart, lastLineEnd]);
    }

    // Merge overlapping line ranges so nested matches don't stack the tint.
    lineRanges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const mergedLines = [];
    for (let i = 0; i < lineRanges.length; i++) {
      const range = lineRanges[i];
      const prev = mergedLines[mergedLines.length - 1];
      if (prev && range[0] <= prev[1]) {
        if (range[1] > prev[1]) prev[1] = range[1];
      } else {
        mergedLines.push([range[0], range[1]]);
      }
    }
    for (let i = 0; i < mergedLines.length; i++) {
      spans.push({ s: mergedLines[i][0], e: mergedLines[i][1], cls: 'ln', rank: -1 });
    }

    const events = [];
    for (let i = 0; i < spans.length; i++) {
      events.push({ pos: spans[i].s, kind: 1, sp: spans[i] });
      events.push({ pos: spans[i].e, kind: -1, sp: spans[i] });
    }
    events.sort((a, b) => a.pos - b.pos || a.kind - b.kind);

    const pieces = [];
    const active = [];
    let cursor = 0;
    let ev = 0;
    while (ev < events.length) {
      const pos = events[ev].pos;
      if (pos > cursor) pieces.push({ s: cursor, e: pos, levels: levelsOf(active) });
      let j = ev;
      while (j < events.length && events[j].pos === pos) {
        if (events[j].kind === -1) {
          const at = active.indexOf(events[j].sp);
          if (at >= 0) active.splice(at, 1);
        }
        j++;
      }
      j = ev;
      while (j < events.length && events[j].pos === pos) {
        if (events[j].kind === 1) active.push(events[j].sp);
        j++;
      }
      cursor = pos;
      ev = j;
    }
    if (cursor < text.length) pieces.push({ s: cursor, e: text.length, levels: levelsOf(active) });

    /* insert zero-width markers, splitting pieces when required */
    markers.sort((a, b) => a.pos - b.pos || a.rank - b.rank);
    const finalPieces = [];
    let mi = 0;
    for (let i = 0; i < pieces.length; i++) {
      const pc = pieces[i];
      while (mi < markers.length && markers[mi].pos < pc.s) finalPieces.push({ marker: markers[mi++] });
      let start = pc.s;
      while (mi < markers.length && markers[mi].pos < pc.e) {
        const mp = markers[mi].pos;
        if (mp > start) finalPieces.push({ s: start, e: mp, levels: pc.levels });
        finalPieces.push({ marker: markers[mi++] });
        start = mp;
      }
      if (start < pc.e) finalPieces.push({ s: start, e: pc.e, levels: pc.levels });
    }
    while (mi < markers.length) finalPieces.push({ marker: markers[mi++] });

    let html = '';
    for (let i = 0; i < finalPieces.length; i++) {
      const pc = finalPieces[i];
      if (pc.marker) {
        html += '<span class="zero' + (pc.marker.act ? ' act' : '') + '"></span>';
        continue;
      }
      let inner = escHtml(text.slice(pc.s, pc.e));
      if (!inner) continue;
      const levels = pc.levels;
      for (let l = levels.length - 1; l >= 0; l--) {
        if (levels[l]) inner = '<span class="' + levels[l] + '">' + inner + '</span>';
      }
      html += inner;
    }
    return html;

    function levelsOf(list) {
      if (!list.length) return [];
      const out = [];
      for (let i = 0; i < list.length; i++) out.push(list[i].cls);
      out.sort((a, b) => rank(a) - rank(b));
      return out;
    }
  }

  return {
    GROUP_COLORS,
    escHtml,
    colorIndex,
    groupClass,
    tokenizePattern,
    renderPattern,
    scan,
    buildHighlight,
    advanceIndex,
    isUnicodeMode,
  };
});
