'use strict';

/**
 * Markup for the Regex Deck webview.
 *
 * Kept in a separate module (no `vscode` dependency) so the same markup can be
 * rendered by the dev preview generator in `dev/make-preview.js`.
 */

function bodyHtml() {
  return `
<div class="app">
  <header class="bar">
    <div class="pattern-line">
      <span class="delim" aria-hidden="true">/</span>
      <div class="field pattern-field" id="patternField">
        <div class="mirror" aria-hidden="true"><div class="mirror-inner" id="patternInner"></div></div>
        <textarea id="pattern" rows="1" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"
          aria-label="Regular expression" title="Regular expression (JavaScript flavour)"></textarea>
      </div>
      <span class="delim" aria-hidden="true">/</span>
      <div class="flags" id="flags" role="group" aria-label="Regular expression flags"></div>
    </div>
    <div class="status-line">
      <div class="status" id="status" role="status" aria-live="polite"></div>
      <div class="stats" id="stats"></div>
    </div>
  </header>
  <main class="panes">
    <section class="pane text-pane">
      <div class="pane-header">
        <span class="pane-title">Test string</span>
        <span class="grow"></span>
        <button type="button" class="mini-btn" id="wrapBtn" title="Toggle soft wrapping">wrap: on</button>
      </div>
      <div class="field editor" id="editor">
        <div class="mirror" aria-hidden="true"><div class="mirror-inner" id="textInner"></div></div>
        <textarea id="text" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"
          aria-label="Test string"></textarea>
      </div>
    </section>
    <aside class="pane side-pane">
      <div class="pane-header">
        <span class="pane-title">Matches</span>
        <span class="grow"></span>
        <span class="count" id="matchCount"></span>
      </div>
      <div class="legend" id="legend"></div>
      <div class="match-list" id="matches"></div>
    </aside>
  </main>
</div>`;
}

/**
 * @param {{cspSource?: string, styleUri: string, coreUri: string, appUri: string,
 *          nonce?: string, headExtra?: string, title?: string}} opts
 */
function fullHtml(opts) {
  const nonce = opts.nonce;
  const csp = opts.cspSource
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${opts.cspSource} data:; style-src ${opts.cspSource}; script-src 'nonce-${nonce}'; font-src ${opts.cspSource};">`
    : '';
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
${csp}
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${opts.title || 'Regex Deck'}</title>
<link rel="stylesheet" href="${opts.styleUri}" />
</head>
<body>
${bodyHtml()}
${opts.headExtra || ''}
<script${nonceAttr} src="${opts.coreUri}"></script>
<script${nonceAttr} src="${opts.appUri}"></script>
</body>
</html>`;
}

module.exports = { bodyHtml, fullHtml };
