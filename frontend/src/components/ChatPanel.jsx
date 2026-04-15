import { useState, useRef, useEffect } from 'react'

export default function ChatPanel({ onFeedback, loading }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Xin chào! Nếu Gemini gán nhãn sai, hãy mô tả cho tôi — tôi sẽ label lại ngay.' }
  ])
  const [input, setInput] = useState('')
  const bottomRef = useRef()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: msg }])

    try {
      await onFeedback(msg, (result) => {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: `Đã re-label lại. Tìm thấy ${result.entities.length} entities.` }
        ])
      })
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Có lỗi xảy ra, thử lại nhé.' }])
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>Feedback cho Gemini</div>

      <div style={styles.messages}>
        {messages.map((m, i) => (
          <div key={i} style={{ ...styles.msg, ...(m.role === 'user' ? styles.userMsg : styles.botMsg) }}>
            {m.text}
          </div>
        ))}
        {loading && (
          <div style={styles.botMsg}>
            <span style={styles.typing}>Gemini đang xử lý...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={styles.inputRow}>
        <textarea
          style={styles.input}
          placeholder='Ví dụ: "sốt" bị label sai, phải là SYMPTOM không phải DISEASE'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          disabled={loading}
        />
        <button
          style={{ ...styles.sendBtn, ...(loading ? styles.btnDisabled : {}) }}
          onClick={send}
          disabled={loading}
        >
          Gửi
        </button>
      </div>
      <p style={styles.hint}>Enter để gửi · Shift+Enter xuống dòng</p>
    </div>
  )
}

const styles = {
  wrap: {
    width: 320, display: 'flex', flexDirection: 'column',
    background: '#1a1d27', border: '1px solid #2d3248', borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    padding: '14px 16px', borderBottom: '1px solid #2d3248',
    fontWeight: 600, fontSize: 14, color: '#e2e8f0',
  },
  messages: {
    flex: 1, overflowY: 'auto', padding: '12px 12px', display: 'flex',
    flexDirection: 'column', gap: 8, minHeight: 200, maxHeight: '45vh',
  },
  msg: { padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.5, maxWidth: '90%' },
  botMsg: { background: '#232640', color: '#cbd5e1', alignSelf: 'flex-start' },
  userMsg: { background: '#6366f1', color: '#fff', alignSelf: 'flex-end' },
  typing: { color: '#64748b', fontStyle: 'italic' },
  inputRow: { padding: '8px 10px', display: 'flex', gap: 8, borderTop: '1px solid #2d3248' },
  input: {
    flex: 1, background: '#0f1117', border: '1px solid #2d3248', borderRadius: 8,
    color: '#e2e8f0', fontSize: 13, padding: '8px 10px', resize: 'none',
  },
  sendBtn: {
    background: '#6366f1', color: '#fff', borderRadius: 8,
    padding: '8px 14px', fontSize: 13, fontWeight: 600, alignSelf: 'flex-end',
  },
  btnDisabled: { background: '#3a3f5c', color: '#64748b', cursor: 'not-allowed' },
  hint: { fontSize: 11, color: '#475569', textAlign: 'center', padding: '4px 0 8px' },
}
