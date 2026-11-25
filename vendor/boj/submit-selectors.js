// The same packaged selectors are loaded in both submission worlds.
// Page messages carry form values only.
const CBOJ_SUBMIT_SELECTORS = Object.freeze({
  form: '#submit_form',
  language: 'select[name="language"]',
  codeOpen: 'input[name="code_open"]',
  editor: '.CodeMirror',
  source: 'textarea[name="source"]',
  buttons: 'button, input[type="submit"]',
});
