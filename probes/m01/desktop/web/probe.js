const button = document.querySelector('#run');
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    document.querySelector('#result').textContent = JSON.stringify(
      await window.__TAURI_INTERNALS__.invoke('run_probe'), null, 2);
  } catch (error) { document.querySelector('#result').textContent = String(error); }
  finally { button.disabled = false; }
});
