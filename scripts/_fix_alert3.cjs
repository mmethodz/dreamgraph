const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'tools', 'api-surface.ts');
let src = fs.readFileSync(file, 'utf-8');

const before =
`    // Strip C# parameter modifiers: this, params, ref, out, in, scoped\r\n    let cleaned = param.replace(/^(?:this|params|ref|out|in|scoped)\\s+/, \"\");\r\n    // Handle chained modifiers: \"this ref MyStruct s\" → \"ref MyStruct s\" → \"MyStruct s\"\r\n    cleaned = cleaned.replace(/^(?:this|params|ref|out|in|scoped)\\s+/, \"\");`;

const after =
`    // Strip C# parameter modifiers (loop handles chained: "this ref MyStruct s")\r\n    let cleaned = param;\r\n    let prev: string;\r\n    do { prev = cleaned; cleaned = cleaned.replace(/^(?:this|params|ref|out|in|scoped)\\s+/, \"\"); } while (cleaned !== prev);`;

if (!src.includes(before.replace(/\\r\\n/g, '\r\n'))) {
  // try without \r
  const beforeLF = before.replace(/\\r\\n/g, '\n');
  const afterLF = after.replace(/\\r\\n/g, '\n');
  if (src.includes(beforeLF)) {
    src = src.replace(beforeLF, afterLF);
    fs.writeFileSync(file, src, 'utf-8');
    console.log('fixed (LF)');
  } else {
    console.log('PATTERN NOT FOUND');
    process.exit(1);
  }
} else {
  src = src.replace(before.replace(/\\r\\n/g, '\r\n'), after.replace(/\\r\\n/g, '\r\n'));
  fs.writeFileSync(file, src, 'utf-8');
  console.log('fixed (CRLF)');
}
