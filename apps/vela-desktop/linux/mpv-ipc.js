'use strict';
const net = require('node:net');
const readline = require('node:readline');
function connect(socketPath, onEvent = () => {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const pending = new Map();
    let sequence = 0;
    const fail = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Native player disconnected')); } pending.clear(); };
    socket.once('error', reject);
    socket.on('close', fail);
    readline.createInterface({ input: socket }).on('line', line => {
      let reply; try { reply = JSON.parse(line); } catch { return; }
      if (reply.event) onEvent(reply);
      const p = pending.get(reply.request_id); if (!p) return;
      pending.delete(reply.request_id); clearTimeout(p.timer);
      reply.error === 'success' ? p.resolve(reply.data) : p.reject(new Error('Native command failed'));
    });
    socket.once('connect', () => resolve({
      command(...command) {
        return new Promise((resolve, reject) => {
          const request_id = ++sequence;
          const timer = setTimeout(() => { pending.delete(request_id); reject(new Error('Native command timeout')); }, 5000);
          pending.set(request_id, { resolve, reject, timer });
          socket.write(JSON.stringify({ command, request_id }) + '\n');
        });
      },
      close() { fail(); socket.destroy(); },
    }));
  });
}
module.exports = { connect };
