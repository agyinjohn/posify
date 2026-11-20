const f = document.getElementById('f'); const input = document.getElementById('url'); const err = document.getElementById('err');
window.posify.getUrl().then((u) => { if (u) input.value = u; });
f.addEventListener('submit', async (e) => {
  e.preventDefault(); err.textContent = '';
  try { await window.posify.setUrl(input.value); } catch (x) { err.textContent = String(x.message || x).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
});
