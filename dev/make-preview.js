'use strict';

/**
 * Generates `dev/preview.html` — a standalone page that renders the webview UI
 * outside of VS Code, useful for quick visual checks in a normal browser.
 *
 *   node dev/make-preview.js
 */
const fs = require('fs');
const path = require('path');
const { fullHtml } = require('../src/webviewHtml');

const out = path.join(__dirname, 'preview.html');

const html = fullHtml({
  title: 'Regex Deck — preview',
  styleUri: '../media/style.css',
  coreUri: '../media/core.js',
  appUri: '../media/app.js',
  headExtra: `<!-- preview shim: emulate the VS Code webview API -->
<style>
  :root {
    --vscode-font-family: "Segoe UI", system-ui, sans-serif;
    --vscode-font-size: 13px;
    --vscode-editor-font-family: Consolas, "Cascadia Mono", ui-monospace, monospace;
    --vscode-editor-font-size: 13px;
    --vscode-editor-font-weight: 400;
    --vscode-editor-background: #1e1e1e;
    --vscode-editor-foreground: #d4d4d4;
    --vscode-foreground: #cccccc;
    --vscode-sideBar-background: #252526;
    --vscode-input-background: #3c3c3c;
    --vscode-input-border: #3c3c3c;
    --vscode-focusBorder: #007fd4;
    --vscode-descriptionForeground: #9d9d9d;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
    --vscode-button-border: transparent;
    --vscode-editor-selectionBackground: #264f78;
    --vscode-editorCursor-foreground: #aeafad;
    --vscode-editor-findMatchHighlightBackground: #ea5c0055;
    --vscode-editor-findMatchBackground: #9e6a03;
    --vscode-editor-findMatchBorder: #f1894b;
    --vscode-list-hoverBackground: #2a2d2e;
    --vscode-list-activeSelectionBackground: #094771;
    --vscode-panel-border: #3c3c3c;
    --vscode-toolbar-hoverBackground: #5a5d5e50;
    --vscode-errorForeground: #f48771;
    --vscode-inputValidation-errorBorder: #be1100;
    --vscode-inputValidation-errorBackground: #5a1d1d;
  }
</style>
<script>
  (function () {
    var memory = null;
    window.acquireVsCodeApi = function () {
      return {
        getState: function () { return memory; },
        setState: function (value) { memory = value; },
        postMessage: function () {}
      };
    };
    document.body.classList.add('vscode-dark');
  })();
</script>`,
});

fs.writeFileSync(out, html, 'utf8');
console.log('wrote ' + out);
