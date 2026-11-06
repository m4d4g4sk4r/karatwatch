"""Reject accidentally tracked private files and known credential formats."""
import re
import subprocess
from pathlib import Path

patterns = [r"cfast_[A-Za-z0-9_-]{20,}", r"[a-f0-9]{32}\.access", r"gh[pousr]_[A-Za-z0-9]{20,}", r"-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----"]
errors = []
for name in subprocess.check_output(["git", "ls-files"], text=True).splitlines():
    path = Path(name)
    if path.name == ".env" or path.name == "tunnel-credentials.json" or name == "frontend/Price history.js":
        errors.append(f"Private file tracked: {name}")
    if path.is_file():
        text = path.read_text(errors="replace")
        if any(re.search(pattern, text) for pattern in patterns):
            errors.append(f"Credential-like content: {name}")
if errors:
    raise SystemExit("\n".join(errors))
print("Tracked publication files passed credential checks (not a full secret audit).")
