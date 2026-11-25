/** The only place the frontend talks HTTP. Every call returns `data` or throws ApiError. */
export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = error?.code;
    this.details = error?.details;
  }
}

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(`/api/v1${url}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: 'Cannot reach the ARCHON server.' });
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok || !json?.success) throw new ApiError(res.status, json?.error);
  return json.data;
}

const get = (u) => request('GET', u);
const post = (u, b = {}) => request('POST', u, b);
const patch = (u, b) => request('PATCH', u, b);
const put = (u, b) => request('PUT', u, b);
const del = (u) => request('DELETE', u);

export const api = {
  meta: () => get('/meta'),

  projects: {
    list: () => get('/projects'),
    create: (b) => post('/projects', b),
    update: (id, b) => patch(`/projects/${id}`, b),
    remove: (id) => del(`/projects/${id}`),
    stats: (id) => get(`/projects/${id}/stats`),
    graph: (id) => get(`/projects/${id}/graph`),
    import: (doc) => post('/projects/import', doc),
    exportUrl: (id) => `/api/v1/projects/${id}/export`,
  },
  modules: {
    create: (pid, b) => post(`/projects/${pid}/modules`, b),
    update: (id, b) => patch(`/modules/${id}`, b),
    remove: (id) => del(`/modules/${id}`),
  },
  objects: {
    create: (pid, b) => post(`/projects/${pid}/objects`, b),
    details: (id) => get(`/objects/${id}`),
    update: (id, b) => patch(`/objects/${id}`, b),
    impact: (id) => get(`/objects/${id}/delete-impact`),
    remove: (id) => del(`/objects/${id}`),
  },
  relationships: {
    create: (pid, b) => post(`/projects/${pid}/relationships`, b),
    update: (id, b) => patch(`/relationships/${id}`, b),
    remove: (id) => del(`/relationships/${id}`),
  },
  tasks: {
    list: (pid) => get(`/projects/${pid}/tasks`),
    create: (pid, b) => post(`/projects/${pid}/tasks`, b),
    update: (id, b) => patch(`/tasks/${id}`, b),
    remove: (id) => del(`/tasks/${id}`),
  },
  notes: {
    list: (pid) => get(`/projects/${pid}/notes`),
    create: (pid, b) => post(`/projects/${pid}/notes`, b),
    update: (id, b) => patch(`/notes/${id}`, b),
    remove: (id) => del(`/notes/${id}`),
  },
  canvas: {
    savePositions: (canvasId, b) => put(`/canvases/${canvasId}/positions`, b),
  },
  backup: async () => {
    const res = await fetch('/api/v1/backup', { method: 'POST' });
    if (!res.ok) throw new ApiError(res.status, { message: 'Backup failed.' });
    return res;
  },
};
