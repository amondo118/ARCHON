// Single source of truth for enumerated values and structural rules.
// The frontend fetches these via GET /api/v1/meta so they are never duplicated.

export const CONTAINER_TYPES = ['class', 'interface', 'script', 'component', 'manager', 'struct', 'enum', 'resource'];
export const MEMBER_TYPES = ['method', 'property', 'signal', 'event'];
export const FREE_TYPES = ['function', 'other'];
export const OBJECT_TYPES = [...CONTAINER_TYPES, ...MEMBER_TYPES, ...FREE_TYPES];

export const HEALTH_STATUSES = ['unreviewed', 'good', 'warning', 'bad'];
export const IMPLEMENTATION_STATUSES = ['planned', 'in_progress', 'complete', 'broken'];
export const VISIBILITIES = ['none', 'public', 'private', 'protected', 'internal'];

export const RELATIONSHIP_TYPES = ['calls', 'signal', 'inherits', 'depends_on', 'references', 'implements', 'uses'];

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'];
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const NOTE_TYPES = ['general', 'decision', 'technical', 'problem'];

export const isContainer = (type) => CONTAINER_TYPES.includes(type);
export const isMember = (type) => MEMBER_TYPES.includes(type);

/**
 * Returns an error message if `childType` may not be placed under `parentType`
 * (parentType null = top level), otherwise null.
 */
export function parentRuleError(childType, parentType) {
  if (parentType == null) {
    return isMember(childType) ? `A ${childType} must belong to a parent object (e.g. a class).` : null;
  }
  if (!isContainer(parentType)) {
    return `A ${parentType} cannot contain other objects.`;
  }
  return null;
}

/** Type compatibility for typed relationships. Returns an error message or null. */
const INHERITABLE = ['class', 'interface', 'struct', 'script', 'component', 'manager', 'resource'];
const IMPLEMENTERS = ['class', 'struct', 'script', 'component', 'manager'];

export function relationshipRuleError(type, source, target) {
  if (type === 'inherits') {
    if (!INHERITABLE.includes(source.type) || !INHERITABLE.includes(target.type)) {
      return `"inherits" is only allowed between ${INHERITABLE.join(', ')} objects.`;
    }
    if ((source.type === 'interface') !== (target.type === 'interface')) {
      return 'Interfaces can only inherit from interfaces (use "implements" for classes).';
    }
  }
  if (type === 'implements') {
    if (!IMPLEMENTERS.includes(source.type) || target.type !== 'interface') {
      return '"implements" must go from a class-like object to an interface.';
    }
  }
  return null;
}

export const META = {
  objectTypes: OBJECT_TYPES,
  containerTypes: CONTAINER_TYPES,
  memberTypes: MEMBER_TYPES,
  healthStatuses: HEALTH_STATUSES,
  implementationStatuses: IMPLEMENTATION_STATUSES,
  visibilities: VISIBILITIES,
  relationshipTypes: RELATIONSHIP_TYPES,
  taskStatuses: TASK_STATUSES,
  taskPriorities: TASK_PRIORITIES,
  noteTypes: NOTE_TYPES,
};
