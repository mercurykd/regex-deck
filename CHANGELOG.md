# Changelog

All notable changes to Regex Deck are documented in this file.

## [0.1.2] — 2026-11-20

First public release.

### Added

- Live JavaScript regex testing inside a VS Code panel.
- Highlighting for every match, with a distinct active match.
- Per-capture-group colours shared between the text and the pattern.
- Regex syntax highlighting: groups, classes, escapes, quantifiers, anchors,
  lookarounds, inline flags and named groups.
- Match inspector with line:column positions, lengths and group values.
- Flags `g`, `i`, `m`, `s`, `u`, `v`, `y` and `d`.
- `Test Selection as Regex` command for the editor context menu.
- Soft-wrap toggle and persisted panel state.
- Standalone browser preview and Node test suite for development.
- Extension icon for the Marketplace listing.

### Changed

- Removed the third-party `regex101` keyword from the manifest.
- Dropped the localhost URL from the README development instructions.

[0.1.2]: https://github.com/mercurykd/regex-deck/releases/tag/v0.1.2
