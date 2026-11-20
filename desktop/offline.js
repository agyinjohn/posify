document.getElementById('retry').onclick = () => window.posify.retry();
document.getElementById('change').onclick = () => window.posify.changeUrl();
window.posify.getUrl().then((u) => { document.getElementById('addr').textContent = u || ''; });
