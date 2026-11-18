"""One fictional-file Windows diagnostic. Owner: Emeka; checker: Teo.

Observations are evidence, not assertions that a particular errno must occur.
No Chrome, product edits, ACL changes, or synthetic filesystem errors.
"""
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time

assert sys.platform == 'win32'
node = sys.argv[1]
k = ctypes.WinDLL('kernel32', use_last_error=True)
k.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                        wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
k.CreateFileW.restype = wintypes.HANDLE
k.CloseHandle.argtypes = [wintypes.HANDLE]
k.CloseHandle.restype = wintypes.BOOL
k.DeleteFileW.argtypes = [wintypes.LPCWSTR]
k.DeleteFileW.restype = wintypes.BOOL
k.MoveFileExW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
k.MoveFileExW.restype = wintypes.BOOL
k.ReadFile.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                      ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID]
k.ReadFile.restype = wintypes.BOOL
k.WriteFile.argtypes = k.ReadFile.argtypes
k.WriteFile.restype = wintypes.BOOL
k.SetFilePointerEx.argtypes = [wintypes.HANDLE, ctypes.c_longlong,
                              ctypes.POINTER(ctypes.c_longlong), wintypes.DWORD]
k.SetFilePointerEx.restype = wintypes.BOOL
k.GetFileInformationByHandleEx.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                         wintypes.LPVOID, wintypes.DWORD]
k.GetFileInformationByHandleEx.restype = wintypes.BOOL

class StandardInfo(ctypes.Structure):
    _fields_ = [('allocation', ctypes.c_longlong), ('length', ctypes.c_longlong),
                ('links', wintypes.DWORD), ('deletePending', ctypes.c_ubyte),
                ('directory', ctypes.c_ubyte)]

INVALID = ctypes.c_void_p(-1).value
READ = 0x120089  # FILE_GENERIC_READ, as used by the pinned libuv open.
WRITE = 0x40000000
ATTRS = 0x02000080  # BACKUP_SEMANTICS | NORMAL, as used by libuv.
record = {'ownerPid': os.getpid(), 'windows': platform.platform(), 'nodeExecutable': node,
          'scriptSha256': hashlib.sha256(
    Path(__file__).read_bytes()).hexdigest(), 'cases': [], 'children': []}
root = None
handles = []
children = []
native_threads = []

def opened(file, access=READ, share=7):
    handle = k.CreateFileW(str(file), access, share, None, 3, ATTRS, None)
    if handle == INVALID:
        raise ctypes.WinError(ctypes.get_last_error())
    handles.append(handle)
    return handle

def closed(handle):
    if not k.CloseHandle(handle):
        raise ctypes.WinError(ctypes.get_last_error())
    handles.remove(handle)

def native_read(file):
    # Capture raw errors before any other native operation can replace LastError.
    handle = k.CreateFileW(str(file), READ, 7, None, 3, ATTRS, None)
    if handle == INVALID:
        return {'operation': 'open', 'win32': ctypes.get_last_error()}
    try:
        buf, count = ctypes.create_string_buffer(16), wintypes.DWORD()
        if not k.ReadFile(handle, buf, 16, ctypes.byref(count), None):
            return {'operation': 'read', 'win32': ctypes.get_last_error()}
        return {'operation': 'read', 'win32': 0, 'bytes': count.value}
    finally:
        if not k.CloseHandle(handle):
            raise ctypes.WinError(ctypes.get_last_error())

def bump(counts, observation):
    key = observation['operation'] + ':' + str(observation['win32'])
    counts[key] = counts.get(key, 0) + 1

js = r'''
const fs = require('node:fs');
const [file, ready, count, owner] = process.argv.slice(1);
const counts = {}, errors = [];
function observe(operation, fn) {
  try { fn(); const key = operation + ':OK'; counts[key] = (counts[key] || 0) + 1; }
  catch (e) {
    const key = operation + ':' + e.code; counts[key] = (counts[key] || 0) + 1;
    if (!errors.some(x => x.operation === operation && x.code === e.code))
      errors.push({operation, code:e.code, errno:e.errno, syscall:e.syscall, path:e.path, stack:e.stack});
  }
}
observe('preflight-lstat', () => fs.lstatSync(file));
if (counts['preflight-lstat:OK'] !== 1) {
  console.error(JSON.stringify({preflightFailed:true, counts, errors}));
  process.exit(1);
}
fs.writeFileSync(ready, 'ready');
if (fs.readSync(0, Buffer.alloc(1), 0, 1, null) !== 1) throw new Error('Missing start byte');
const started = Date.now();
for (let i = 0; i < Number(count); i++) {
  observe('lstat', () => fs.lstatSync(file));
  observe('open/read', () => {
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, Buffer.alloc(16), 0, 16, 0); } finally { fs.closeSync(fd); }
  });
  observe('readFileSync', () => fs.readFileSync(file, 'utf8'));
}
let ownerAlive = false;
try { process.kill(Number(owner), 0); ownerAlive = true; } catch {}
console.log(JSON.stringify({node:process.version, uv:process.versions.uv, pid:process.pid, ownerAlive,
  started, ended:Date.now(), count:Number(count), counts, errors}));
'''

