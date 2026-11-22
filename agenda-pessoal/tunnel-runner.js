const { spawn } = require('child_process');

console.log('Iniciando túnel SSH com localhost.run...');
const ssh = spawn('ssh', [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'ServerAliveInterval=30',
  '-R', '80:localhost:3001',
  'nokey@localhost.run'
]);

ssh.stdout.on('data', (data) => {
  const text = data.toString();
  console.log('[STDOUT]: ' + text);
});

ssh.stderr.on('data', (data) => {
  const text = data.toString();
  console.log('[STDERR]: ' + text);
});

ssh.on('close', (code) => {
  console.log(`Túnel fechado com código ${code}`);
});
