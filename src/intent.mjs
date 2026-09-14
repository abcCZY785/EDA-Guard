import { hashObject, stableStringify } from './hash.mjs';
import { SEMANTIC_DIFF_SCHEMA, semanticDiff } from './diff.mjs';

export const INTENT_SCHEMA = 'edaguard.intent.v1';
export const INTENT_RESULT_SCHEMA = 'edaguard.intent-result.v1';
export const INTENT_SCHEMA_VERSION = '0.1.0';

const SUPPORTED_CATEGORIES = new Set(['components', 'properties', 'bom', 'connectivity', 'board_rules', 'routing']);
const COMPONENT_SCOPED_EVENTS = new Set(['component_added', 'component_removed', 'component_moved', 'component_rotated', 'property_changed']);
const COMPONENT_ENTITY_EVENTS = new Set([
  ...COMPONENT_SCOPED_EVENTS,
  'bom_item_added', 'bom_item_removed', 'bom_property_changed', 'bom_supplier_id_changed',
  'connectivity_member_added', 'connectivity_member_removed', 'pin_reassigned',
]);
const EVENT_SELECTOR_ALIASES = Object.freeze({
  component_added: ['component_added'],
  component_removed: ['component_removed'],
  component_moved: ['component_moved'],
  component_rotated: ['component_rotated'],
  property_changed: ['property_changed'],
  bom_added: ['bom_item_added'],
  bom_removed: ['bom_item_removed'],
  bom_changed: ['bom_property_changed', 'bom_supplier_id_changed'],
  bom_item_added: ['bom_item_added'],
  bom_item_removed: ['bom_item_removed'],
  bom_property_changed: ['bom_property_changed'],
  bom_supplier_id_changed: ['bom_supplier_id_changed'],
  net_added: ['connectivity_net_added'],
  net_removed: ['connectivity_net_removed'],
  net_member_added: ['connectivity_member_added'],
  net_member_removed: ['connectivity_member_removed'],
  pin_reassigned: ['pin_reassigned'],
  connectivity_net_added: ['connectivity_net_added'],
  connectivity_net_removed: ['connectivity_net_removed'],
  connectivity_member_added: ['connectivity_member_added'],
  connectivity_member_removed: ['connectivity_member_removed'],
  board_bounds_changed: ['board_bounds_changed'],
  board_outline_changed: ['board_outline_changed'],
  rule_changed: ['rule_changed'],
  layer_added: ['layer_added'],
  layer_removed: ['layer_removed'],
  layer_changed: ['layer_changed'],
  routing_changed: ['routing_changed'],
  ambiguous_match: ['ambiguous_match'],
});

