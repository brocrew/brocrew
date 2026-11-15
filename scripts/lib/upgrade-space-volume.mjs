import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requireEvidence } from './upgrade-path.mjs'

const quotePS = (value) => `'${value.replaceAll("'", "''")}'`
const command = (program, args, options = {}) => {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
    ...options,
  })
  requireEvidence(
    !result.error && result.status === 0,
    `${program} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`,
  )
  return result.stdout
}
const powershell = (body) =>
  command('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$ErrorActionPreference='Stop'; ${body}`,
  ])
const plist = (text) =>
  JSON.parse(command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: text }))

/** One disposable bounded filesystem, using the hosted OS's existing disk-image tools. */
export function createSafetyVolume(os, keep) {
  const backing = statfsSync(tmpdir())
  requireEvidence(
    Number(backing.bavail) * Number(backing.bsize) >= 17 * 1024 ** 3,
    'The native safety volume needs its image budget plus15GiB backing headroom.',
  )
  const root = mkdtempSync(join(tmpdir(), 'upgrade-space-'))
  const mount = join(root, 'mount')
  const image = join(root, os === 'mac' ? 'space.dmg' : 'space.vhd')
  mkdirSync(mount)
  const record = {
    os,
    root,
    mount,
    image,
    requestedBytes: 768 * 1024 ** 2,
    attached: false,
    detached: false,
    imageDeleted: false,
  }
  const save = () => keep('safety-volume.json', record)
  save()
  let device
  try {
    if (os === 'mac') {
      command('/usr/bin/hdiutil', [
        'create',
        '-size',
        '768m',
        '-fs',
        'APFS',
        '-type',
        'UDIF',
        '-volname',
        'BroCrewSafety',
        image,
      ])
      const attached = plist(
        command('/usr/bin/hdiutil', ['attach', '-nobrowse', '-mountpoint', mount, '-plist', image]),
      )
      const mounted = attached['system-entities']?.find((entry) => entry['mount-point'] === mount)
      requireEvidence(
        typeof mounted?.['dev-entry'] === 'string',
        'The owned disk image did not mount at its requested path.',
      )
      device = mounted['dev-entry']
      const info = plist(command('/usr/sbin/diskutil', ['info', '-plist', mount]))
      requireEvidence(
        info.MountPoint === mount && info.DeviceNode === device && info.FilesystemType === 'apfs',
        'The mounted APFS volume identity does not match the attach receipt.',
      )
      record.identity = { device, mounted, info }
    } else {
      requireEvidence(
        !image.includes('"') && !mount.includes('"'),
        'Diskpart cannot represent this temporary path.',
      )
      const script = join(root, 'volume.txt')
      writeFileSync(
        script,
        `create vdisk file="${image}" maximum=768 type=fixed\nselect vdisk file="${image}"\nattach vdisk\ncreate partition primary\nformat fs=ntfs quick label=BroCrewSafety\nassign mount="${mount + String.fromCharCode(92)}"\n`,
      )
      record.diskpart = command('diskpart.exe', ['/s', script])
      const identity = JSON.parse(
        powershell(
          `$i=Get-DiskImage -ImagePath ${quotePS(image)}; $d=$i|Get-Disk; $expected=${quotePS(mount)}+[char]92; $p=@($d|Get-Partition|Where-Object { $_.AccessPaths -contains $expected }); if(-not $i.Attached -or $p.Count -ne 1){throw 'Owned VHD association is missing'}; $v=$p[0]|Get-Volume; if($v.FileSystem -ne 'NTFS'){throw 'Owned volume is not NTFS'}; @{image=$i.ImagePath;device=$i.DevicePath;disk=$d.Number;paths=@($p[0].AccessPaths);filesystem=$v.FileSystem}|ConvertTo-Json -Compress`,
        ),
      )
      requireEvidence(
        identity.image.toLowerCase() === image.toLowerCase(),
        'The VHD identity names another image.',
      )
      record.identity = identity
    }
    record.attached = true
    record.freeAtAttach = freeBytes(mount)
    save()
  } catch (error) {
    record.error = error.message
    save()
    throw new Error(`${error.message}; retain owned volume resources at ${root}`, { cause: error })
  }
  return {
    root: mount,
    record,
    free: () => freeBytes(mount),
    dispose() {
      try {
        if (os === 'mac') {
          command('/usr/bin/hdiutil', ['detach', device])
          const info = plist(command('/usr/bin/hdiutil', ['info', '-plist']))
          requireEvidence(
            !(info.images ?? []).some((entry) => entry['image-path'] === image),
            'The owned image remains attached.',
          )
        } else {
          powershell(
            `Dismount-DiskImage -ImagePath ${quotePS(image)}; if((Get-DiskImage -ImagePath ${quotePS(image)}).Attached){throw 'Owned VHD remains attached'}`,
          )
        }
        record.detached = true
        save()
        let entries
        try {
          entries = readdirSync(mount)
          record.mountAfterDetach = 'present'
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
          entries = []
          record.mountAfterDetach = 'absent'
        }
        requireEvidence(
          entries.length === 0,
          'The volume mount directory is not empty after detach.',
        )
        rmSync(image)
        record.imageDeleted = !existsSync(image)
        record.freeAfterDelete = freeBytes(tmpdir())
        save()
        rmSync(root, { recursive: true })
      } catch (error) {
        record.cleanupError = error.message
        save()
        throw new Error(`${error.message}; retain owned resources at ${root}`, { cause: error })
      }
    },
  }
}

function freeBytes(folder) {
  const fs = statfsSync(folder)
  return Number(fs.bavail) * Number(fs.bsize)
}
