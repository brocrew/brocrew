"""Fictional Windows file-lifetime diagnostic; never opens a Chrome profile."""
import ctypes
import base64
import uuid
from ctypes import wintypes
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

assert sys.platform == 'win32'
node = sys.argv[1]
lock_module = str(Path(sys.argv[2]).resolve())
expected_pending = sys.argv[3]
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
    wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
kernel.CreateFileW.restype = wintypes.HANDLE
kernel.DeleteFileW.argtypes = [wintypes.LPCWSTR]
kernel.DeleteFileW.restype = wintypes.BOOL
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.CloseHandle.restype = wintypes.BOOL

class FileStandardInfo(ctypes.Structure):
    _fields_ = [('allocationSize', ctypes.c_longlong), ('endOfFile', ctypes.c_longlong),
        ('numberOfLinks', wintypes.DWORD), ('deletePending', ctypes.c_ubyte),
        ('directory', ctypes.c_ubyte)]

kernel.GetFileInformationByHandleEx.argtypes = [wintypes.HANDLE, ctypes.c_int,
    wintypes.LPVOID, wintypes.DWORD]
kernel.GetFileInformationByHandleEx.restype = wintypes.BOOL
kernel.GetCurrentProcess.restype = wintypes.HANDLE
kernel.GetProcessTimes.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME)]
kernel.GetProcessTimes.restype = wintypes.BOOL
creation, exited, kernel_time, user_time = (wintypes.FILETIME() for _ in range(4))
if not kernel.GetProcessTimes(kernel.GetCurrentProcess(), ctypes.byref(creation), ctypes.byref(exited), ctypes.byref(kernel_time), ctypes.byref(user_time)):
    raise ctypes.WinError(ctypes.get_last_error())
birth = str((creation.dwHighDateTime << 32) | creation.dwLowDateTime)

read_script = """
const fs = require('node:fs');
const [file, owner] = process.argv.slice(1);
let ownerAlive = false;
try { process.kill(Number(owner), 0); ownerAlive = true; } catch {}
let value;
try { value = {text: fs.readFileSync(file, 'utf8')}; }
catch (e) { value = {code:e.code,errno:e.errno,syscall:e.syscall}; }
console.log(JSON.stringify({ownerAlive,...value}));
"""
root = None
handle = None
record = {'ownerPid': os.getpid(), 'platform': sys.platform, 'ownerBirth': birth, 'expectedPending': expected_pending, 'phases': []}
try:
    root = Path(tempfile.mkdtemp(prefix='fictional-ticket-pending-'))
    encoded_birth = base64.urlsafe_b64encode(birth.encode()).decode().rstrip('=')
    token = str(os.getpid()) + '.' + encoded_birth + '.' + str(uuid.uuid4())
    ticket = root / 'registry.lock' / token / 'ticket'
    ticket.parent.mkdir(parents=True)
    ticket.write_text('1', encoding='utf8')
    def observe(label):
        row = json.loads(subprocess.check_output(
            [node, '-e', read_script, str(ticket), str(os.getpid())], text=True, timeout=15))
        row['phase'] = label
        record['phases'].append(row)
        return row
    before = observe('before-delete')
    assert before.get('text') == '1' and before['ownerAlive'], before
    # OPEN_EXISTING, GENERIC_READ, and all share flags. DeleteFileW marks this still-open
    # file for deletion; the retained handle lets us inspect the kernel's actual flag.
    handle = kernel.CreateFileW(str(ticket), 0x80000000, 7, None, 3, 0x80, None)
    if handle == ctypes.c_void_p(-1).value:
        handle = None
        raise ctypes.WinError(ctypes.get_last_error())
    if not kernel.DeleteFileW(str(ticket)):
        raise ctypes.WinError(ctypes.get_last_error())
    info = FileStandardInfo()
    if not kernel.GetFileInformationByHandleEx(handle, 1, ctypes.byref(info), ctypes.sizeof(info)):
        raise ctypes.WinError(ctypes.get_last_error())
    record['kernelDeletePending'] = bool(info.deletePending)
    pending = observe('delete-pending-handle-open')
    def run_lock(label):
        script = '''
const {pathToFileURL} = require('node:url');
(async () => {
  const [module, root, pid, birth] = process.argv.slice(1);
  const {identity, ownerState, withSharedLock} = await import(pathToFileURL(module).href);
  const observed = ownerState({pid:Number(pid),birth});
  let entered = false, error;
  try { withSharedLock(root, identity(), () => { entered = true; }, 100); }
  catch (e) { error = {code:e.code, syscall:e.syscall, path:e.path, message:e.message, stack:e.stack}; }
  console.log(JSON.stringify({observedOwner:observed,entered,error}));
})().catch(e => { console.error(e); process.exitCode=1; });
'''
        result = json.loads(subprocess.check_output([node, '-e', script, lock_module,
            str(root), str(os.getpid()), birth], text=True, timeout=15))
        result['phase'] = label
        record.setdefault('productionLock', []).append(result)
        return result
    actual = run_lock('delete-pending-owner-alive')
    assert actual['observedOwner'] == 'alive' and not actual['entered'], actual
    if expected_pending == 'EPERM':
        problem = actual.get('error', {})
        assert problem.get('code') == 'EPERM' and problem.get('syscall') == 'open', actual
        assert os.path.normcase(os.path.normpath(problem.get('path', ''))) == os.path.normcase(os.path.normpath(str(ticket))), actual
        assert 'readFileSync' in problem.get('stack', '') and 'contenders' in problem.get('stack', ''), actual
    elif expected_pending == 'busy':
        assert 'busy' in actual.get('error', {}).get('message', '') and actual.get('error', {}).get('code') != 'EPERM', actual
    else:
        raise ValueError('Expected EPERM or busy')

    assert record['kernelDeletePending'], record
    assert pending['ownerAlive'] and pending.get('code') in ('EPERM', 'EACCES'), pending
    if not kernel.CloseHandle(handle):
        raise ctypes.WinError(ctypes.get_last_error())
    handle = None
    after = observe('last-handle-closed')
    assert after['ownerAlive'] and after.get('code') == 'ENOENT', after
    ticket.parent.rmdir()
    released = run_lock('ticket-folder-removed-owner-still-alive')
    assert released['observedOwner'] == 'alive' and released['entered'] and 'error' not in released, released
    record['success'] = True
except BaseException as error:
    record['success'] = False
    record['error'] = type(error).__name__ + ': ' + str(error)
finally:
    if handle is not None:
        record['handleClosedFinally'] = bool(kernel.CloseHandle(handle))
    try:
        if root is not None:
            shutil.rmtree(root)
        record['ownedRemoved'] = root is None or not root.exists()
    except BaseException as error:
        record['success'] = False
        record['cleanupError'] = str(error)
    print('WINDOWS_PRODUCTION_LOCK_REPRO_TERMINAL ' + json.dumps(record), flush=True)
raise SystemExit(0 if record.get('success') and record.get('ownedRemoved') else 1)
