(() => {
  const theme = document.querySelector('[data-key="editorTheme"]');
  for (const [id, palette] of Object.entries(CBOJ_PALETTES)) theme.add(new Option(palette.label, id));
  const inputs = [...document.querySelectorAll('input[data-polish]')];
  function update(raw) {
    const values = CBOJ_POLISH.read(raw);
    for (const input of inputs) input.value = values[input.dataset.polish];
  }
  for (const input of inputs) {
    const key = input.dataset.polish;
    input.addEventListener('change', async () => {
      const value = input.type === 'number' ? input.valueAsNumber : input.value.trim();
      if (CBOJ_POLISH.valid(key, value)) await chrome.storage.sync.set({ [key]: value });
      else input.value = (await chrome.storage.sync.get(CBOJ_POLISH.defaults))[key];
    });
  }
  const refresh = () => chrome.storage.sync.get(CBOJ_POLISH.defaults).then(update);
  document.addEventListener('cboj-restored', refresh);
  refresh();
})();
