// One Spanish message instead of the map (an error that ends a scene).
export function showMessage(message: string): void {
  const canvas = document.getElementById('map');
  const labels = document.getElementById('labels');
  if (canvas !== null) canvas.style.display = 'none';
  if (labels !== null) labels.style.display = 'none';
  const text = document.createElement('p');
  text.style.cssText = 'margin:16px;font:16px sans-serif;color:#2b2b2b';
  text.textContent = message;
  document.getElementById('panel')?.replaceChildren(text);
}
