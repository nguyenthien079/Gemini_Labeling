import { useState, useRef, useCallback } from 'react'

export const ENTITY_COLORS = {
  DISEASE:    { bg: '#ff6b6b33', border: '#ff6b6b', text: '#ff6b6b' },
  SYMPTOM:    { bg: '#ffa94d33', border: '#ffa94d', text: '#ffa94d' },
  MEDICATION: { bg: '#74c0fc33', border: '#74c0fc', text: '#74c0fc' },
  TREATMENT:  { bg: '#b197fc33', border: '#b197fc', text: '#b197fc' },
  BODY_PART:  { bg: '#63e6be33', border: '#63e6be', text: '#63e6be' },
  TEST:       { bg: '#fdd83533', border: '#fdd835', text: '#fdd835' },
  VALUE:      { bg: '#a9e34b33', border: '#a9e34b', text: '#a9e34b' },
  DOCTOR:     { bg: '#74b9ff33', border: '#74b9ff', text: '#74b9ff' },
  PATIENT:    { bg: '#ffb3c633', border: '#ffb3c6', text: '#ffb3c6' },
  LOCATION:   { bg: '#95e1d333', border: '#95e1d3', text: '#95e1d3' },
  DATE:       { bg: '#dda0dd33', border: '#dda0dd', text: '#dda0dd' },
}

const ENTITY_TYPES = Object.keys(ENTITY_COLORS)

// Tính số ký tự trước vị trí caret trong một element,
// bỏ qua nội dung bên trong <sup> (label tag)
function charsBeforeCaret(segEl, caretNode, caretOffset) {
  const walker = document.createTreeWalker(segEl, NodeFilter.SHOW_TEXT)
  let count = 0
  let node
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('sup')) continue  // bỏ qua label sup
    if (node === caretNode) return count + caretOffset
    count += node.textContent.length
  }
  return count
}

function HighlightedText({ text, entities, onEntityClick, onManualSelect }) {
  const containerRef = useRef()

  const segments = (() => {
    const sorted = [...entities].sort((a, b) => a.start - b.start)
    const segs = []
    let cursor = 0
    for (const ent of sorted) {
      if (ent.start > cursor)
        segs.push({ type: 'text', content: text.slice(cursor, ent.start), start: cursor })
      if (ent.start >= cursor) {
        segs.push({ type: 'entity', entity: ent, start: ent.start })
        cursor = ent.end
      }
    }
    if (cursor < text.length)
      segs.push({ type: 'text', content: text.slice(cursor), start: cursor })
    return segs
  })()

  const handleMouseUp = useCallback((e) => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const selectedText = sel.toString()
    if (!selectedText.trim()) return

    const range = sel.getRangeAt(0)
    let startEl = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer

    // Leo lên tìm element có data-char-start
    while (startEl && startEl !== containerRef.current) {
      if (startEl.hasAttribute('data-char-start')) break
      startEl = startEl.parentElement
    }
    if (!startEl || startEl === containerRef.current) return

    const segStart = parseInt(startEl.getAttribute('data-char-start'))
    const before = charsBeforeCaret(startEl, range.startContainer, range.startOffset)
    const start = segStart + before
    const end = start + selectedText.length

    // Verify khớp với text gốc
    if (end <= text.length && text.slice(start, end) === selectedText) {
      onManualSelect({ text: selectedText, start, end }, { x: e.clientX, y: e.clientY })
    }
    sel.removeAllRanges()
  }, [text, onManualSelect])

  return (
    <div
      ref={containerRef}
      style={styles.textBody}
      onMouseUp={handleMouseUp}
    >
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return (
            <span key={i} data-char-start={seg.start}>
              {seg.content}
            </span>
          )
        }
        const { entity } = seg
        const color = ENTITY_COLORS[entity.label] || { bg: '#ffffff22', border: '#aaa', text: '#aaa' }
        return (
          <span
            key={i}
            data-char-start={seg.start}
            title={`${entity.label} — click để sửa/xoá`}
            style={{
              background: color.bg,
              border: `1px solid ${color.border}`,
              borderRadius: 4,
              padding: '1px 4px',
              cursor: 'pointer',
            }}
            onClick={() => onEntityClick(entity)}
          >
            {entity.text}
            <sup style={{ fontSize: 9, color: color.text, marginLeft: 3, fontWeight: 700, userSelect: 'none' }}>
              {entity.label}
            </sup>
          </span>
        )
      })}
    </div>
  )
}