const SUPPORTED_EVENTS = new Set(Object.values(EVENT_SELECTOR_ALIASES).flat());
const CATEGORY_ALIASES = Object.freeze({ component: 'components', property: 'properties', board: 'board_rules', rules: 'board_rules' });
const EVENT_CATEGORY = Object.freeze({
  component_added: 'components',
  component_removed: 'components',
  component_moved: 'components',
  component_rotated: 'components',
  property_changed: 'properties',
  bom_item_added: 'bom',
  bom_item_removed: 'bom',
  bom_property_changed: 'bom',
  bom_supplier_id_changed: 'bom',
  connectivity_net_added: 'connectivity',
  connectivity_net_removed: 'connectivity',
  connectivity_member_added: 'connectivity',
  connectivity_member_removed: 'connectivity',
  pin_reassigned: 'connectivity',
  board_bounds_changed: 'board_rules',
  board_outline_changed: 'board_rules',
  rule_changed: 'board_rules',
  layer_added: 'board_rules',
  layer_removed: 'board_rules',
  layer_changed: 'board_rules',
  routing_changed: 'routing',
  ambiguous_match: 'components',
});
const FIELD_EVENT_TYPES = new Set(['property_changed', 'bom_property_changed', 'bom_supplier_id_changed']);
const EVENT_SEVERITY = Object.freeze({
  component_added: 'NOTICE',
  component_removed: 'WARNING',
  component_moved: 'NOTICE',
  component_rotated: 'NOTICE',
  property_changed: 'NOTICE',
  bom_item_added: 'NOTICE',
  bom_item_removed: 'WARNING',
  bom_property_changed: 'NOTICE',
  bom_supplier_id_changed: 'WARNING',
  connectivity_net_added: 'NOTICE',
  connectivity_net_removed: 'CRITICAL',
  connectivity_member_added: 'NOTICE',
  connectivity_member_removed: 'CRITICAL',
  pin_reassigned: 'CRITICAL',
  board_bounds_changed: 'NOTICE',
  board_outline_changed: 'NOTICE',
  rule_changed: 'NOTICE',
  layer_added: 'NOTICE',
  layer_removed: 'WARNING',
  layer_changed: 'NOTICE',
  routing_changed: 'NOTICE',
  ambiguous_match: 'WARNING',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isEmpty(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function text(value) {
  return value === null || value === undefined ? '' : String(value);
}

function nullable(value) {
  return isEmpty(value) ? null : value;
}

function same(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function firstDefined(...values) {
  for (const value of values) if (!isEmpty(value)) return value;
  return null;
}

function errorRecord(code, message, details = {}) {
  return { code, message, ...details };
}

function identityOf(component) {
  const identity = component?.identity || {};
  return {
    key: nullable(identity.key ?? component?.key),
    unique_id: nullable(identity.unique_id ?? identity.uniqueId ?? component?.unique_id ?? component?.uniqueId),
    primitive_id: nullable(identity.primitive_id ?? identity.primitiveId ?? component?.primitive_id ?? component?.primitiveId),
    designator: nullable(identity.designator ?? component?.designator),
  };
}

function identityField(component, field) {
  const value = identityOf(component)[field];
  return isEmpty(value) ? null : String(value);
}

function componentLabel(component) {
  const identity = identityOf(component);
  return identity.designator || identity.unique_id || identity.primitive_id || identity.key || 'UNKNOWN_COMPONENT';
}

function profileName(input) {
  if (typeof input?.profile === 'string') return input.profile;
  return input?.profile?.name || input?.profile_name || input?.validity?.profile_name || input?.snapshot?.profile?.name || null;
}

function unwrapBaseline(input) {
  const envelope = isObject(input) && isObject(input.snapshot) ? input : null;
  const snapshot = envelope ? input.snapshot : input;
  const errors = [];
  if (envelope && envelope.validity?.valid_snapshot !== true) errors.push(errorRecord('INVALID_BASELINE_CAPTURE', 'Capture validity.valid_snapshot is not true.'));
  if (!isObject(snapshot)) errors.push(errorRecord('INVALID_BASELINE', 'Baseline is not a canonical snapshot or capture envelope.'));
  if (!snapshot?.snapshot_hash) errors.push(errorRecord('BASELINE_HASH_MISSING', 'Baseline snapshot_hash is missing.'));
  const identity = {
    project_uuid: snapshot?.identity?.project_uuid ?? null,
    document_uuid: snapshot?.identity?.document_uuid ?? null,
    document_type: snapshot?.identity?.document_type ?? 'unknown',
  };
  if (!identity.project_uuid || !identity.document_uuid || !['pcb', 'schematic'].includes(identity.document_type)) {
    errors.push(errorRecord('BASELINE_IDENTITY_MISSING', 'Baseline project/document identity is incomplete or document type is unknown.'));
  }
  return {
    snapshot: snapshot || null,
    errors,
    identity,
    snapshot_hash: snapshot?.snapshot_hash ?? null,
    profile: profileName(input),
  };
}

function canonicalCategory(value, errors, context) {
  if (isEmpty(value)) return null;
  const category = CATEGORY_ALIASES[String(value)] || String(value);
  if (!SUPPORTED_CATEGORIES.has(category)) errors.push(errorRecord('UNSUPPORTED_CATEGORY', `Unsupported intent category: ${category}.`, { context }));
  return category;
}

function eventTypes(value, errors, context) {
  if (isEmpty(value)) return [];
  const values = Array.isArray(value) ? value : [value];
  const result = [];
  for (const item of values) {
    const selector = String(item);
    const resolved = EVENT_SELECTOR_ALIASES[selector];
    if (!resolved) {
      errors.push(errorRecord('UNSUPPORTED_EVENT_SELECTOR', `Unsupported intent event selector: ${selector}.`, { context }));
      continue;
    }
    for (const type of resolved) if (!result.includes(type)) result.push(type);
  }
  return result.sort();
}

function shouldResolveEntity(category, types, field) {
  if (category === 'components' || category === 'properties') return true;
  if (types.some((type) => COMPONENT_ENTITY_EVENTS.has(type))) return true;
  return !isEmpty(field) && types.length === 0 && category !== 'connectivity' && category !== 'board_rules' && category !== 'routing';
}

function resolveComponent(selector, baselineInfo, errors, context) {
  const raw = isObject(selector)
    ? firstDefined(selector.unique_id, selector.uniqueId, selector.primitive_id, selector.primitiveId, selector.designator, selector.key)
    : selector;
  if (isEmpty(raw)) {
    errors.push(errorRecord('UNKNOWN_COMPONENT_SELECTOR', 'Component selector is empty.', { context }));
    return null;
  }
  const query = String(raw);
  const fields = ['unique_id', 'primitive_id', 'designator', 'key'];
  const candidates = asArray(baselineInfo.snapshot?.components).map((component, index) => ({ component, index }))
    .filter(({ component }) => fields.some((field) => identityField(component, field) === query));
  if (candidates.length === 0) {
    errors.push(errorRecord('UNKNOWN_COMPONENT_SELECTOR', `Component selector did not resolve: ${query}.`, { context, selector: query }));
    return null;
  }
  if (candidates.length > 1) {
    errors.push(errorRecord('AMBIGUOUS_COMPONENT_SELECTOR', `Component selector resolved to multiple components: ${query}.`, { context, selector: query, candidate_count: candidates.length }));
    return null;
  }
  const component = candidates[0].component;
  const matchMethod = fields.find((field) => identityField(component, field) === query) || 'unique_id';
  return {
    selector: query,
    selector_source: isObject(selector) ? selector : query,
    resolved_identity: identityOf(component),
    match_method: matchMethod,
    match_key: query,
    resolved_label: componentLabel(component),
  };
}

function ruleId(kind, index, raw) {
  const supplied = raw?.id ?? raw?.rule_id;
  if (!isEmpty(supplied)) return String(supplied);
  const prefix = kind === 'required' ? 'REQ' : kind === 'allowed' ? 'ALLOW' : 'DENY';
  return `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

function compileRule(raw, kind, index, baselineInfo, errors) {
  const context = `${kind}[${index}]`;
  if (!isObject(raw)) {
    errors.push(errorRecord('INVALID_RULE', `${context} must be an object.`, { context }));
    return {
      id: ruleId(kind, index, {}),
      kind,
      category: null,
      event: null,
      event_types: [],
      entity: null,
      component: null,
      field: null,
      net: null,
      selector_source: null,
      resolved_identity: null,
    };
  }
  const id = ruleId(kind, index, raw);
  const category = canonicalCategory(raw.category, errors, context);
  const rawEvent = raw.event ?? raw.type ?? null;
  const types = eventTypes(rawEvent, errors, context);
  const entity = nullable(raw.entity ?? raw.component);
  const componentSelector = raw.component !== undefined ? raw.component : (shouldResolveEntity(category, types, raw.field ?? raw.property) ? raw.entity : undefined);
  const resolved = componentSelector !== undefined ? resolveComponent(componentSelector, baselineInfo, errors, context) : null;
  const field = nullable(raw.field ?? raw.property);
  const net = nullable(raw.net);
  return {
    id,
    kind,
    category,
    event: isEmpty(rawEvent) ? null : String(rawEvent),
    event_types: types,
    entity: entity === null ? null : String(entity),
    component: raw.component === undefined || raw.component === null ? null : String(raw.component),
    field: field === null ? null : String(field),
    net: net === null ? null : String(net),
    selector_source: resolved?.selector_source ?? (entity === null ? null : { entity }),
    resolved_identity: resolved?.resolved_identity ?? null,
    resolved_label: resolved?.resolved_label ?? null,
    match_method: resolved?.match_method ?? null,
    match_key: resolved?.match_key ?? null,
  };
}

function identityScopeOverlap(a, b) {
  const ai = a.resolved_identity;
  const bi = b.resolved_identity;
  if (ai && bi) {
    const uniqueEqual = ai.unique_id && bi.unique_id && ai.unique_id === bi.unique_id;
    const primitiveEqual = ai.primitive_id && bi.primitive_id && ai.primitive_id === bi.primitive_id;
    return Boolean(uniqueEqual || primitiveEqual);
  }
  if (ai || bi) {
    const resolved = ai || bi;
    const raw = ai ? b.entity : a.entity;
    if (isEmpty(raw)) return true;
    return [resolved.unique_id, resolved.primitive_id, resolved.designator, resolved.key].filter(Boolean).includes(String(raw));
  }
  return isEmpty(a.entity) || isEmpty(b.entity) || a.entity === b.entity;
}

function selectorOverlap(a, b) {
  const categories = (rule) => {
    if (rule.category) return new Set([rule.category]);
    if (rule.event_types.length) return new Set(rule.event_types.map((type) => EVENT_CATEGORY[type]).filter(Boolean));
    if (rule.field) return new Set(['properties', 'bom']);
    return null;
  };
  const categoriesA = categories(a);
  const categoriesB = categories(b);
  if (categoriesA && categoriesB && ![...categoriesA].some((category) => categoriesB.has(category))) return false;
  if (a.event_types.length && b.event_types.length && !a.event_types.some((type) => b.event_types.includes(type))) return false;
  if (a.event_types.length && !b.event_types.length && b.field && !a.event_types.some((type) => FIELD_EVENT_TYPES.has(type))) return false;
  if (b.event_types.length && !a.event_types.length && a.field && !b.event_types.some((type) => FIELD_EVENT_TYPES.has(type))) return false;
  if (!identityScopeOverlap(a, b)) return false;
  if (a.field && b.field && a.field !== b.field) return false;
  if (a.net && b.net && a.net !== b.net) return false;
  return true;
}

function selectorView(rule) {
  return {
    category: rule.category,
    event: rule.event,
    event_types: [...rule.event_types],
    entity: rule.entity,
    field: rule.field,
    net: rule.net,
  };
}

function declaredBaselineMatches(declared, observed, errors) {
  if (!isObject(declared)) return;
  for (const field of ['snapshot_hash', 'project_uuid', 'document_uuid', 'document_type', 'profile']) {
    if (!isEmpty(declared[field]) && declared[field] !== observed[field]) {
      errors.push(errorRecord('BASELINE_DECLARATION_MISMATCH', `Intent baseline ${field} does not match the supplied baseline.`, {
        field,
        declared: declared[field],
        observed: observed[field],
      }));
    }
  }
}

function defaultIntentId(input, baseline) {
  if (!isEmpty(input?.intent_id)) return String(input.intent_id);
  const seed = {
    description: input?.description ?? '',
    required: input?.required ?? [],
    allowed: input?.allowed ?? [],
    forbidden: input?.forbidden ?? [],
    baseline: { snapshot_hash: baseline.snapshot_hash, identity: baseline.identity, profile: baseline.profile },
  };
  return `intent-${hashObject(seed).slice(0, 16)}`;
}

/** Compile a user declaration against a trusted baseline before any edit. */
export function compileIntent(intentInput, baselineInput) {
  const input = isObject(intentInput) ? intentInput : {};
  const baselineInfo = unwrapBaseline(baselineInput);
  const errors = [...baselineInfo.errors];
  if (!isEmpty(input.schema) && input.schema !== INTENT_SCHEMA) errors.push(errorRecord('INVALID_INTENT_SCHEMA', `Expected ${INTENT_SCHEMA}.`));
  const description = text(input.description ?? '');
  const declaredBaseline = isObject(input.baseline) ? input.baseline : {};
  const observedBaseline = {
    snapshot_hash: baselineInfo.snapshot_hash,
    project_uuid: baselineInfo.identity.project_uuid,
    document_uuid: baselineInfo.identity.document_uuid,
    document_type: baselineInfo.identity.document_type,
    // A profile must come from the supplied capture envelope, never only from
    // a user declaration. Otherwise a bare snapshot could be mislabeled as a
    // Gate-A capture at compile time and fail only after an edit.
    profile: baselineInfo.profile ?? null,
  };
  declaredBaselineMatches(declaredBaseline, observedBaseline, errors);
  if (!observedBaseline.profile) errors.push(errorRecord('BASELINE_PROFILE_MISSING', 'Intent baseline must bind a snapshot profile.'));

  const defaultAction = String(input.default_action ?? (input.default_deny === false ? 'allow' : 'deny'));
  const defaultDeny = input.default_deny === undefined ? defaultAction === 'deny' : input.default_deny === true;
  if (defaultAction !== 'deny' || !defaultDeny) errors.push(errorRecord('DEFAULT_DENY_REQUIRED', 'Intent Lock requires default_action=deny and default_deny=true.'));

  const required = asArray(input.required).map((raw, index) => compileRule(raw, 'required', index, baselineInfo, errors));
  const allowed = asArray(input.allowed).map((raw, index) => compileRule(raw, 'allowed', index, baselineInfo, errors));
  const forbidden = asArray(input.forbidden).map((raw, index) => compileRule(raw, 'forbidden', index, baselineInfo, errors));
  const allRules = [...required, ...allowed, ...forbidden];
  const seenIds = new Map();
  for (const rule of allRules) {
    if (seenIds.has(rule.id)) errors.push(errorRecord('DUPLICATE_RULE_ID', `Rule ID ${rule.id} is used more than once.`, { rule_id: rule.id, first: seenIds.get(rule.id), second: rule.kind }));
    else seenIds.set(rule.id, rule.kind);
  }
  for (const left of [...allowed, ...required]) {
    for (const right of forbidden) {
      if (!selectorOverlap(left, right)) continue;
      errors.push(errorRecord('POLICY_CONFLICT', `Rule ${left.id} (${left.kind}) overlaps forbidden rule ${right.id}.`, {
        allow_or_required_rule_id: left.id,
        forbidden_rule_id: right.id,
      }));
    }
  }

  const valid = errors.length === 0;
  return {
    schema: INTENT_SCHEMA,
    schema_version: INTENT_SCHEMA_VERSION,
    intent_id: defaultIntentId(input, observedBaseline),
    description,
    compiled: valid,
    valid,
    default_action: 'deny',
    default_deny: true,
    baseline: observedBaseline,
    required,
    allowed,
    forbidden,
    errors,
    warnings: [],
  };
}

function eventIdentityCandidates(event) {
  const candidates = [];
  for (const value of [event?.identity, event?.component_identity, event?.identity_before, event?.identity_after]) {
    if (isObject(value)) candidates.push(value);
  }
  const member = event?.member;
  if (isObject(member)) {
    candidates.push({
      unique_id: member.component_unique_id,
      primitive_id: member.component_primitive_id,
      designator: member.designator,
      key: member.component_identity,
    });
  }
  if (event?.component_unique_id || event?.component_primitive_id) {
    candidates.push({ unique_id: event.component_unique_id, primitive_id: event.component_primitive_id });
  }
  return candidates;
}

function eventEntityValues(event) {
  const values = new Set();
  for (const value of [event?.entity, event?.member?.component, event?.member?.designator]) if (!isEmpty(value)) values.add(String(value));
  return values;
}

function eventNetValues(event) {
  const values = new Set();
  for (const value of [event?.net, event?.entity, event?.from_net, event?.to_net]) if (!isEmpty(value)) values.add(String(value));
  return values;
}

function identityMatches(rule, event) {
  if (!rule.resolved_identity) return eventEntityValues(event).has(String(rule.entity));
  if (event?.match_method && event?.match_key && rule.resolved_identity[event.match_method] && String(rule.resolved_identity[event.match_method]) === String(event.match_key)) return true;
  for (const candidate of eventIdentityCandidates(event)) {
    if (rule.resolved_identity.unique_id && candidate.unique_id && String(rule.resolved_identity.unique_id) === String(candidate.unique_id)) return true;
    if (rule.resolved_identity.primitive_id && candidate.primitive_id && String(rule.resolved_identity.primitive_id) === String(candidate.primitive_id)) return true;
    if (rule.resolved_identity.key && candidate.key && String(rule.resolved_identity.key) === String(candidate.key)) return true;
  }
  return false;
}

function ruleMatches(rule, event) {
  if (rule.category && rule.category !== event?.category) return false;
  if (rule.event_types.length && !rule.event_types.includes(event?.type)) return false;
  if (rule.field && String(rule.field) !== String(event?.property ?? event?.field ?? '')) return false;
  if (rule.net && !eventNetValues(event).has(String(rule.net))) return false;
  if (rule.entity && !identityMatches(rule, event)) return false;
  return true;
}

function emptySummary() {
  return { allowed: 0, denied: 0, unexpected: 0, missing_required: 0 };
}

function baseResult(intent, status, { valid = true, baselineMatch = false, baseline = null, errors = [], warnings = [], diff = null } = {}) {
  return {
    schema: INTENT_RESULT_SCHEMA,
    schema_version: INTENT_SCHEMA_VERSION,
    intent_id: intent?.intent_id ?? null,
    description: intent?.description ?? '',
    status,
    valid,
    passed: false,
    baseline_match: baselineMatch,
    baseline,
    diff: diff ? { before_hash: diff.before_hash ?? null, after_hash: diff.after_hash ?? null, schema: diff.schema ?? null } : null,
    summary: emptySummary(),
    required_results: [],
    decisions: [],
    violations: [],
    missing_required: [],
    errors,
    warnings,
  };
}

/** Verify a compiled intent against a Semantic Diff, or compute the diff from before/after inputs. */
export function verifyIntent(compiledIntent, beforeOrDiff, afterInput) {
  const intent = isObject(compiledIntent) ? compiledIntent : {};
  const policyErrors = [];
  if (intent.schema !== INTENT_SCHEMA) policyErrors.push(errorRecord('INVALID_INTENT_SCHEMA', `Expected compiled ${INTENT_SCHEMA}.`));
  if (intent.valid === false || intent.compiled === false || asArray(intent.errors).length) policyErrors.push(...asArray(intent.errors));
  if (intent.default_action !== 'deny' || intent.default_deny !== true) policyErrors.push(errorRecord('DEFAULT_DENY_REQUIRED', 'Compiled intent is not default-deny.'));
  if (!isObject(intent.baseline) || !intent.baseline.snapshot_hash || !intent.baseline.project_uuid || !intent.baseline.document_uuid || !intent.baseline.profile) {
    policyErrors.push(errorRecord('COMPILED_BASELINE_MISSING', 'Compiled intent baseline binding is incomplete.'));
  }
  if (policyErrors.length) return baseResult(intent, 'INVALID_POLICY', { valid: false, errors: policyErrors });

  let diff;
  if (afterInput === undefined && isObject(beforeOrDiff) && beforeOrDiff.schema === SEMANTIC_DIFF_SCHEMA) diff = beforeOrDiff;
  else if (afterInput !== undefined) diff = semanticDiff(beforeOrDiff, afterInput);
  else {
    return baseResult(intent, 'INVALID_DIFF', { valid: false, errors: [errorRecord('DIFF_INPUT_MISSING', 'Verify requires a Semantic Diff or before/after snapshots.')] });
  }
  if (!diff?.valid) return baseResult(intent, 'INVALID_DIFF', { valid: false, diff, errors: [errorRecord('INVALID_DIFF', 'Semantic Diff is invalid or fail-closed.', { diff_errors: diff?.errors || [] })] });

  const observedIdentity = diff.identity?.before || {};
  const observedProfile = diff.profiles?.before ?? null;
  const observedBaseline = {
    snapshot_hash: diff.before_hash ?? null,
    project_uuid: observedIdentity.project_uuid ?? null,
    document_uuid: observedIdentity.document_uuid ?? null,
    document_type: observedIdentity.document_type ?? 'unknown',
    profile: observedProfile,
  };
  const baselineMismatches = [];
  for (const field of ['snapshot_hash', 'project_uuid', 'document_uuid', 'document_type', 'profile']) {
    if (intent.baseline[field] !== observedBaseline[field]) baselineMismatches.push(field);
  }
  if (baselineMismatches.length) {
    return baseResult(intent, 'BASELINE_MISMATCH', {
      valid: false,
      baselineMatch: false,
      baseline: { expected: intent.baseline, observed: observedBaseline, mismatched_fields: baselineMismatches },
      diff,
      errors: [errorRecord('INTENT_BASELINE_MISMATCH', 'Diff before snapshot does not match the compiled intent baseline.', { mismatched_fields: baselineMismatches })],
    });
  }

  const result = baseResult(intent, 'FAIL', {
    baselineMatch: true,
    baseline: { expected: intent.baseline, observed: observedBaseline, mismatched_fields: [] },
    diff,
    warnings: asArray(diff.warnings).map((warning) => String(warning)),
  });
  const required = asArray(intent.required);
  const allowed = asArray(intent.allowed);
  const forbidden = asArray(intent.forbidden);
  const requiredMatches = new Map(required.map((rule) => [rule.id, []]));
  const decisions = [];
  for (const [index, event] of asArray(diff.changes).entries()) {
    const eventId = event.event_id || `EVT-${String(index + 1).padStart(3, '0')}`;
    const forbiddenMatches = forbidden.filter((rule) => ruleMatches(rule, event));
    const requiredMatchesForEvent = required.filter((rule) => ruleMatches(rule, event));
    const allowedMatches = allowed.filter((rule) => ruleMatches(rule, event));
    for (const rule of requiredMatchesForEvent) requiredMatches.get(rule.id)?.push(eventId);
    let decision = 'UNEXPECTED';
    let reason = 'DEFAULT_DENY';
    let priorityMatches = [...requiredMatchesForEvent, ...allowedMatches];
    if (forbiddenMatches.length) {
      decision = 'DENIED';
      reason = 'FORBIDDEN_RULE';
      priorityMatches = forbiddenMatches;
    } else if (priorityMatches.length) {
      decision = 'ALLOWED';
      reason = requiredMatchesForEvent.length ? 'REQUIRED_OR_ALLOWED_RULE' : 'ALLOWED_RULE';
    }
    const matchedRuleIds = [...new Set([...forbiddenMatches, ...requiredMatchesForEvent, ...allowedMatches].map((rule) => rule.id))];
    decisions.push({
      event_id: eventId,
      event_index: index,
      type: event.type,
      category: event.category,
      entity: event.entity,
      decision,
      reason,
      matched_rule_id: priorityMatches[0]?.id ?? null,
      matched_rule_ids: matchedRuleIds,
      event,
    });
  }
  const missingRequired = required.filter((rule) => !(requiredMatches.get(rule.id) || []).length).map((rule) => ({
    rule_id: rule.id,
    selector: selectorView(rule),
    reason: 'REQUIRED_CHANGE_MISSING',
  }));
  const requiredResults = required.map((rule) => {
    const matchedEventIds = requiredMatches.get(rule.id) || [];
    return { rule_id: rule.id, selector: selectorView(rule), status: matchedEventIds.length ? 'PASS' : 'MISSING', matched_event_ids: matchedEventIds };
  });
  result.decisions = decisions;
  result.required_results = requiredResults;
  result.missing_required = missingRequired;
  result.violations = decisions.filter((decision) => decision.decision !== 'ALLOWED').map((decision) => ({
    event_id: decision.event_id,
    decision: decision.decision,
    reason: decision.reason,
    matched_rule_id: decision.matched_rule_id,
    event: decision.event,
  }));
  result.summary = {
    allowed: decisions.filter((decision) => decision.decision === 'ALLOWED').length,
    denied: decisions.filter((decision) => decision.decision === 'DENIED').length,
    unexpected: decisions.filter((decision) => decision.decision === 'UNEXPECTED').length,
    missing_required: missingRequired.length,
  };
  result.summary.total_events = decisions.length;
  result.passed = result.baseline_match && result.violations.length === 0 && missingRequired.length === 0;
  result.status = result.passed ? 'PASS' : 'FAIL';
  return result;
}

function shortHash(value) {
  if (isEmpty(value)) return 'EMPTY';
  const valueText = String(value);
  return valueText.length > 16 ? `${valueText.slice(0, 16)}...` : valueText;
}

function displayValue(value) {
  if (isEmpty(value)) return 'EMPTY';
  if (isObject(value) || Array.isArray(value)) return stableStringify(value);
  return String(value);
}

function eventDisplay(event) {
  if (!event) return 'UNKNOWN EVENT';
  const entity = event.entity || event.member?.component || 'UNKNOWN_ENTITY';
  switch (event.type) {
    case 'component_moved': return `${entity} moved`;
    case 'component_rotated': return `${entity} rotated`;
    case 'component_added': return `${entity} added`;
    case 'component_removed': return `${entity} removed`;
    case 'property_changed': return `${entity}.${event.property} ${displayValue(event.before)} → ${displayValue(event.after)}`;
    case 'bom_supplier_id_changed': return `${entity}.supplierId ${displayValue(event.before)} → ${displayValue(event.after)}`;
    case 'bom_property_changed': return `${entity}.${event.property} ${displayValue(event.before)} → ${displayValue(event.after)}`;
    case 'bom_item_added': return `${entity} BOM item added`;
    case 'bom_item_removed': return `${entity} BOM item removed`;
    case 'connectivity_member_removed': return `${event.net || entity} removed ${event.member?.component || entity}.${event.member?.pin || 'UNKNOWN_PIN'}`;
    case 'connectivity_member_added': return `${event.net || entity} added ${event.member?.component || entity}.${event.member?.pin || 'UNKNOWN_PIN'}`;
    case 'pin_reassigned': return `${event.member?.component || entity}.${event.member?.pin || 'UNKNOWN_PIN'} ${event.from_net || 'EMPTY'} → ${event.to_net || 'EMPTY'}`;
    case 'connectivity_net_added': return `${entity} net added`;
    case 'connectivity_net_removed': return `${entity} net removed`;
    case 'routing_changed': return `${entity} routing changed`;
    default: return `${entity} ${String(event.type || 'event').replaceAll('_', ' ')}`;
  }
}

function selectorDisplay(selector) {
  const parts = [];
  if (selector?.event) parts.push(selector.event);
  if (selector?.entity) parts.push(selector.entity);
  if (selector?.field) parts.push(selector.field);
  if (selector?.net) parts.push(selector.net);
  return parts.join(' / ') || 'required change';
}

/** Render verification without changing the machine result. */
export function renderIntentResult(result) {
  const lines = ['EDA-GUARD INTENT LOCK', ''];
  if (!result?.valid) {
    lines.push(result?.status === 'BASELINE_MISMATCH' ? 'INTENT BASELINE MISMATCH' : 'INVALID INTENT VERIFICATION', '');
    for (const error of result?.errors || [{ message: 'Unknown intent verification error.' }]) lines.push(`- ${error.message || error}`);
    lines.push('', 'INTENT VERIFICATION: FAIL');
    return lines.join('\n');
  }
  lines.push(`Intent: ${result.description || result.intent_id || 'unnamed intent'}`);
  lines.push(`Baseline: ${shortHash(result.baseline?.expected?.snapshot_hash)}`, '');
  lines.push('REQUIRED CHANGES', '');
  if (!result.required_results?.length) lines.push('NONE', '');
  else {
    for (const required of result.required_results) {
      const matched = (required.matched_event_ids || []).map((id) => result.decisions.find((decision) => decision.event_id === id)).filter(Boolean);
      lines.push(required.status === 'PASS' ? 'PASS' : 'FAIL');
      lines.push(matched[0] ? eventDisplay(matched[0].event) : selectorDisplay(required.selector));
      lines.push(required.status === 'PASS' ? `matched: ${required.rule_id}` : 'Reason: REQUIRED_CHANGE_MISSING', '');
    }
  }
  const requiredEventIds = new Set(result.required_results.flatMap((item) => item.matched_event_ids || []));
  const allowed = result.decisions.filter((decision) => decision.decision === 'ALLOWED' && !requiredEventIds.has(decision.event_id));
  if (allowed.length) {
    lines.push('ALLOWED CHANGES', '');
    for (const decision of allowed) lines.push('PASS', eventDisplay(decision.event), `matched: ${decision.matched_rule_id || 'rule'}`, '');
  }
  const violations = result.decisions.filter((decision) => decision.decision !== 'ALLOWED');
  if (violations.length) {
    lines.push('UNEXPECTED CHANGES', '');
    for (const decision of violations) {
      lines.push('FAIL', eventDisplay(decision.event));
      lines.push(`Reason: ${decision.reason === 'FORBIDDEN_RULE' ? 'forbidden change' : 'DEFAULT_DENY'}`);
      if (decision.matched_rule_id) lines.push(`matched: ${decision.matched_rule_id}`);
      lines.push('');
    }
  }
  lines.push('SUMMARY', '');
  lines.push(`Allowed changes:       ${result.summary.allowed}`);
  lines.push(`Forbidden changes:     ${result.summary.denied}`);
  lines.push(`Unexpected changes:    ${result.summary.unexpected}`);
  lines.push(`Missing requirements:  ${result.summary.missing_required}`, '');
  lines.push(`INTENT VERIFICATION: ${result.passed ? 'PASS' : 'FAIL'}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function renderIntentCompile(compiled, outputPath = null) {
  const lines = [`INTENT COMPILE: ${compiled?.valid ? 'PASS' : 'FAIL'}`, ''];
  lines.push(`Intent: ${compiled?.description || compiled?.intent_id || 'unnamed intent'}`);
  lines.push(`Baseline: ${shortHash(compiled?.baseline?.snapshot_hash)}`);
  lines.push(`Resolved selectors: ${[...(compiled?.required || []), ...(compiled?.allowed || []), ...(compiled?.forbidden || [])].filter((rule) => rule.resolved_identity).length}`);
  if (outputPath) lines.push(`Wrote: ${outputPath}`);
  if (!compiled?.valid) {
    lines.push('', 'Errors:');
    for (const error of compiled?.errors || []) lines.push(`- ${error.message || error}`);
  }
  return lines.join('\n');
}

export function intentHash(value) {
  return hashObject(value);
}