def observe_case(label, setup=None, mutation=None, teardown=None):
    folder = root / label
    folder.mkdir()
    ticket = folder / 'ticket'
    ticket.write_bytes(b'1\n')
    row = {'case': label, 'ticket': str(ticket), 'nativeBefore': native_read(ticket)}
    record['cases'].append(row)
    ready = folder / 'ready'
    count = 1000 if mutation else 2
    child = subprocess.Popen([node, '-e', js, str(ticket), str(ready), str(count), str(os.getpid())],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE)
    children.append(child)
    receipt = {'pid': child.pid, 'case': label}
    record['children'].append(receipt)
    observer = None
    try:
        deadline = time.monotonic() + 15
        while not ready.exists():
            if child.poll() is not None:
                raise RuntimeError('Node exited before its real preflight stat')
            if time.monotonic() >= deadline:
                raise TimeoutError('Node preflight readiness')
            time.sleep(0.01)
        if setup:
            setup(ticket, row)
        row['nativeStable'] = native_read(ticket)
        row['nativeNamespaced'] = native_read('\\\\?\\' + str(ticket))
        child.stdin.write(b'g')
        child.stdin.flush()
        row['nativeDuring'] = {}
        if mutation:
            def sample_native():
                row['nativeStarted'] = time.time_ns() // 1_000_000
                try:
                    for i in range(count):
                        bump(row['nativeDuring'], native_read(ticket))
                except BaseException as error:
                    row['nativeError'] = type(error).__name__ + ': ' + str(error)
                finally:
                    row['nativeEnded'] = time.time_ns() // 1_000_000
            observer = threading.Thread(target=sample_native, daemon=True)
            native_threads.append(observer)
            observer.start()
            row['mutationStarted'] = time.time_ns() // 1_000_000
            try:
                for i in range(count):
                    mutation(ticket, row, i)
            finally:
                row['mutationEnded'] = time.time_ns() // 1_000_000
                observer.join(timeout=15)
            if observer.is_alive() or 'nativeError' in row:
                raise RuntimeError('Native observation failed or did not settle')
        else:
            row['mutationStarted'] = time.time_ns() // 1_000_000
            row['mutationEnded'] = time.time_ns() // 1_000_000
        out, err = child.communicate(timeout=15)
        row['nodeStdout'] = out.decode(errors='replace')
        row['nodeStderr'] = err.decode(errors='replace')
        row['node'] = json.loads(out)
        if child.returncode != 0:
            raise RuntimeError('Node exit ' + str(child.returncode))
        if row['node']['node'] != 'v24.22.0':
            raise RuntimeError('Unexpected Node runtime')
        if not row['node']['ownerAlive'] or row['node']['counts'].get('preflight-lstat:OK') != 1:
            raise RuntimeError('Missing initial real stat or live parent proof')
        if mutation:
            row['overlapped'] = (row['node']['started'] <= row['mutationEnded'] and
                                 row['node']['ended'] >= row['mutationStarted'])
            if not row['overlapped']:
                raise RuntimeError('Mutation and Node observations did not overlap')
            row['nativeOverlapped'] = (row['nativeStarted'] <= row['mutationEnded'] and
                                       row['nativeEnded'] >= row['mutationStarted'])
            if not row['nativeOverlapped']:
                raise RuntimeError('Mutation and native observations did not overlap')
            if not any(key.endswith(':0') and value > 0
                       for key, value in row['mutationResults'].items()):
                raise RuntimeError('No successful mutation occurred')
        row['complete'] = True
    except BaseException as error:
        row['complete'] = False
        row['error'] = type(error).__name__ + ': ' + str(error)
    finally:
        if child.poll() is None:
            child.kill()
        out, err = child.communicate(timeout=15)
        row['nodeStdout'] = out.decode(errors='replace')
        row['nodeStderr'] = err.decode(errors='replace')
        receipt.update({'exit': child.returncode, 'settled': child.poll() is not None})
        if teardown and row.get('heldHandle') in handles:
            teardown(ticket, row)
        row['nativeAfter'] = native_read(ticket)
        if observer is not None and observer.is_alive():
            raise RuntimeError('Stopping remaining cases: native observer remains live')

