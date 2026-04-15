import { useState, useRef } from 'react'

export default function UploadZone({ onSubmit, loading, onBatch }) {
  const [text, setText] = useState('')
  const [filename, setFilename] = useState('document')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef()

  const handleFile = (file) => {
    setFilename(file.name.replace(/\.[^.]+$/, ''))
    const reader = new FileReader()
    reader.onload = (e) => setText(e.target.result)
    reader.readAsText(file, 'utf-8')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const handleSubmit = () => {
    if (!text.trim()) return
    onSubmit(text.trim(), filename)
  }

  return (
    <div style={styles.wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1 style={styles.title}>Medical NER Labeler</h1>
        <button style={styles.batchBtn} onClick={onBatch}>Batch Mode →</button>
      </div>
      <p style={styles.sub}>Upload file hoặc paste văn bản y tế tiếng Việt — AI sẽ gán nhãn tự động</p>

      <div
        style={{ ...styles.dropzone, ...(dragging ? styles.dropzoneActive : {}) }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.html"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
        />
        <span style={styles.dropIcon}>📄</span>
        <span style={styles.dropText}>Kéo thả file .txt / .html hoặc click để chọn</span>
      </div>

      <div style={styles.orRow}>
        <div style={styles.line} />
        <span style={styles.orText}>hoặc paste text</span>
        <div style={styles.line} />
      </div>

      <textarea
        style={styles.textarea}
        placeholder="Dán văn bản y tế vào đây..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
      />

      <div style={styles.footer}>
        <input
          style={styles.nameInput}
          placeholder="Tên file (không cần đuôi)"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
        />
        <button
          style={{ ...styles.btn, ...(loading || !text.trim() ? styles.btnDisabled : {}) }}
          onClick={handleSubmit}
          disabled={loading || !text.trim()}
        >
          {loading ? 'Đang gán nhãn...' : 'Gán nhãn với AI'}
        </button>
      </div>
    </div>
  )
}

const styles = {
  wrap: { maxWidth: 720, margin: '60px auto', padding: '0 20px' },
  title: { fontSize: 28, fontWeight: 700, color: '#fff', marginBottom: 8 },
  sub: { color: '#94a3b8', marginBottom: 32, lineHeight: 1.6 },
  dropzone: {
    border: '2px dashed #3a3f5c', borderRadius: 12, padding: '40px 20px',
    textAlign: 'center', cursor: 'pointer', marginBottom: 24, transition: 'all .2s',
    background: '#1a1d27',
  },
  dropzoneActive: { borderColor: '#6366f1', background: '#1e2035' },
  dropIcon: { fontSize: 36, display: 'block', marginBottom: 10 },
  dropText: { color: '#94a3b8', fontSize: 14 },
  orRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 },
  line: { flex: 1, height: 1, background: '#2d3248' },
  orText: { color: '#64748b', fontSize: 13 },
  textarea: {
    width: '100%', background: '#1a1d27', border: '1px solid #2d3248',
    borderRadius: 10, padding: '14px 16px', color: '#e2e8f0', fontSize: 14,
    lineHeight: 1.7, resize: 'vertical',
  },
  footer: { display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' },
  nameInput: {
    flex: 1, background: '#1a1d27', border: '1px solid #2d3248', borderRadius: 8,
    padding: '10px 14px', color: '#e2e8f0', fontSize: 14,
  },
  btn: {
    background: '#6366f1', color: '#fff', borderRadius: 8, padding: '10px 24px',
    fontSize: 14, fontWeight: 600, transition: 'background .2s',
  },
  btnDisabled: { background: '#3a3f5c', color: '#64748b', cursor: 'not-allowed' },
  batchBtn: {
    background: 'transparent', border: '1px solid #6366f1', color: '#6366f1',
    borderRadius: 8, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
  },
}
