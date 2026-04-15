const http = require('http');
const fs = require('fs');

function post(body, sessionId) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(data)
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;

    const req = http.request({
      hostname: 'localhost', port: 8010, path: '/mcp', method: 'POST', headers
    }, res => {
      // capture session id from response headers
      const sid = res.headers['mcp-session-id'] || res.headers['x-mcp-session-id'] || null;
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        const clean = buf.split('\n')
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trim())
          .join('') || buf;
        try { resolve({ body: JSON.parse(clean), sessionId: sid }); }
        catch { resolve({ body: clean, sessionId: sid }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main(toolName, toolArgs) {
  // 1. Initialize
  const init = await post({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dg-agent', version: '1.0' }
    }
  });
  fs.writeFileSync('scripts/_mcp_init.json', JSON.stringify(init.body, null, 2));

  const sessionId = init.sessionId;
  console.error('session:', sessionId);

  // 2. Initialized notification
  await post({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sessionId);

  // 3. Tool call
  const result = await post({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: toolName, arguments: toolArgs }
  }, sessionId);

  fs.writeFileSync('scripts/_mcp_result.json', JSON.stringify(result.body, null, 2));
  console.log('done');
}

const tool = process.argv[2] || 'get_dream_insights';
const args = process.argv[3] ? JSON.parse(process.argv[3]) : { instance_id: 'ee9ce3b9-0313-4768-b5f1-24b9b3fffc4b' };
main(tool, args).catch(e => { console.error(e); process.exit(1); });
