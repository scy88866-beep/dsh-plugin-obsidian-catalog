import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The catalog only needs to read the vault; the Web GUI fetches its JSON. */
export const inject = ['webServer']

const ROUTE_SNAPSHOT = '/api/obsidian-catalog'
const ROUTE_DIRS = '/api/obsidian-catalog/dirs'
const ROUTE_VAULT = '/api/obsidian-catalog/vault'
const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', '.github', 'node_modules'])

const DEFAULT_VAULT = path.join(os.homedir(), 'obsidian')
const CONFIG_PATH = path.join(os.homedir(), '.dsh', 'obsidian-catalog.json')

/** mtime+size keyed cache: an unchanged note is never re-parsed. */
const noteCache = new Map()
let selectedVault = null

function countWords(text) {
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
  const latin = (text.match(/[A-Za-z][A-Za-z0-9'’\-]*/g) || []).length
  return cjk + latin
}

function normSpace(value) {
  return String(value == null ? '' : value).replace(/[\u00a0\u3000]/g, ' ').replace(/\s+/g, ' ').trim()
}

function splitFrontmatter(lines) {
  const meta = {}
  if (!lines.length || lines[0].trim() !== '---') return { meta, start: 0 }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break }
  }
  if (end < 0) return { meta, start: 0 }
  let listKey = null
  for (let i = 1; i < end; i++) {
    const raw = lines[i]
    const listItem = raw.match(/^\s*-\s+(.*)$/)
    if (listItem && listKey) {
      meta[listKey] = (meta[listKey] || []).concat(normSpace(listItem[1]))
      continue
    }
    const kv = raw.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/)
    if (!kv) continue
    const key = kv[1]
    const value = kv[2].trim()
    listKey = null
    if (!value) { meta[key] = []; listKey = key; continue }
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map((part) => normSpace(part.replace(/^["']|["']$/g, ''))).filter(Boolean)
      continue
    }
    meta[key] = normSpace(value.replace(/^["']|["']$/g, ''))
  }
  return { meta, start: end + 1 }
}

function parseNote(text, relPath) {
  const lines = text.split(/\r?\n/)
  const { meta, start } = splitFrontmatter(lines)
  const headings = []
  let fence = null
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    const fenceMatch = line.match(/^\s{0,3}(```+|~~~+)/)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0]
      else if (fenceMatch[1][0] === fence) fence = null
      continue
    }
    if (fence) continue
    const heading = line.match(/^(#{1,6})\s+(.*\S)\s*#*\s*$/)
    if (!heading) continue
    headings.push({ level: heading[1].length, text: normSpace(heading[2]), line: i })
  }

  const tags = []
  const pushTag = (value) => {
    const tag = normSpace(value).replace(/^#/, '')
    if (tag && !tags.includes(tag)) tags.push(tag)
  }
  if (Array.isArray(meta.tags)) meta.tags.forEach(pushTag)
  else if (meta.tags) String(meta.tags).split(/[,\s]+/).forEach(pushTag)
  if (meta.tag) String(meta.tag).split(/[,\s]+/).forEach(pushTag)

  const base = path.basename(relPath).replace(/\.md$/i, '')
  const title = normSpace(meta.title) || base
  const folder = path.dirname(relPath) === '.' ? '' : path.dirname(relPath).split(path.sep).join('/')

  // Same shape the Obsidian plugin shows: levels 1-3, without a heading that only repeats the note title.
  const visibleHeadings = headings
    .filter((heading) => heading.level <= 3)
    .filter((heading) => heading.text !== title && heading.text !== base)

  return {
    title,
    folder,
    tags,
    headings: visibleHeadings,
    words: countWords(text),
  }
}

async function collectMarkdown(dir, files, depth) {
  if (depth > 12 || files.length >= 5000) return
  let entries
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await collectMarkdown(full, files, depth + 1)
      continue
    }
    if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(full)
  }
}

async function scanVault(vault) {
  const files = []
  await collectMarkdown(vault, files, 0)
  const notes = []
  for (const full of files) {
    let stat
    try {
      stat = await fsp.stat(full)
    } catch {
      continue
    }
    const relPath = path.relative(vault, full)
    const key = String(stat.mtimeMs) + ':' + String(stat.size)
    const cached = noteCache.get(full)
    let parsed = cached && cached.key === key ? cached.parsed : null
    if (!parsed) {
      try {
        const text = await fsp.readFile(full, 'utf8')
        parsed = parseNote(text, relPath)
      } catch {
        parsed = { title: path.basename(full).replace(/\.md$/i, ''), folder: path.dirname(relPath), tags: [], headings: [], words: 0 }
      }
      noteCache.set(full, { key, parsed })
    }
    notes.push({
      path: full,
      relPath,
      title: parsed.title,
      folder: parsed.folder,
      tags: parsed.tags,
      headings: parsed.headings,
      words: parsed.words,
      mtime: Math.round(stat.mtimeMs),
      size: stat.size,
    })
  }
  notes.sort((a, b) => b.mtime - a.mtime)
  return notes
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

function withErrors(fn) {
  return async (req, res) => {
    try {
      await fn(req, res)
    } catch (error) {
      sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
    }
  }
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  return JSON.parse(text)
}

async function exists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

async function isDirectory(target) {
  try {
    const stat = await fsp.stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function currentVault() {
  if (selectedVault) return selectedVault
  try {
    const raw = await fsp.readFile(CONFIG_PATH, 'utf8')
    const data = JSON.parse(raw)
    if (data && typeof data.vault === 'string' && data.vault) {
      selectedVault = data.vault
      return selectedVault
    }
  } catch {
    // No saved choice yet.
  }
  selectedVault = process.env.DSH_OBSIDIAN_VAULT || DEFAULT_VAULT
  return selectedVault
}

async function rememberVault(vault) {
  await fsp.mkdir(path.dirname(CONFIG_PATH), { recursive: true })
  await fsp.writeFile(CONFIG_PATH, JSON.stringify({ vault }, null, 2), 'utf8')
  selectedVault = vault
  noteCache.clear()
}

async function listDrives() {
  const drives = []
  for (let code = 65; code <= 90; code++) {
    const root = String.fromCharCode(code) + ':\\'
    if (await exists(root)) drives.push({ name: root.slice(0, 2), path: root })
  }
  return drives
}

async function listDirectories(target) {
  if (!target) {
    return { current: '', parent: null, drives: await listDrives(), entries: [], isVault: false, noteCount: 0 }
  }
  const current = path.resolve(target)
  if (!(await isDirectory(current))) {
    return { current, parent: null, drives: [], entries: [], isVault: false, noteCount: 0, error: 'not-a-directory' }
  }
  const entries = []
  try {
    const dirents = await fsp.readdir(current, { withFileTypes: true })
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue
      if (dirent.name.startsWith('.')) continue
      const full = path.join(current, dirent.name)
      entries.push({ name: dirent.name, path: full, isVault: await exists(path.join(full, '.obsidian')) })
    }
  } catch {
    // Unreadable directory: show it empty instead of failing the whole picker.
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  const parentDir = path.dirname(current)
  const isVault = await exists(path.join(current, '.obsidian'))
  return {
    current,
    parent: parentDir === current ? '' : parentDir,
    drives: [],
    entries,
    isVault,
    // Only a vault is worth walking: counting a random folder could be a whole disk.
    noteCount: isVault ? await countNotes(current) : 0,
  }
}

async function countNotes(dir) {
  const files = []
  await collectMarkdown(dir, files, 0)
  return files.length
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_SNAPSHOT,
    handler: withErrors(async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      const vault = await currentVault()
      const notes = await scanVault(vault)
      sendJson(res, 200, {
        vault,
        scannedAt: Date.now(),
        version: String(notes.length) + '-' + String(notes.reduce((sum, note) => sum + note.mtime, 0)),
        notes,
      })
    }),
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_DIRS,
    handler: withErrors(async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      const query = new URL(req.url || '/', 'http://localhost').searchParams
      const wanted = query.get('path')
      const target = wanted === null ? await currentVault() : wanted
      sendJson(res, 200, await listDirectories(target))
    }),
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_VAULT,
    handler: withErrors(async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      const body = await readJsonBody(req)
      const target = typeof body.path === 'string' ? body.path.trim() : ''
      if (!target) {
        sendJson(res, 400, { error: '路径为空' })
        return
      }
      const resolved = path.resolve(target)
      if (!(await isDirectory(resolved))) {
        sendJson(res, 400, { error: '目录不存在：' + resolved })
        return
      }
      const notes = await scanVault(resolved)
      await rememberVault(resolved)
      sendJson(res, 200, { ok: true, vault: resolved, notes: notes.length })
    }),
  }))
}
