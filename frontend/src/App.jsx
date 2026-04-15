import { useState } from 'react'
import UploadZone from './components/UploadZone'
import LabelViewer from './components/LabelViewer'
import ChatPanel from './components/ChatPanel'
import BatchPanel from './components/BatchPanel'
import { labelText, relabelText, exportData } from './services/api'

export default function App() {
  const [view, setView] = useState('upload')  // 'upload' | 'label' | 'batch'
  const [text, setText] = useState('')
  const [filename, setFilename] = useState('document')
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState(null)

  const handleUploadSubmit = async (rawText, rawFilename) => {
    setLoading(true)
    try {
      const result = await labelText(rawText, rawFilename)
      setText(rawText)
      setFilename(rawFilename)
      setEntities(result.entities)
      setView('label')
    } catch (err) {
      alert('Lỗi: ' + (err.response?.data?.detail || err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleFeedback = async (feedback, onDone) => {
    setLoading(true)
    try {
      const result = await relabelText(text, filename, entities, feedback)
      setEntities(result.entities)
      onDone(result)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    setExporting(true)
    setExportMsg(null)
    try {
      const result = await exportData(text, filename, entities)
      setExportMsg(`Đã lưu: ${Object.values(result.files).map(p => p.split(/[\\/]/).pop()).join(', ')}`)
    } catch (err) {
      setExportMsg('Lỗi khi lưu: ' + (err.response?.data?.detail || err.message))
    } finally {
      setExporting(false)
    }
  }

  const handleReset = () => {
    setView('upload')
    setText('')
    setFilename('document')
    setEntities([])
    setExportMsg(null)
  }

  if (view === 'batch') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <BatchPanel onBack={() => setView('upload')} />
      </div>
    )
  }

  if (view === 'upload') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <UploadZone onSubmit={handleUploadSubmit} loading={loading} onBatch={() => setView('batch')} />
      </div>
    )
  }

  return (
    <div style={styles.page}>
      {/* Top bar */}
      <div style={styles.topbar}>
        <span style={styles.brand}>Medical NER Labeler</span>
        <button style={styles.backBtn} onClick={handleReset}>+ Tài liệu mới</button>
      </div>

      {exportMsg && (
        <div style={styles.toast}>{exportMsg}</div>
      )}

      {/* Main layout */}
      <div style={styles.main}>
        <div style={styles.labelArea}>
          <LabelViewer
            text={text}
            filename={filename}
            entities={entities}
            setEntities={setEntities}
            onExport={handleExport}
            exporting={exporting}
          />
        </div>
        <ChatPanel onFeedback={handleFeedback} loading={loading} />
      </div>
    </div>
  )
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' },
  topbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 24px', borderBottom: '1px solid #2d3248', background: '#0f1117',
  },
  brand: { fontWeight: 700, fontSize: 16, color: '#fff' },
  backBtn: {
    background: 'transparent', border: '1px solid #3a3f5c', color: '#94a3b8',
    borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
  },
  toast: {
    margin: '8px 24px', padding: '10px 16px', background: '#10b98122',
    border: '1px solid #10b981', borderRadius: 8, fontSize: 13, color: '#10b981',
  },
  main: {
    flex: 1, display: 'flex', gap: 16, padding: '16px 24px',
    overflow: 'hidden',
  },
  labelArea: { flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' },
}
