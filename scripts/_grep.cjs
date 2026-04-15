const fs = require('fs');
const file = process.argv[2];
const pattern = new RegExp(process.argv[3], 'i');
const lines = fs.readFileSync(file, 'utf8').split('\n');
lines.forEach((l, i) => { if (pattern.test(l)) console.log((i+1) + ': ' + l); });
