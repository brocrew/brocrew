import base64, glob, hashlib, json, os, subprocess, sys, tempfile
from pathlib import Path
SHA = 'a4f0eb875e2e77dd23349c15b676dd7c0bd0ac1e'
TREE = 'bda43face317e23d3a6e5f7a2e128139fe019e45'
PARENT = '717a32d4eb505ebfd937337b3782da0987cbff45'
PROOF_TIMEOUT, FRAME_TIMEOUT, SHORT = 480, 240, 60
test_b64 = sys.argv[1]
codes = {}
def sh(name, argv, timeout):
    print('W7125_RUN ' + name + ' ' + json.dumps(argv), flush=True)
    try:
        rc = subprocess.run(argv, timeout=timeout).returncode
    except subprocess.TimeoutExpired:
        rc = 'timeout%ds' % timeout
    codes[name] = rc
    print('W7125_EXIT %s %s' % (name, rc), flush=True)
    return rc
def export_pngs():
    for p in sorted(glob.glob('apps/desktop/**/w7125-*.png', recursive=True)):
        if 'node_modules' in p: continue
        d = Path(p).read_bytes()
        print('W7125_PNG %s sha256=%s bytes=%d' % (p, hashlib.sha256(d).hexdigest(), len(d)))
        print('W7125_B64 ' + p.split('/')[-1] + ' ' + base64.b64encode(d).decode(), flush=True)
proof = Path('apps/desktop/test/dom/w7125-proof.dom.test.ts')
created = False
with tempfile.TemporaryDirectory(prefix='j-', dir='/tmp') as t:
    for k in ('TMPDIR', 'TMP', 'TEMP'): os.environ[k] = t
    try:
        raw = subprocess.check_output(['git', 'cat-file', 'commit', 'HEAD'], timeout=SHORT).decode().split('\n\n')[0].split('\n')
        head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], timeout=SHORT).decode().strip()
        tree = [l.split()[1] for l in raw if l.startswith('tree ')]
        par = [l.split()[1] for l in raw if l.startswith('parent ')]
        print('W7125_IDENT ' + json.dumps({'head': head, 'tree': tree, 'parents': par}), flush=True)
        if head != SHA or tree != [TREE] or par != [PARENT]:
            print('W7125_IDENTITY_MISMATCH'); codes['identity'] = 'mismatch'; sys.exit(3)
        sh('status', ['git', 'status', '--short'], SHORT)
        sh('versions', ['bash', '-c', 'node --version; pnpm --version; uname -srm; fc-match sans-serif; fc-match system-ui; fc-list | wc -l; ls ~/.cache/ms-playwright 2>/dev/null'], SHORT)
        if proof.exists(): print('W7125_TARGET_PRESENT'); codes['target'] = 'present'; sys.exit(4)
        fd = os.open(proof, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644); created = True
        with os.fdopen(fd, 'wb') as f: f.write(base64.b64decode(test_b64))
        print('W7125_TESTSHA ' + hashlib.sha256(proof.read_bytes()).hexdigest(), flush=True)
        rc = sh('proof', ['pnpm', 'exec', 'vitest', 'run', '--project', 'dom', 'apps/desktop/test/dom/w7125-proof.dom.test.ts', '--maxWorkers=1'], PROOF_TIMEOUT)
        if rc == 0:
            sh('frame', ['pnpm', 'exec', 'vitest', 'run', '--project', 'dom', 'apps/desktop/test/dom/app-frame-reachable.dom.test.ts', '--maxWorkers=1'], FRAME_TIMEOUT)
        else:
            print('W7125_FRAME_SKIPPED proof did not pass', flush=True)
    finally:
        try:
            export_pngs()
        except Exception as error:
            print('W7125_EXPORT_ERROR ' + repr(error), flush=True)
        finally:
            try:
                if created and proof.exists(): proof.unlink()
            finally:
                print('W7125_CODES ' + json.dumps(codes), flush=True)
    sys.exit(0 if all(v == 0 for v in codes.values()) else 1)
