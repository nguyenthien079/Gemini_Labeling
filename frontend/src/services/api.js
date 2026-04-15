import axios from 'axios'

const api = axios.create({ baseURL: 'http://localhost:8000' })

export const labelText = (text, filename) =>
  api.post('/api/label', { text, filename }).then(r => r.data)

export const relabelText = (text, filename, current_entities, feedback) =>
  api.post('/api/relabel', { text, filename, current_entities, feedback }).then(r => r.data)

export const exportData = (text, filename, entities) =>
  api.post('/api/export', { text, filename, entities }).then(r => r.data)

export const getEntityTypes = () =>
  api.get('/api/entity-types').then(r => r.data)
