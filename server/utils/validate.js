import { badRequest } from './errors.js';

/**
 * Validate and pick fields from an input object.
 *
 * spec: { field: { type: 'string'|'integer'|'number'|'boolean'|'object'|'date',
 *                  required?, nullable?, enum?, max?, trim? } }
 * partial: when true (PATCH), only present fields are validated and returned
 *          and `required` is ignored.
 */
export function validate(input, spec, { partial = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('Request body must be a JSON object.');
  }
  const out = {};
  for (const [field, rule] of Object.entries(spec)) {
    const present = Object.prototype.hasOwnProperty.call(input, field) && input[field] !== undefined;
    if (!present) {
      if (rule.required && !partial) throw badRequest(`Field "${field}" is required.`);
      continue;
    }
    let value = input[field];
    if (value === null || (value === '' && rule.type !== 'string')) {
      if (rule.required) throw badRequest(`Field "${field}" cannot be empty.`);
      if (!rule.nullable) throw badRequest(`Field "${field}" cannot be null.`);
      out[field] = null;
      continue;
    }
    out[field] = coerce(field, value, rule);
  }
  return out;
}

function coerce(field, value, rule) {
  switch (rule.type) {
    case 'string':
    case 'date': {
      if (typeof value !== 'string') throw badRequest(`Field "${field}" must be a string.`);
      value = value.trim();
      if (rule.required && value === '') throw badRequest(`Field "${field}" cannot be empty.`);
      if (rule.max && value.length > rule.max) throw badRequest(`Field "${field}" exceeds ${rule.max} characters.`);
      if (rule.type === 'date' && value !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw badRequest(`Field "${field}" must be a date (YYYY-MM-DD).`);
      }
      if (rule.type === 'date' && value === '') return null;
      if (rule.enum && !rule.enum.includes(value)) {
        throw badRequest(`Invalid ${field} "${value}". Allowed: ${rule.enum.join(', ')}.`);
      }
      return value;
    }
    case 'integer':
      if (!Number.isInteger(value)) throw badRequest(`Field "${field}" must be an integer.`);
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest(`Field "${field}" must be a number.`);
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') throw badRequest(`Field "${field}" must be a boolean.`);
      return value;
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) throw badRequest(`Field "${field}" must be an object.`);
      return value;
    default:
      throw new Error(`Unknown validation type ${rule.type}`);
  }
}
