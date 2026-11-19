'use strict';

const vscode = require('vscode');
const { fullHtml } = require('./webviewHtml');

const STATE_KEY = 'regexDeck.snapshot';
const PANEL_VIEW_TYPE = 'regexDeck.panel';

let panel = null;
let webviewReady = false;
let pendingSeed = null;

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('regexDeck.open', function () {
      openPanel(context);
    }),
    vscode.commands.registerCommand('regexDeck.openSelection', function () {
      const seed = seedFromSelection();
      if (!seed) {
        vscode.window.showInformationMessage('Select the regex (first line) and the text to test (following lines) first.');
        return;
      }
      openPanel(context, seed);
    })
  );
}

function deactivate() {
  if (panel) {
    panel.dispose();
    panel = null;
  }
}

/**
 * Opens (or reveals) the Regex Deck panel.
 * @param {vscode.ExtensionContext} context
 * @param {{pattern?: string, flags?: string, text?: string} | undefined} seed
 */
function openPanel(context, seed) {
  if (panel) {
    panel.reveal(panel.viewColumn || vscode.ViewColumn.Active, false);
    if (seed) {
      if (webviewReady) panel.webview.postMessage({ type: 'seed', payload: seed });
      else pendingSeed = seed;
    }
    return;
  }

  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  const created = vscode.window.createWebviewPanel(
    PANEL_VIEW_TYPE,
    'Regex Deck',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [mediaRoot],
    }
  );

  panel = created;
  webviewReady = false;
  pendingSeed = seed || null;

  const webview = created.webview;
  const uri = function (file) {
    return webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, file)).toString();
  };

  webview.html = fullHtml({
    cspSource: webview.cspSource,
    styleUri: uri('style.css'),
    coreUri: uri('core.js'),
    appUri: uri('app.js'),
    nonce: getNonce(),
  });

  webview.onDidReceiveMessage(
    function (msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ready') {
        webviewReady = true;
        const payload = pendingSeed || context.workspaceState.get(STATE_KEY);
        pendingSeed = null;
        if (payload) webview.postMessage({ type: 'seed', payload: payload });
        return;
      }
      if (msg.type === 'state' && msg.payload && typeof msg.payload === 'object') {
        context.workspaceState.update(STATE_KEY, msg.payload);
      }
    },
    null,
    context.subscriptions
  );

  created.onDidDispose(
    function () {
      panel = null;
      webviewReady = false;
      pendingSeed = null;
    },
    null,
    context.subscriptions
  );
}

/**
 * Reads the current editor selection: first line = pattern (optionally written
 * as /pattern/flags), remaining lines = test string.
 */
function seedFromSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) return undefined;

  const raw = editor.document.getText(editor.selection);
  if (!raw.trim()) return undefined;

  const lines = raw.split(/\r?\n/);
  let pattern = lines[0].trim();
  let flags;
  const delimited = /^\/([\s\S]*)\/([a-z]*)$/.exec(pattern);
  if (delimited) {
    pattern = delimited[1].replace(/\\\//g, '/');
    flags = delimited[2];
  }

  const seed = { pattern: pattern };
  if (typeof flags === 'string') seed.flags = flags;
  const rest = lines.slice(1).join('\n');
  if (rest.length) seed.text = rest;
  return seed;
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

module.exports = { activate, deactivate };
