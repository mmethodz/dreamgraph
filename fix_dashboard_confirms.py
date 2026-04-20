from pathlib import Path

path = Path('src/server/dashboard.ts')
text = path.read_text(encoding='utf-8')

text = text.replace(
    "      if (!confirm('Restart the DreamGraph server? The daemon manager will bring it back up automatically.')) return;\n",
    "",
)
text = text.replace(
    "        if (attempts > 30) { clearInterval(poll); btn.textContent = 'Restart sent — refresh manually'; }\n",
    "        if (attempts > 45) { clearInterval(poll); btn.textContent = 'Restart sent — refresh manually'; }\n",
)
text = text.replace(
    "      if (!confirm('Clear the saved database connection string from engine.env?')) return;\n",
    "",
)

path.write_text(text, encoding='utf-8')