// Popup chọn label khi bôi đen text
function ManualLabelPicker({ selection, pos, onConfirm, onCancel }) {
  const [label, setLabel] = useState(ENTITY_TYPES[0])
  return (
    <div style={{ ...styles.picker, top: pos.y + 8, left: pos.x }}>
      <div style={styles.pickerSelected}>"{selection.text}"</div>
      <div style={styles.pickerGrid}>
        {ENTITY_TYPES.map(t => {
          const c = ENTITY_COLORS[t]
          return (
            <button
              key={t}
              style={{
                ...styles.pickerChip,
                background: label === t ? c.bg : 'transparent',
                border: `1px solid ${label === t ? c.border : '#3a3f5c'}`,
                color: label === t ? c.text : '#94a3b8',
              }}
              onClick={() => setLabel(t)}
            >
              {t}
            </button>
          )
        })}
      </div>
      <div style={styles.pickerActions}>
        <button style={styles.cancelBtn} onClick={onCancel}>Huỷ</button>
        <button style={styles.confirmBtn} onClick={() => onConfirm({ ...selection, label })}>
          Gán nhãn
        </button>
      </div>
    </div>
  )
}

// Modal sửa entity khi click
function EntityEditModal({ entity, onSave, onDelete, onClose }) {
  const [label, setLabel] = useState(entity.label)
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Sửa entity</h3>
        <div style={styles.entityText}>"{entity.text}"</div>
        <div style={styles.labelGrid}>
          {ENTITY_TYPES.map(t => {
            const c = ENTITY_COLORS[t]
            return (
              <button
                key={t}
                style={{
                  ...styles.labelChip,
                  background: label === t ? c.bg : 'transparent',
                  border: `1px solid ${label === t ? c.border : '#3a3f5c'}`,
                  color: label === t ? c.text : '#94a3b8',
                }}
                onClick={() => setLabel(t)}
              >
                {t}
              </button>
            )
          })}
        </div>
        <div style={styles.modalActions}>
          <button style={styles.deleteBtn} onClick={() => onDelete(entity)}>Xoá</button>
          <button style={styles.saveBtn} onClick={() => onSave({ ...entity, label })}>Lưu</button>
        </div>
      </div>
    </div>
  )
}

