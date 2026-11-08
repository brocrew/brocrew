import { execFileSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileSeal } from '../release-artifacts.mjs'

const SOURCE_BASE = 'be6055a86ab2243d5aa379b7587979e68da78c7f'
const canonical = ['BroCrew', '343827643+brocrew@users.noreply.github.com']

export function github(repo, root) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid repository')
  const run = (args, options = {}) =>
    execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })
  const api = (path) => {
    try {
      return JSON.parse(run(['api', `repos/${repo}/${path}`]))
    } catch (error) {
      if (path.startsWith('releases/tags/') && /HTTP 404/.test(String(error.stderr))) return null
      throw error
    }
  }
  return {
    api,
    run,
    async download(id, dest, digest) {
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid artifact ID')
      if (!/^sha256:[0-9a-f]{64}$/.test(digest))
        throw new Error('Pinned artifact transport digest required')
      mkdirSync(dest, { recursive: true })
      const archive = join(dest, '..', `${id}.zip`)
      const fd = openSync(archive, 'wx', 0o600)
      try {
        run(['api', `repos/${repo}/actions/artifacts/${id}/zip`], { stdio: ['ignore', fd, 'pipe'] })
      } finally {
        closeSync(fd)
      }
      try {
        if (`sha256:${fileSeal(archive).sha256}` !== digest)
          throw new Error('Downloaded artifact transport digest differs')
        const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
          .trim()
          .split('\n')
        if (
          entries.some(
            (name) =>
              !name ||
              name.startsWith('/') ||
              name.includes('\\') ||
              name.split('/').includes('..'),
          )
        )
          throw new Error('Unsafe artifact archive paths')
        execFileSync('unzip', ['-q', archive, '-d', dest])
      } finally {
        rmSync(archive)
      }
    },
    attest(path, source, ref, runId, attempt) {
      const verified = JSON.parse(
        run([
          'attestation',
          'verify',
          path,
          '--repo',
          repo,
          '--signer-workflow',
          `${repo}/.github/workflows/release.yml`,
          '--source-digest',
          source,
          '--source-ref',
          `refs/tags/${ref}`,
          '--deny-self-hosted-runners',
          '--format',
          'json',
        ]),
      )
      const invocation = `https://github.com/${repo}/actions/runs/${runId}/attempts/${attempt}`
      if (
        !verified.some(
          (row) =>
            row.verificationResult?.statement?.predicate?.runDetails?.metadata?.invocationId ===
            invocation,
        )
      )
        throw new Error('Attestation does not bind the selected workflow attempt')
    },
    source(source, tree) {
      const git = (...args) =>
        execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
      if (!/^[0-9a-f]{40}$/.test(source) || !/^[0-9a-f]{40}$/.test(tree))
        throw new Error('Invalid source pin')
      if (git('rev-parse', 'HEAD') !== source || git('rev-parse', `${source}^{tree}`) !== tree)
        throw new Error('Workflow source/tree differs from tested source')
      git('merge-base', '--is-ancestor', SOURCE_BASE, source)
      for (const commit of git('rev-list', `${SOURCE_BASE}..${source}`)
        .split('\n')
        .filter(Boolean)) {
        if (
          git('show', '-s', '--format=%an%n%ae%n%cn%n%ce', commit) !==
          [...canonical, ...canonical].join('\n')
        )
          throw new Error('Noncanonical source author or committer')
      }
    },
  }
}

export function checkedRun(client, id, attempt, source, workflow) {
  if (![id, attempt].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new Error('Invalid run/attempt')
  const run = client.api(`actions/runs/${id}/attempts/${attempt}`)
  if (
    run.id !== id ||
    run.run_attempt !== attempt ||
    run.repository?.full_name !== process.env.GITHUB_REPOSITORY ||
    run.head_sha !== source ||
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    run.path !== `.github/workflows/${workflow}`
  )
    throw new Error('The selected workflow attempt did not pass on the tested source')
  return run
}

export function checkedArtifact(client, reference, runId, source) {
  if (
    !Number.isSafeInteger(reference.artifactId) ||
    reference.artifactId <= 0 ||
    !/^sha256:[0-9a-f]{64}$/.test(reference.digest)
  )
    throw new Error('Pinned artifact ID and digest required')
  const artifact = client.api(`actions/artifacts/${reference.artifactId}`)
  if (
    artifact.id !== reference.artifactId ||
    artifact.expired ||
    artifact.digest !== reference.digest ||
    artifact.workflow_run?.id !== runId ||
    artifact.workflow_run?.head_sha !== source
  )
    throw new Error('Artifact origin or digest differs')
  return artifact
}

export function checkedTag(client, name, source, object = null) {
  if (!/^v\d+\.\d+\.\d+(-candidate\.[1-9]\d*)?$/.test(name)) throw new Error('Invalid tag')
  const ref = client.api(`git/ref/tags/${name}`)
  if (ref.object.type !== 'tag' || (object && ref.object.sha !== object))
    throw new Error('An unchanged annotated tag is required')
  const tag = client.api(`git/tags/${ref.object.sha}`)
  if (
    tag.object.type !== 'commit' ||
    tag.object.sha !== source ||
    tag.tagger.name !== canonical[0] ||
    tag.tagger.email !== canonical[1]
  )
    throw new Error('Tag target or canonical tagger differs')
  return ref.object.sha
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
