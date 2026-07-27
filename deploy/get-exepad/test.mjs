import worker from './src/index.js';
const cases = [
  ['https://get.exepad.com/',                    'install.sh'],
  ['https://get.exepad.com',                     'install.sh'],
  ['https://get.exepad.com/install.sh',          'install.sh'],
  ['https://get.exepad.com/install.ps1',         'install.ps1'],
  ['https://get.exepad.com/install.ps1/',        'install.ps1'],
  ['https://get.exepad.com/install.sh.sha256',   'install.sh.sha256'],
  ['https://get.exepad.com/install.ps1.sha256',  'install.ps1.sha256'],
  ['https://get.exepad.com/anything-else',       'install.sh'],
  ['https://get.exepad.com/?x=1',                'install.sh'],
];
let bad = 0;
for (const [url, want] of cases) {
  const res = worker.fetch(new Request(url));
  const loc = res.headers.get('Location');
  const got = loc.split('/download/')[1];
  const ok = res.status === 302 && got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${url.padEnd(42)} -> ${got} (${res.status})`);
}
console.log(bad === 0 ? '\nall redirect targets correct' : `\n${bad} FAILED`);
process.exit(bad ? 1 : 0);
