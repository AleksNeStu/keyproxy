const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'KeyProxy',
  description: 'API Key Orchestrator & Proxy — rotation, health checks, environment sync',
  script: path.join(__dirname, 'main.js'),
  nodeOptions: ['--harmony'],
  workingDirectory: __dirname,
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'KEYPROXY_DIR', value: __dirname }
  ]
});

svc.on('install', () => {
  console.log('KeyProxy service installed.');
  svc.start();
});

svc.on('start', () => {
  console.log('KeyProxy service started.');
});

svc.on('alreadyinstalled', () => {
  console.log('KeyProxy service already installed.');
});

svc.on('uninstall', () => {
  console.log('KeyProxy service uninstalled.');
});

svc.on('error', (err) => {
  console.error('Service error:', err.message);
});

const command = process.argv[2];
if (command === 'uninstall') {
  svc.uninstall();
} else {
  svc.install();
}
