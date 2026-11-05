window.__ModuleLoader__.load({
  id: 'dsh-plugin-obsidian-catalog',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    let pluginCtx = null

    const ENDPOINT = '/api/obsidian-catalog'
    const ROOT_LABEL = '（根目录）'
    const POLL_MS = 15000

    const COPY = {
      zh: {
        title: '知识库目录',
        search: '搜索标题 / 路径 / 标签 / 小标题',
        refresh: '重新扫描',
        copy: '复制 @ 路径',
        copied: '已复制',
        empty: '没有匹配的笔记',
        failed: '读取知识库失败',
        notes: '篇',
        folders: '个目录',
        tags: '个标签',
        scanning: '正在扫描…',
        collapseAll: '全部折叠',
        expandAll: '全部展开',
        citeFolder: '引用文件夹',
        chooseVault: '选择仓库',
        pickerTitle: '选择 Obsidian 仓库',
        pickerHint: '点文件夹进入，带 vault 标记的就是 Obsidian 库；也可以直接粘贴路径。',
        pickerPlaceholder: '例如 D:\\Notes\\MyVault',
        useThis: '使用此目录',
        up: '上级目录',
        drives: '驱动器',
        isVault: 'vault',
        noteUnit: '篇',
        saving: '正在保存…',
        cancel: '取消',
      },
      en: {
        title: 'Obsidian Catalog',
        search: 'Search title / path / tag / heading',
        refresh: 'Rescan',
        copy: 'Copy @ path',
        copied: 'Copied',
        empty: 'No matching notes',
        failed: 'Failed to read the vault',
        notes: 'notes',
        folders: 'folders',
        tags: 'tags',
        scanning: 'Scanning…',
        collapseAll: 'Collapse all',
        expandAll: 'Expand all',
        citeFolder: 'Cite folder',
        chooseVault: 'Choose vault',
        pickerTitle: 'Choose an Obsidian vault',
        pickerHint: 'Open folders to browse; a folder marked vault is an Obsidian vault. You can also paste a path.',
        pickerPlaceholder: 'e.g. D:\\Notes\\MyVault',
        useThis: 'Use this folder',
        up: 'Up',
        drives: 'Drives',
        isVault: 'vault',
        noteUnit: 'notes',
        saving: 'Saving…',
        cancel: 'Cancel',
      },
    }

    function localeId(ctx) {
      try {
        const snapshot = ctx.locale.getLocale()
        return String((snapshot && (snapshot.id || snapshot.locale)) || '')
      } catch {
        return ''
      }
    }

    function makeCopy(ctx) {
      let cached = null
      return () => {
        const id = localeId(ctx)
        const key = /^zh/i.test(id) ? 'zh' : 'en'
        if (!cached || cached.key !== key) cached = { key, dict: COPY[key] }
        return cached.dict
      }
    }

    function fmtWords(words) {
      if (words >= 10000) return (words / 10000).toFixed(1) + '万'
      return String(words)
    }

    function fmtDate(ms, dict) {
      const day = 24 * 60 * 60 * 1000
      const now = Date.now()
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      if (ms >= startOfToday.getTime()) return dict === COPY.zh ? '今天' : 'today'
      if (ms >= startOfToday.getTime() - day) return dict === COPY.zh ? '昨天' : 'yesterday'
      const days = Math.floor((now - ms) / day)
      if (days < 30) return dict === COPY.zh ? days + ' 天前' : days + 'd ago'
      const date = new Date(ms)
      return String(date.getMonth() + 1) + '-' + String(date.getDate())
    }

    const ICONS = {
      search: [h('circle', { cx: 11, cy: 11, r: 7, key: 'c' }), h('path', { d: 'M20 20l-3.6-3.6', key: 'l' })],
      refresh: h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6' }),
      chevronRight: h('path', { d: 'M9 18l6-6-6-6' }),
      chevronDown: h('path', { d: 'M6 9l6 6 6-6' }),
      copy: h('path', { d: 'M9 9h10v10H9zM5 15V5h10' }),
      doc: h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6' }),
      folder: h('path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }),
      arrowUp: h('path', { d: 'M12 19V5M5 12l7-7 7 7' }),
      at: h('path', {
        d: 'M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8',
      }),
    }

    function Icon({ name, size = 14, color = '#7b8794' }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: color,
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block', flex: '0 0 auto' },
      }, ICONS[name])
    }

    function groupNotes(notes) {
      const groups = new Map()
      for (const note of notes) {
        const key = note.folder || ''
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(note)
      }
      return Array.from(groups.entries())
        .sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0])))
        .map(([folder, items]) => ({ folder, items }))
    }

    function matches(note, query) {
      if (!query) return true
      const hay = [note.title, note.relPath, note.folder, (note.tags || []).join(' ')]
        .concat((note.headings || []).map((item) => item.text))
        .join(' ')
        .toLowerCase()
      return hay.indexOf(query.toLowerCase()) >= 0
    }

    /**
     * Absolute path of a folder group. The vault root has an empty folder name,
     * and nested names arrive with whatever separator the relPath used.
     */
    function absFolder(vault, folder) {
      const root = String(vault || '').replace(/[\\/]+$/, '')
      if (!folder) return root
      return root + '\\' + String(folder).split(/[\\/]+/).filter(Boolean).join('\\')
    }

    function copyText(text, done) {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done)
        return
      }
      const fallback = () => {
        try {
          const node = document.createElement('textarea')
          node.value = text
          node.style.position = 'fixed'
          node.style.opacity = '0'
          document.body.appendChild(node)
          node.select()
          document.execCommand('copy')
          document.body.removeChild(node)
        } catch (error) { /* clipboard unavailable: the caller still shows the path */ }
        done()
      }
      fallback()
    }

    function NoteRow({ note, dict }) {
      const [open, setOpen] = useState(false)
      const [flash, setFlash] = useState('')
      const timer = useRef(null)

      useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

      const copy = useCallback(() => {
        const text = '@' + note.path
        const done = () => {
          setFlash(dict.copied)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setFlash(''), 1600)
        }
        copyText(text, done)
      }, [note.path, dict])

      const meta = [
        h('span', { key: 'w', style: { color: '#8a95a1' } }, fmtWords(note.words) + ' 字'),
        h('span', { key: 'd', style: { color: '#8a95a1' } }, fmtDate(note.mtime, dict)),
      ].concat((note.tags || []).slice(0, 4).map((tag) => h('span', {
        key: 't-' + tag,
        style: {
          color: '#2f6fd0', background: '#eef4fe', borderRadius: 4,
          padding: '0 5px', fontSize: 11, lineHeight: '17px',
        },
      }, '#' + tag)))

      return h('div', { style: { borderBottom: '1px solid #eef1f4' } },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 8px 14px',
            cursor: 'pointer', background: flash ? '#fff7e0' : 'transparent',
          },
          onClick: () => setOpen(!open),
        },
          note.headings && note.headings.length
            ? h(Icon, { name: open ? 'chevronDown' : 'chevronRight', size: 13 })
            : h('span', { style: { width: 13, flex: '0 0 auto' } }),
          h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            h('div', {
              style: {
                color: '#1f2733', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              },
              title: note.relPath,
            }, note.title),
            h('div', {
              style: {
                display: 'flex', gap: 10, alignItems: 'center', marginTop: 3,
                fontSize: 11, color: '#8a95a1', whiteSpace: 'nowrap', overflow: 'hidden',
              },
            }, meta),
          ),
          flash
            ? h('span', { style: { color: '#1a8f4c', fontSize: 11 } }, flash)
            : h('button', {
              type: 'button',
              title: dict.copy,
              onClick: (event) => { event.stopPropagation(); copy() },
              style: {
                display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #dde3e9',
                background: '#fff', color: '#5a6672', borderRadius: 5, padding: '2px 7px',
                fontSize: 11, cursor: 'pointer', flex: '0 0 auto',
              },
            }, h(Icon, { name: 'copy', size: 11, color: '#5a6672' }), dict.copy),
        ),
        open && note.headings && note.headings.length
          ? h('div', { style: { padding: '2px 12px 8px 35px' } },
            note.headings.map((heading, index) => h('div', {
              key: index,
              style: {
                display: 'flex', gap: 8, alignItems: 'baseline', padding: '1px 0',
                fontSize: 12, color: heading.level === 1 ? '#46525f' : '#6b7885',
                paddingLeft: (Math.min(heading.level, 4) - 1) * 12,
              },
            },
              h('span', { style: { color: '#a9b3be', fontSize: 11, minWidth: 28 } }, String(index + 1)),
              h('span', {
                style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              }, heading.text),
            )),
          )
          : null,
      )
    }

    function VaultPicker({ dict, initial, onDone, onClose }) {
      const [current, setCurrent] = useState(initial || '')
      const [manual, setManual] = useState(initial || '')
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(true)
      const [error, setError] = useState('')

      const go = useCallback(async (target) => {
        setBusy(true)
        setError('')
        try {
          const response = await fetch(ENDPOINT + '/dirs?path=' + encodeURIComponent(target || ''))
          const payload = await response.json()
          if (!response.ok) throw new Error(payload.error || 'HTTP ' + String(response.status))
          setData(payload)
          setCurrent(payload.current || '')
          setManual(payload.current || '')
          if (payload.error) setError(dict.failed + ': ' + payload.error)
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
        }
        setBusy(false)
      }, [dict])

      useEffect(() => { go(initial || '') }, [go, initial])

      const useThis = useCallback(async () => {
        const target = manual.trim()
        if (!target) { setError(dict.pickerPlaceholder); return }
        setBusy(true)
        setError('')
        try {
          const response = await fetch(ENDPOINT + '/vault', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: target }),
          })
          const payload = await response.json()
          if (!response.ok) throw new Error(payload.error || 'HTTP ' + String(response.status))
          onDone(payload.vault)
        } catch (err) {
          setError(String(err && err.message ? err.message : err))
          setBusy(false)
        }
      }, [manual, dict, onDone])

      const entries = data && data.entries ? data.entries : []
      const drives = data && data.drives ? data.drives : []

      const buttonStyle = {
        display: 'flex', alignItems: 'center', gap: 5, border: '1px solid #dde3e9',
        background: '#fff', color: '#4b5763', borderRadius: 6, padding: '4px 9px',
        fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit',
      }

      return h('div', {
        style: {
          position: 'absolute', inset: 0, zIndex: 5, background: '#ffffff',
          display: 'flex', flexDirection: 'column', padding: '14px 16px',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h(Icon, { name: 'doc', size: 15, color: '#2f6fd0' }),
          h('div', { style: { fontSize: 13.5, fontWeight: 600 } }, dict.pickerTitle),
          h('span', {
            onClick: onClose,
            style: { marginLeft: 'auto', cursor: 'pointer', color: '#98a3af', fontSize: 16, lineHeight: 1 },
          }, '×'),
        ),
        h('div', { style: { fontSize: 11, color: '#8a95a1', marginTop: 6 } }, dict.pickerHint),
        h('div', { style: { display: 'flex', gap: 6, marginTop: 10 } },
          h('input', {
            value: manual,
            onChange: (event) => setManual(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') go(manual.trim()) },
            placeholder: dict.pickerPlaceholder,
            style: {
              flex: '1 1 auto', minWidth: 0, border: '1px solid #dfe5eb', borderRadius: 7,
              padding: '6px 9px', fontSize: 12, fontFamily: 'inherit', color: '#1f2733',
              background: '#fafbfc', outline: 'none',
            },
          }),
          h('button', { type: 'button', onClick: () => go(manual.trim()), style: buttonStyle }, 'Go'),
        ),
        h('div', {
          style: {
            flex: '1 1 auto', minHeight: 0, overflow: 'auto', marginTop: 10,
            border: '1px solid #e6ebf0', borderRadius: 8,
          },
        },
          data && current
            ? h('div', {
              onClick: () => go(data && data.parent !== null ? data.parent : ''),
              style: {
                display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
                borderBottom: '1px solid #eef1f4', cursor: 'pointer', fontSize: 12, color: '#5a6672',
                background: '#f7f9fb',
              },
            }, h(Icon, { name: 'arrowUp', size: 12, color: '#8a95a1' }), '.. ' + dict.up)
            : null,
          drives.map((drive) => h('div', {
            key: drive.path,
            onClick: () => go(drive.path),
            style: {
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
              borderBottom: '1px solid #f2f5f8', cursor: 'pointer', fontSize: 12.5,
            },
          }, h(Icon, { name: 'chevronRight', size: 12, color: '#98a3af' }), drive.name)),
          entries.map((entry) => h('div', {
            key: entry.path,
            onClick: () => go(entry.path),
            style: {
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
              borderBottom: '1px solid #f2f5f8', cursor: 'pointer', fontSize: 12.5, color: '#1f2733',
            },
          },
            h(Icon, { name: 'chevronRight', size: 12, color: '#98a3af' }),
            h('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
            entry.isVault
              ? h('span', {
                style: {
                  fontSize: 10.5, color: '#1a8f4c', background: '#eaf7ef', borderRadius: 4,
                  padding: '0 5px', lineHeight: '16px',
                },
              }, dict.isVault)
              : null,
          )),
          busy ? h('div', { style: { padding: 14, fontSize: 11.5, color: '#8a95a1' } }, dict.scanning) : null,
          !busy && !entries.length && !drives.length
            ? h('div', { style: { padding: 14, fontSize: 11.5, color: '#8a95a1' } }, dict.empty)
            : null,
        ),
        error ? h('div', { style: { fontSize: 11, color: '#c0392b', marginTop: 8 } }, error) : null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 } },
          data && data.isVault
            ? h('span', { style: { fontSize: 11, color: '#1a8f4c' } },
              'vault · ' + String(data.noteCount || 0) + ' ' + dict.noteUnit)
            : h('span', { style: { fontSize: 11, color: '#98a3af' } }, dict.pickerHint),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 8 } },
            h('button', { type: 'button', onClick: onClose, style: buttonStyle }, dict.cancel),
            h('button', {
              type: 'button',
              onClick: useThis,
              disabled: busy,
              style: Object.assign({}, buttonStyle, {
                background: '#2f6fd0', borderColor: '#2f6fd0', color: '#fff', opacity: busy ? 0.6 : 1,
              }),
            }, busy ? dict.saving : dict.useThis),
          ),
        ),
      )
    }

    function CatalogView() {
      const t = React.useRef(null)
      if (!t.current) t.current = makeCopy(pluginCtx)
      const dict = t.current()
      const [state, setState] = useState({ loading: true, error: '', notes: [], vault: '', scannedAt: 0 })
      const [query, setQuery] = useState('')
      const [collapsed, setCollapsed] = useState({})
      const [picker, setPicker] = useState(false)
      const [folderFlash, setFolderFlash] = useState({})
      const flashTimers = useRef({})

      useEffect(() => () => {
        Object.keys(flashTimers.current).forEach((key) => clearTimeout(flashTimers.current[key]))
      }, [])

      const load = useCallback(async () => {
        try {
          const response = await fetch(ENDPOINT + '?t=' + String(Date.now()), { headers: { Accept: 'application/json' } })
          if (!response.ok) throw new Error('HTTP ' + String(response.status))
          const data = await response.json()
          setState({ loading: false, error: '', notes: data.notes || [], vault: data.vault || '', scannedAt: data.scannedAt || 0 })
        } catch (error) {
          setState((prev) => ({ ...prev, loading: false, error: String(error && error.message ? error.message : error) }))
        }
      }, [])

      useEffect(() => { load() }, [load])

      useEffect(() => {
        const id = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          load()
        }, POLL_MS)
        return () => clearInterval(id)
      }, [load])

      const notes = state.notes
      const searching = Boolean(query.trim())
      const filtered = useMemo(() => notes.filter((note) => matches(note, query.trim())), [notes, query])
      const groups = useMemo(() => groupNotes(filtered), [filtered])
      const totalWords = useMemo(() => notes.reduce((sum, note) => sum + (note.words || 0), 0), [notes])
      const folderCount = useMemo(() => new Set(notes.map((note) => note.folder || '')).size, [notes])
      const tagCount = useMemo(() => {
        const set = new Set()
        notes.forEach((note) => (note.tags || []).forEach((tag) => set.add(tag)))
        return set.size
      }, [notes])

      const toggleFolder = useCallback((folder) => {
        setCollapsed((prev) => Object.assign({}, prev, { [folder]: !prev[folder] }))
      }, [])

      const collapseAll = useCallback(() => {
        const next = {}
        groups.forEach((group) => { next[group.folder] = true })
        setCollapsed(next)
      }, [groups])

      const expandAll = useCallback(() => { setCollapsed({}) }, [])

      const citeGroup = useCallback((folder) => {
        const text = '@' + absFolder(state.vault, folder)
        const done = () => {
          setFolderFlash((prev) => Object.assign({}, prev, { [folder]: dict.copied }))
          if (flashTimers.current[folder]) clearTimeout(flashTimers.current[folder])
          flashTimers.current[folder] = setTimeout(() => {
            setFolderFlash((prev) => {
              const next = Object.assign({}, prev)
              delete next[folder]
              return next
            })
          }, 1600)
        }
        copyText(text, done)
      }, [state.vault, dict])

      const stats = [
        '共 ' + String(notes.length) + ' ' + dict.notes,
        fmtWords(totalWords) + '字',
        String(folderCount) + ' ' + dict.folders,
        String(tagCount) + ' ' + dict.tags,
      ].join(' · ')

      const smallButton = {
        display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #dde3e9',
        background: '#fff', color: '#4b5763', borderRadius: 6, padding: '3px 8px',
        fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
      }

      return h('div', {
        style: {
          position: 'relative', height: '100%', width: '100%', display: 'flex', flexDirection: 'column',
          background: '#ffffff', color: '#1f2733', overflow: 'hidden',
        },
      },
        h('div', {
          style: {
            flex: '0 0 auto', padding: '14px 16px 10px', borderBottom: '1px solid #e6ebf0',
            background: '#ffffff',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h(Icon, { name: 'doc', size: 16, color: '#2f6fd0' }),
            h('div', { style: { fontSize: 14, fontWeight: 600 } }, dict.title),
            h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 } },
              h('button', {
                type: 'button',
                title: state.vault || '',
                onClick: () => setPicker(true),
                style: smallButton,
              }, h(Icon, { name: 'folder', size: 12 }), dict.chooseVault),
              h('button', {
                type: 'button',
                title: dict.refresh,
                onClick: load,
                style: smallButton,
              }, h(Icon, { name: 'refresh', size: 12 }), dict.refresh),
            ),
          ),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 } },
            h('span', {
              style: {
                fontSize: 11, color: '#8a95a1', overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', maxWidth: 260,
              },
              title: state.vault || '',
            }, stats),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 8 } },
              h('span', { onClick: collapseAll, style: { fontSize: 11, color: '#2f6fd0', cursor: 'pointer' } }, dict.collapseAll),
              h('span', { onClick: expandAll, style: { fontSize: 11, color: '#2f6fd0', cursor: 'pointer' } }, dict.expandAll),
            ),
          ),
          state.error
            ? h('div', { style: { fontSize: 11, color: '#c0392b', marginTop: 6 } }, dict.failed + ': ' + state.error)
            : null,
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
              border: '1px solid #dfe5eb', borderRadius: 8, padding: '6px 10px', background: '#fafbfc',
            },
          },
            h(Icon, { name: 'search', size: 13, color: '#98a3af' }),
            h('input', {
              value: query,
              onChange: (event) => setQuery(event.target.value),
              placeholder: dict.search,
              style: {
                flex: '1 1 auto', border: 'none', outline: 'none', background: 'transparent',
                fontSize: 12.5, color: '#1f2733', fontFamily: 'inherit',
              },
            }),
            query
              ? h('span', {
                onClick: () => setQuery(''),
                style: { color: '#9aa5b1', cursor: 'pointer', fontSize: 12 },
              }, '×')
              : null,
          ),
        ),
        h('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', background: '#ffffff' } },
          state.loading && !notes.length
            ? h('div', { style: { padding: 20, fontSize: 12, color: '#8a95a1' } }, dict.scanning)
            : null,
          groups.map((group) => {
            const open = searching ? true : !collapsed[group.folder]
            return h('div', { key: 'g-' + group.folder },
              h('div', {
                onClick: () => toggleFolder(group.folder),
                style: {
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 6px',
                  background: '#f7f9fb', borderTop: '1px solid #eef1f4', borderBottom: '1px solid #eef1f4',
                  position: 'sticky', top: 0, zIndex: 1, cursor: 'pointer', userSelect: 'none',
                },
              },
                h(Icon, { name: open ? 'chevronDown' : 'chevronRight', size: 12, color: '#7b8794' }),
                h('span', { style: { fontSize: 12, fontWeight: 600, color: '#46525f' } },
                  group.folder === '' ? ROOT_LABEL : group.folder),
                h('span', { style: { fontSize: 11, color: '#9aa5b1' } }, String(group.items.length)),
                h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 } },
                  folderFlash[group.folder]
                    ? h('span', { style: { color: '#1a8f4c', fontSize: 11 } }, folderFlash[group.folder])
                    : h('button', {
                      type: 'button',
                      title: dict.citeFolder + '  @' + absFolder(state.vault, group.folder),
                      onClick: (event) => { event.stopPropagation(); citeGroup(group.folder) },
                      style: {
                        display: 'flex', alignItems: 'center', gap: 3, border: '1px solid #dde3e9',
                        background: '#fff', color: '#5a6672', borderRadius: 5, padding: '1px 6px',
                        fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                      },
                    }, h(Icon, { name: 'at', size: 10, color: '#5a6672' }), dict.citeFolder),
                ),
              ),
              open ? group.items.map((note) => h(NoteRow, { key: note.path, note, dict })) : null,
            )
          }),
          !state.loading && !filtered.length
            ? h('div', { style: { padding: 20, fontSize: 12, color: '#8a95a1' } }, dict.empty)
            : null,
        ),
        picker
          ? h(VaultPicker, {
            dict,
            initial: state.vault,
            onClose: () => setPicker(false),
            onDone: () => { setPicker(false); setCollapsed({}); load() },
          })
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        pluginCtx = ctx
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'obsidian-catalog',
          order: 40,
          label: () => makeCopy(ctx)().title,
        }, CatalogView))
      },
    }
  },
})
