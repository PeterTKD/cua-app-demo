async function loadSources() {
  const grid = document.getElementById('sourceGrid');
  grid.textContent = 'Loading screens...';

  const sources = await window.pickerAPI.getDesktopSources();
  grid.textContent = '';

  sources.forEach((source) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';

    const img = document.createElement('img');
    img.src = source.thumbnail.toDataURL();
    img.alt = source.name;

    const label = document.createElement('span');
    label.textContent = source.name;

    card.appendChild(img);
    card.appendChild(label);
    card.addEventListener('click', () => {
      window.pickerAPI.selectSource({
        sourceId: source.id,
        displayId: source.display_id,
        name: source.name
      });
    });

    grid.appendChild(card);
  });
}

document.getElementById('cancelBtn').addEventListener('click', () => {
  window.pickerAPI.cancel();
});

loadSources().catch(() => {
  document.getElementById('sourceGrid').textContent = 'Failed to load screens.';
});