def pending(ticket, row):
    handle = opened(ticket)
    row['heldHandle'] = handle
    if not k.DeleteFileW(str(ticket)):
        raise ctypes.WinError(ctypes.get_last_error())
    info = StandardInfo()
    if not k.GetFileInformationByHandleEx(handle, 1, ctypes.byref(info), ctypes.sizeof(info)):
        raise ctypes.WinError(ctypes.get_last_error())
    row['kernelDeletePending'] = bool(info.deletePending)
    if not row['kernelDeletePending']:
        raise RuntimeError('Deletion did not become pending')

def hold(share):
    def setup(ticket, row):
        row['share'] = share
        row['heldHandle'] = opened(ticket, READ | WRITE, share)
    return setup

def release(ticket, row):
    closed(row['heldHandle'])

def renamed(ticket, row, i):
    away = ticket.with_name('away')
    for source, target in ((ticket, away), (away, ticket)):
        ok = k.MoveFileExW(str(source), str(target), 0)
        bump(row.setdefault('mutationResults', {}),
             {'operation': 'rename', 'win32': 0 if ok else ctypes.get_last_error()})

def replaced(ticket, row, i):
    other = ticket.with_name('replacement')
    other.write_bytes(str(i).encode())
    ok = k.MoveFileExW(str(other), str(ticket), 1 | 8)
    bump(row.setdefault('mutationResults', {}),
         {'operation': 'replace', 'win32': 0 if ok else ctypes.get_last_error()})

def written(ticket, row, i):
    handle = row['heldHandle']
    if not k.SetFilePointerEx(handle, 0, None, 0):
        raise ctypes.WinError(ctypes.get_last_error())
    payload, count = ctypes.create_string_buffer(b'1\n' if i % 2 else b'2\n'), wintypes.DWORD()
    ok = k.WriteFile(handle, payload, 2, ctypes.byref(count), None)
    bump(row.setdefault('mutationResults', {}),
         {'operation': 'write', 'win32': 0 if ok else ctypes.get_last_error()})

try:
    root = Path(tempfile.mkdtemp(prefix='fictional-ticket-matrix-')).resolve()
    record['root'] = str(root)
    observe_case('control')
    observe_case('delete-pending', setup=pending, teardown=release)
    observe_case('held-no-share-delete', setup=hold(3), teardown=release)
    observe_case('held-no-share-write', setup=hold(5), teardown=release)
    observe_case('rename', mutation=renamed)
    observe_case('replace', mutation=replaced)
    observe_case('write', setup=hold(7), mutation=written, teardown=release)
    record['success'] = len(record['cases']) == 7 and all(
        row.get('complete') for row in record['cases'])
except BaseException as error:
    record['success'] = False
    record['error'] = type(error).__name__ + ': ' + str(error)
finally:
    cleanup = []
    for child, receipt in zip(children, record['children']):
        try:
            if child.poll() is None:
                child.kill()
            out, err = child.communicate(timeout=15)
            receipt.update({'exit': child.returncode, 'settled': child.poll() is not None,
                            'stdout': out.decode(errors='replace'),
                            'stderr': err.decode(errors='replace')})
        except BaseException as error:
            cleanup.append('child: ' + str(error))
    for handle in handles[:]:
        try:
            closed(handle)
        except BaseException as error:
            cleanup.append('handle: ' + str(error))
    try:
        if (all(child.poll() is not None for child in children) and not handles and
                not any(thread.is_alive() for thread in native_threads)):
            if root is not None:
                shutil.rmtree(root)
        record['ownedRemoved'] = root is None or not root.exists()
    except BaseException as error:
        cleanup.append('root: ' + str(error))
    record['cleanupErrors'] = cleanup
    record['allChildrenSettled'] = all(child.poll() is not None for child in children)
    record['allHandlesClosed'] = not handles
    record['allNativeThreadsSettled'] = not any(thread.is_alive() for thread in native_threads)
    record['success'] = bool(record.get('success') and not cleanup and
                             record['ownedRemoved'] and record['allChildrenSettled'] and
                             record['allNativeThreadsSettled'])
    print('WINDOWS_TICKET_MATRIX_TERMINAL ' + json.dumps(record), flush=True)
raise SystemExit(0 if record['success'] else 1)