export default function LabelViewer({ text, filename, entities, setEntities, onExport, exporting }) {
  const [editing, setEditing] = useState(null)
  const [manualSel, setManualSel] = useState(null)
  const [pickerPos, setPickerPos] = useState({ x: 0, y: 0 })

  const handleManualSelect = (selection, pos) => {
    // Kiểm tra không overlap với entity đã có
    const overlap = entities.some(e => !(selection.end <= e.start || selection.start >= e.end))
    if (overlap) return
    setManualSel(selection)
    // Giữ popup trong viewport
    const x = Math.min(pos.x, window.innerWidth - 320)
    const y = Math.min(pos.y, window.innerHeight - 250)
    setPickerPos({ x, y })
  }

  const handleManualConfirm = (entity) => {
    setEntities(prev => [...prev, entity].sort((a, b) => a.start - b.start))
    setManualSel(null)
  }

  const handleSave = (updated) => {
    setEntities(prev => prev.map(e =>
      e.start === updated.start && e.end === updated.end ? updated : e
    ))
    setEditing(null)
  }

  const handleDelete = (target) => {
    setEntities(prev => prev.filter(e => !(e.start === target.start && e.end === target.end)))
    setEditing(null)
  }

  const grouped = ENTITY_TYPES.reduce((acc, t) => {
    acc[t] = entities.filter(e => e.label === t)
    return acc
  }, {})

  return (
    <div style={styles.wrap}>
      {editing && (
        <EntityEditModal
          entity={editing}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditing(null)}
        />
      )}

      {manualSel && (
        <div style={styles.pickerBackdrop} onClick={() => setManualSel(null)}>
          <div onClick={e => e.stopPropagation()}>
            <ManualLabelPicker
              selection={manualSel}
              pos={pickerPos}
              onConfirm={handleManualConfirm}
              onCancel={() => setManualSel(null)}
            />
          </div>
        </div>
      )}

      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={styles.fileName}>{filename}</span>
          <span style={styles.entityCount}>{entities.length} entities</span>
        </div>
        <button
          style={{ ...styles.exportBtn, ...(exporting ? styles.btnDisabled : {}) }}
          onClick={onExport}
          disabled={exporting}
        >
          {exporting ? 'Đang lưu...' : 'Lưu (JSON + CSV + Pipe)'}
        </button>
      </div>

      {/* Legend */}
      <div style={styles.legend}>
        {ENTITY_TYPES.filter(t => grouped[t].length > 0).map(t => (
          <span key={t} style={{ ...styles.legendChip, color: ENTITY_COLORS[t].text, borderColor: ENTITY_COLORS[t].border }}>
            {t} <strong>{grouped[t].length}</strong>
          </span>
        ))}
      </div>

      {/* Hint */}
      <div style={styles.hintRow}>
        <span style={styles.hintBadge}>Bôi đen</span> để gán nhãn thủ công &nbsp;·&nbsp;
        <span style={styles.hintBadge}>Click entity</span> để sửa / xoá
      </div>

      {/* Text */}
      <HighlightedText
        text={text}
        entities={entities}
        onEntityClick={setEditing}
        onManualSelect={handleManualSelect}
      />
    </div>
  )
}

const styles = {
  wrap: { flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden', minWidth: 0 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  fileName: { fontWeight: 700, fontSize: 16, color: '#fff' },
  entityCount: { fontSize: 13, color: '#64748b', background: '#1e2035', padding: '2px 10px', borderRadius: 20 },
  exportBtn: { background: '#10b981', color: '#fff', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnDisabled: { background: '#3a3f5c', color: '#64748b', cursor: 'not-allowed' },
  legend: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  legendChip: { fontSize: 11, border: '1px solid', borderRadius: 20, padding: '2px 10px' },
  hintRow: { fontSize: 12, color: '#475569' },
  hintBadge: { background: '#2d3248', color: '#94a3b8', borderRadius: 4, padding: '1px 6px', fontSize: 11 },
  textBody: {
    flex: 1, background: '#1a1d27', borderRadius: 10, padding: '20px',
    lineHeight: 2.2, fontSize: 15, overflowY: 'auto', maxHeight: '55vh',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', cursor: 'text',
    userSelect: 'text',
  },

  // Manual picker
  pickerBackdrop: { position: 'fixed', inset: 0, zIndex: 999 },
  picker: {
    position: 'fixed', background: '#1a1d27', border: '1px solid #3a3f5c',
    borderRadius: 12, padding: 16, width: 300, zIndex: 1000,
    boxShadow: '0 8px 32px #00000066',
  },
  pickerSelected: {
    background: '#0f1117', borderRadius: 8, padding: '6px 10px',
    color: '#e2e8f0', fontSize: 13, marginBottom: 12,
    fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  pickerGrid: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  pickerChip: { padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  pickerActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  cancelBtn: { background: 'transparent', color: '#64748b', border: '1px solid #3a3f5c', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer' },
  confirmBtn: { background: '#6366f1', color: '#fff', borderRadius: 8, padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },

  // Edit modal
  overlay: { position: 'fixed', inset: 0, background: '#00000088', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#1a1d27', borderRadius: 14, padding: 24, width: 420, border: '1px solid #2d3248' },
  modalTitle: { fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 12 },
  entityText: { background: '#0f1117', borderRadius: 8, padding: '8px 12px', color: '#e2e8f0', fontSize: 14, marginBottom: 16, fontStyle: 'italic' },
  labelGrid: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  labelChip: { padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10 },
  deleteBtn: { background: 'transparent', color: '#f87171', border: '1px solid #f87171', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
  saveBtn: { background: '#6366f1', color: '#fff', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
}
