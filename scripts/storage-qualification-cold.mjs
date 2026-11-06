import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, statSync } from 'node:fs'

// Only pages of this run's closed, private clone are evicted. No global cache operation.
export function coldMainFile(file) {
  assert.equal(process.platform, 'linux')
  const identity = lstatSync(file)
  assert(identity.isFile() && !identity.isSymbolicLink() && identity.nlink === 1)
  assert.equal(identity.uid, process.getuid())
  const sidecars = ['-wal', '-shm', '-journal'].map((suffix) => ({
    suffix,
    present: existsSync(file + suffix),
    bytes: existsSync(file + suffix) ? statSync(file + suffix).size : 0,
  }))
  assert(
    sidecars.every((one) => one.bytes === 0),
    'closed clone must have no nonempty sidecar',
  )
  const cold = JSON.parse(
    execFileSync(
      'python3',
      [
        '-c',
        `
import ctypes,json,os,sys
fd=os.open(sys.argv[1],os.O_RDONLY)
try:
 size=os.fstat(fd).st_size
 os.fsync(fd)
 os.posix_fadvise(fd,0,0,os.POSIX_FADV_DONTNEED)
 lib=ctypes.CDLL(None,use_errno=True)
 lib.mmap.restype=ctypes.c_void_p
 address=lib.mmap(None,ctypes.c_size_t(size),1,1,fd,0)
 if address==ctypes.c_void_p(-1).value: raise OSError(ctypes.get_errno(),'mmap')
 try:
  pages=(size+os.sysconf('SC_PAGE_SIZE')-1)//os.sysconf('SC_PAGE_SIZE')
  vector=(ctypes.c_ubyte*pages)()
  if lib.mincore(ctypes.c_void_p(address),ctypes.c_size_t(size),vector): raise OSError(ctypes.get_errno(),'mincore')
  print(json.dumps({'bytes':size,'pages':pages,'residentPagesBeforeOpen':sum(v&1 for v in vector)}))
 finally:
  if lib.munmap(ctypes.c_void_p(address),ctypes.c_size_t(size)): raise OSError(ctypes.get_errno(),'munmap')
finally: os.close(fd)
`,
        file,
      ],
      { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 },
    ),
  )
  assert.equal(cold.residentPagesBeforeOpen, 0)
  return {
    ...cold,
    method: 'fsync + per-file POSIX_FADV_DONTNEED + mincore',
    identity: { device: identity.dev, inode: identity.ino, bytes: identity.size },
    sidecars,
    scope: 'main DB file OS pages at pre-open instant; no hardware or kernel metadata cache claim',
    at: new Date().toISOString(),
  }
}
