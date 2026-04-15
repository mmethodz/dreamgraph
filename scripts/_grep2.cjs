const fs = require('fs');
const file = process.argv[2];
const pattern = new RegExp(process.argv[3], 'i');
const lines = fs.readFileSync(file, 'utf8').split('\n');
const results = [];
lines.forEach((l, i) => { if (pattern.test(l)) results.push((i+1) + ': ' + l); });
fs.writeFileSync('scripts/_grep_out.txt', results.join('\n'));
console.log('wrote ' + results.length + ' lines to scripts/_grep_out.txt');
