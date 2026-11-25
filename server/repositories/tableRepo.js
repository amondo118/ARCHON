/**
 * Minimal data access for one table. All SQL is parameterized; table and
 * column names come only from code, never from input.
 */
export function tableRepo(db, table, { columns, json = [], booleans = [], orderBy = 'created_at, rowid' }) {
  const decode = (row) => {
    if (!row) return row;
    for (const c of json) row[c] = row[c] ? JSON.parse(row[c]) : {};
    for (const c of booleans) row[c] = Boolean(row[c]);
    return row;
  };
  const encode = (key, value) => {
    if (json.includes(key)) return JSON.stringify(value ?? {});
    if (booleans.includes(key)) return value ? 1 : 0;
    return value;
  };

  const getStmt = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);
  const insertStmt = db.prepare(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => '@' + c).join(', ')})`,
  );
  const deleteStmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  const hasProject = columns.includes('project_id');
  const listStmt = hasProject
    ? db.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY ${orderBy}`)
    : null;

  return {
    get: (id) => decode(getStmt.get(id)),
    listByProject: (projectId) => listStmt.all(projectId).map(decode),
    insert(row) {
      const params = {};
      for (const c of columns) params[c] = encode(c, row[c] ?? null);
      insertStmt.run(params);
      return this.get(row.id);
    },
    update(id, patch) {
      const keys = Object.keys(patch).filter((k) => columns.includes(k) && k !== 'id');
      if (keys.length) {
        const params = { id };
        for (const k of keys) params[k] = encode(k, patch[k]);
        db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run(params);
      }
      return this.get(id);
    },
    remove: (id) => deleteStmt.run(id).changes > 0,
  };
}
