import { useState, useEffect, useRef } from 'react'
import { getCorpusFiles, startBatch, getBatchStatus, stopBatch } from '../services/api'

export default function BatchPanel({ onBack }) {
  const [files, setFiles] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [status, setStatus] = useState(null)   // null | batch_state object
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    getCorpusFiles()
      .then(d => {
        setFiles(d.files)
        setSelected(new Set(d.files))  // mặc định chọn hết
      })
      .catch(() => setError('Không thể load danh sách corpus'))
    return () => clearPoll()
  }, [])

  const clearPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const startPoll = () => {
    clearPoll()
    pollRef.current = setInterval(async () => {
      const s = await getBatchStatus()
      setStatus(s)
      if (!s.running) clearPoll()
    }, 1500)
  }

  const handleStart = async () => {
    setError(null)
    const fileList = selected.size === files.length ? null : [...selected]
    try {
      await startBatch(fileList)
      const s = await getBatchStatus()
      setStatus(s)
      startPoll()
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    }
  }

  const handleStop = async () => {
    await stopBatch()
    clearPoll()
    const s = await getBatchStatus()
    setStatus(s)
  }

  const toggleFile = (f) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(f) ? next.delete(f) : next.add(f)
      return next
    })
  }

  const toggleAll = () => {
    setSelected(selected.size === files.length ? new Set() : new Set(files))
  }

  const running = status?.running
  const done = status?.done ?? 0
  const total = status?.total ?? selected.size
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const finished = status && !running && done > 0

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <button style={s.backBtn} onClick={onBack} disabled={running}>← Quay lại</button>
        <h2 style={s.title}>Batch Mode — Corpus ({files.length} file)</h2>
      </div>

      {error && <div style={s.errorBox}>{error}</div>}

      {finished && (
        <div style={s.doneBox}>
          Hoàn thành {done}/{total} file
          {status.errors.length > 0 && ` — ${status.errors.length} lỗi`}
        </div>
      )}

      {/* Progress */}
      {status && (running || finished) && (
        <div style={s.progressWrap}>
          <div style={s.progressBar}>
            <div style={{ ...s.progressFill, width: `${pct}%`, background: finished ? '#10b981' : '#6366f1' }} />
          </div>
          <div style={s.progressLabel}>
            {running
              ? `[${done}/${total}] đang xử lý: ${status.current}`
              : `Xong ${done}/${total}`}
          </div>
          {status.errors.length > 0 && (
            <div style={s.errorList}>
              {status.errors.slice(-3).map((e, i) => (
                <div key={i} style={s.errorItem}>⚠ {e.file}: {e.error}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div style={s.controls}>
        {!running && (
          <button style={s.startBtn} onClick={handleStart} disabled={selected.size === 0}>
            Chạy {selected.size} file
          </button>
        )}
        {running && (
          <button style={s.stopBtn} onClick={handleStop}>Dừng</button>
        )}
      </div>

      {/* File list */}
      {!running && (
        <div style={s.fileList}>
          <div style={s.selectAllRow}>
            <label style={s.checkLabel}>
              <input type="checkbox" checked={selected.size === files.length} onChange={toggleAll} />
              Chọn tất cả ({files.length})
            </label>
            <span style={s.hint}>Kết quả lưu vào data/</span>
          </div>
          <div style={s.fileScroll}>
            {files.map(f => (
              <label key={f} style={s.fileRow}>
                <input type="checkbox" checked={selected.has(f)} onChange={() => toggleFile(f)} />
                <span style={s.fileName}>{f}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  wrap: { maxWidth: 800, margin: '40px auto', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 16 },
  header: { display: 'flex', alignItems: 'center', gap: 16 },
  title: { fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 },
  backBtn: { background: 'transparent', border: '1px solid #3a3f5c', color: '#94a3b8', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer' },
  errorBox: { background: '#ff000022', border: '1px solid #ff4444', borderRadius: 8, padding: '10px 14px', color: '#ff8888', fontSize: 13 },
  doneBox: { background: '#10b98122', border: '1px solid #10b981', borderRadius: 8, padding: '10px 14px', color: '#10b981', fontSize: 13 },
  progressWrap: { display: 'flex', flexDirection: 'column', gap: 8 },
  progressBar: { height: 10, background: '#1e2035', borderRadius: 6, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 6, transition: 'width .4s ease' },
  progressLabel: { fontSize: 13, color: '#94a3b8' },
  errorList: { display: 'flex', flexDirection: 'column', gap: 4 },
  errorItem: { fontSize: 12, color: '#f87171' },
  controls: { display: 'flex', gap: 12 },
  startBtn: { background: '#6366f1', color: '#fff', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none' },
  stopBtn: { background: '#ef4444', color: '#fff', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none' },
  fileList: { display: 'flex', flexDirection: 'column', gap: 8 },
  selectAllRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 8, color: '#e2e8f0', fontSize: 14, cursor: 'pointer' },
  hint: { fontSize: 12, color: '#64748b' },
  fileScroll: { maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, border: '1px solid #2d3248', borderRadius: 8, padding: '8px 12px' },
  fileRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' },
  fileName: { fontSize: 13, color: '#94a3b8', fontFamily: 'monospace' },
}
