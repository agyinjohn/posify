// Start file for cPanel "Setup Node.js App" (Phusion Passenger) and other hosts that load apps with require().
// The server is written as ES modules, which require() cannot load directly, so this loads it with import().
// In cPanel set "Application startup file" to app.cjs. Passenger takes over the port the server listens on.
import('./src/index.js').catch((err) => {
  console.error('Posify server failed to start:', err);
  process.exit(1);
});
