"""Hosted-only numeric process identities and executable paths; never arguments or environments."""
import ctypes
import json
import os
import platform
import subprocess
import sys

if not (sys.platform == 'darwin' and platform.machine() == 'arm64'
        and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
        and os.environ.get('GITHUB_ACTIONS') == 'true'
        and os.environ.get('GITHUB_REPOSITORY') in ('brocrew/brocrew',)
        and os.environ.get('GITHUB_REF', '').startswith('refs/heads/gate/plugin-packaged-')):
    raise SystemExit(1)
lib = ctypes.CDLL('/usr/lib/libproc.dylib')
lib.proc_pidpath.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
lib.proc_pidpath.restype = ctypes.c_int
text = subprocess.check_output(['/bin/ps', '-axo', 'pid=,pgid=,lstart='],
                               env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'}, timeout=2, text=True)
rows = []
for line in text.splitlines():
    pid, group, birth = line.strip().split(None, 2)
    if int(pid) < 2 or int(group) < 2:
        continue
    buf = ctypes.create_string_buffer(4096)
    got = lib.proc_pidpath(int(pid), buf, len(buf))
    rows.append({'pid': int(pid), 'group': int(group), 'birth': birth,
                 'executable': buf.value.decode('utf-8', errors='strict') if got else None})
# Captured by the guardian only, never uploaded or forwarded to job logs.
print(json.dumps(rows))
