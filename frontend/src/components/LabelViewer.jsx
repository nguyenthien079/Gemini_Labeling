import { useState } from 'react'

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

function HighlightedText({ text, entities, onEntityClick }) {
  const sorted = [...entities].sort((a, b) => a.start - b.start)
  const segments = []
  let cursor = 0

  for (const entity of sorted) {
    if (entity.start > cursor) {
      segments.push({ type: 'text', content: text.slice(cursor, entity.start) })
    }
    if (entity.start >= cursor) {
      segments.push({ type: 'entity', entity })
      cursor = entity.end
    }
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', content: text.slice(cursor) })
  }

  return (
    <div style={styles.textBody}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.content}</span>
        }
        const { entity } = seg
        const color = ENTITY_COLORS[entity.label] || { bg: '#ffffff22', border: '#aaa', text: '#aaa' }
        return (
          <span
            key={i}
            title={`${entity.label} — click để sửa/xoá`}
            style={{
              background: color.bg,
              border: `1px solid ${color.border}`,
              borderRadius: 4,
              padding: '1px 4px',
              cursor: 'pointer',
              position: 'relative',
            }}
            onClick={() => onEntityClick(entity)}
          >
            {entity.text}
            <span style={{ fontSize: 9, color: color.text, marginLeft: 3, fontWeight: 700, verticalAlign: 'super' }}>
              {entity.label}
            </span>
          </span>
        )
      })}
    </div>
  )
}

function EntityEditModal({ entity, onSave, onDelete, onClose }) {
  const [label, setLabel] = useState(entity.label)
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
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

  const handleEntityClick = (entity) => setEditing(entity)

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

      {/* Header */}
      <div style={styles.header}>
        <div>
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

      {/* Text */}
      <HighlightedText text={text} entities={entities} onEntityClick={handleEntityClick} />

      <p style={styles.hint}>Click vào entity để đổi nhãn hoặc xoá</p>
    </div>
  )
}

const styles = {
  wrap: { flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  fileName: { fontWeight: 700, fontSize: 16, color: '#fff', marginRight: 10 },
  entityCount: { fontSize: 13, color: '#64748b', background: '#1e2035', padding: '2px 10px', borderRadius: 20 },
  exportBtn: {
    background: '#10b981', color: '#fff', borderRadius: 8,
    padding: '8px 18px', fontSize: 13, fontWeight: 600,
  },
  btnDisabled: { background: '#3a3f5c', color: '#64748b', cursor: 'not-allowed' },
  legend: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  legendChip: {
    fontSize: 11, border: '1px solid', borderRadius: 20,
    padding: '2px 10px', background: 'transparent',
  },
  textBody: {
    flex: 1, background: '#1a1d27', borderRadius: 10, padding: '20px',
    lineHeight: 2, fontSize: 15, overflowY: 'auto', maxHeight: '50vh',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  hint: { fontSize: 12, color: '#475569', textAlign: 'center' },

  // Modal
  overlay: {
    position: 'fixed', inset: 0, background: '#00000088',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#1a1d27', borderRadius: 14, padding: 24, width: 420,
    border: '1px solid #2d3248',
  },
  modalTitle: { fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 12 },
  entityText: {
    background: '#0f1117', borderRadius: 8, padding: '8px 12px',
    color: '#e2e8f0', fontSize: 14, marginBottom: 16, fontStyle: 'italic',
  },
  labelGrid: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  labelChip: {
    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10 },
  deleteBtn: {
    background: 'transparent', color: '#f87171', border: '1px solid #f87171',
    borderRadius: 8, padding: '8px 16px', fontSize: 13,
  },
  saveBtn: {
    background: '#6366f1', color: '#fff', borderRadius: 8,
    padding: '8px 20px', fontSize: 13, fontWeight: 600,
  },
}
