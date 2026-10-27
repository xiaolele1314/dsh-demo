// agent-server.js — keeps the container alive, waiting for exec commands
console.log('[agent-server] Agent container started, waiting for commands...');

// keep process alive
setInterval(() => {}, 60000);

process.on('SIGTERM', () => {
  console.log('[agent-server] Received SIGTERM, shutting down');
  process.exit(0);
});
