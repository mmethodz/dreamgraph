const fs = require('fs');
const p = 'src/server/dashboard.ts';
let text = fs.readFileSync(p, 'utf8');
text = text.replace("onsubmit=\"return confirm('Delete schedule ${escAttr(s.name)}?')\"", "");
text = text.replace(
`  </div>
  <script>
    document.getElementById('btn-restart').addEventListener('click', async function() {
      if (!confirm('Restart the DreamGraph server? The daemon manager will bring it back up automatically.')) return;
      const btn = this;
      btn.disabled = true;
      btn.textContent = 'Restarting…';
      try {
        await fetch('/restart', { method: 'POST' });
      } catch(e) { /* connection will drop */ }
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch('/health');
          if (r.ok) { clearInterval(poll); location.reload(); }
        } catch(e) { /* still restarting */ }
        if (attempts > 30) { clearInterval(poll); btn.textContent = 'Restart sent — refresh manually'; }
      }, 1000);
    });
  </script>` ,
`  </div>
  <div id="restart-status" class="card" style="display:none;margin:-8px 0 24px 0">
    <div><strong>Restart in progress</strong></div>
    <p id="restart-status-text" style="color:var(--text-dim);margin:6px 0 0 0;font-size:0.9rem">
      Sending restart request…
    </p>
  </div>
  <script>
    document.getElementById('btn-restart').addEventListener('click', async function() {
      const btn = this;
      const statusCard = document.getElementById('restart-status');
      const statusText = document.getElementById('restart-status-text');
      btn.disabled = true;
      btn.textContent = 'Restarting…';
      statusCard.style.display = 'block';
      statusText.textContent = 'Sending restart request to DreamGraph…';
      try {
        await fetch('/restart', { method: 'POST' });
        statusText.textContent = 'Restart request accepted. Waiting for server to come back online (this can take up to 30 seconds)…';
      } catch(e) { /* connection will drop */
        statusText.textContent = 'Restart request sent. Connection may drop while the server restarts. Waiting for it to come back online…';
      }
      let attempts = 0;
      const maxAttempts = 45;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch('/health', { cache: 'no-store' });
          if (r.ok) {
            clearInterval(poll);
            statusText.textContent = 'Server is back online. Reloading…';
            location.reload();
            return;
          }
        } catch(e) { /* still restarting */ }
        if (attempts >= maxAttempts) {
          clearInterval(poll);
          btn.disabled = false;
          btn.textContent = 'Restart Server';
          statusText.textContent = 'Restart is taking longer than expected. Please wait a bit longer, then refresh this page manually.';
        } else {
          statusText.textContent = 'Waiting for server to come back online… ' + attempts + 's elapsed.';
        }
      }, 1000);
    });
  </script>`
);
text = text.replace("      if (!confirm('Clear the saved database connection string from engine.env?')) return;\n", "");
fs.writeFileSync(p, text, 'utf8');
console.log('patched dashboard.ts');
