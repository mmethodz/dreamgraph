const fs = require('fs');
const path = require('path');

const file = path.resolve('extensions/vscode/src/chat-panel.ts');
let text = fs.readFileSync(file, 'utf8');

function mustReplace(oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`Missing block for ${label}`);
  text = text.replace(oldText, newText);
}

mustReplace(
`      bubble.remove();
      addMessage(entry.message, entry.actions, entry.roleMeta, entry.contextFooter);
`,
`      bubble.remove();
      addMessage(entry.message, entry.actions, entry.roleMeta, entry.contextFooter, { toolTrace: entry.message.role === 'assistant' ? [...lastToolTrace] : [], verdict: entry.message.role === 'assistant' ? lastVerdict : null });
`,
'rerenderMessageActions'
);

mustReplace(
`          addMessage(msg.message, msg.actions || [], msg.roleMeta, msg.contextFooter);
`,
`          addMessage(msg.message, msg.actions || [], msg.roleMeta, msg.contextFooter, { toolTrace: [...lastToolTrace], verdict: lastVerdict });
`,
'window addMessage'
);

mustReplace(
`        addMessage(entry.message, entry.actions, entry.roleMeta, entry.contextFooter);
`,
`        addMessage(entry.message, entry.actions, entry.roleMeta, entry.contextFooter, { toolTrace: entry.message.role === 'assistant' ? [...lastToolTrace] : [], verdict: entry.message.role === 'assistant' ? lastVerdict : null });
`,
'restoreState addMessage'
);

fs.writeFileSync(file, text, 'utf8');
console.log('patched followup render callsites');
