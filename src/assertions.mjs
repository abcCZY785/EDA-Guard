import { hashObject, stableStringify } from './hash.mjs';

/**
 * Hardware Assertions are deliberately an offline consumer of a Gate-A
 * capture.  This module never talks to EasyEDA, the Bridge, or a raw facet.
 */
export const ASSERTIONS_SCHEMA = 'edaguard.assertions.v1';
export const ASSERTION_RESULT_SCHEMA = 'edaguard.assertion-result.v1';
export const ASSERTIONS_SCHEMA_VERSION = '0.1.0';

const SUPPORTED_TYPES = new Set([
  'component_exists',
  'component_not_exists',
  'property_present',
  'property_equals',
  'property_matches',
  'valid_lcsc_id',
  'footprint_present',
  'bom_field_present',
  'net_exists',
  'net_contains',
  'net_not_contains',
  'pin_connected',
  'pins_same_net',
  'pins_different_net',
  'component_distance',
  'component_near_board_edge',
  'component_count',
]);

const SEVERITIES = new Set(['INFO', 'WARNING', 'ERROR', 'CRITICAL']);
const SAFE_REGEX_FLAGS = new Set(['i', 'm', 's', 'u']);
const FACET_OK = new Set(['ok', 'verified_empty']);
const FACET_BAD = new Set(['unsupported', 'error']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return value === null || value === undefined ? '' : String(value);
}

function present(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.values(value).some((item) => present(item));
  return true;
}

function errorRecord(code, message, details = {}) {
  return { code, message, ...details };
}

function identityOf(component) {
  const identity = component?.identity || {};
  return {
    key: identity.key ?? component?.key ?? null,
    unique_id: identity.unique_id ?? identity.uniqueId ?? component?.unique_id ?? component?.uniqueId ?? null,
    primitive_id: identity.primitive_id ?? identity.primitiveId ?? component?.primitive_id ?? component?.primitiveId ?? null,
    designator: identity.designator ?? component?.designator ?? null,
  };
}

function identityValue(component, field) {
  const value = identityOf(component)[field];
  return value === null || value === undefined ? null : String(value);
}

function componentLabel(component) {
  const id = identityOf(component);
  return id.designator || id.unique_id || id.primitive_id || id.key || 'UNKNOWN_COMPONENT';
}

function shortHash(value) {
  if (!value) return 'MISSING';
  const valueText = String(value);
  return valueText.length > 16 ? `${valueText.slice(0, 16)}...` : valueText;
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return 'EMPTY';
  if (isObject(value) || Array.isArray(value)) return stableStringify(value);
  return String(value);
}

function identityComparable(snapshot) {
  return {
    project_uuid: snapshot?.identity?.project_uuid ?? null,
    document_uuid: snapshot?.identity?.document_uuid ?? null,
    document_type: snapshot?.identity?.document_type ?? 'unknown',
  };
}

function unwrapCapture(input) {
  const envelope = isObject(input) && isObject(input.snapshot) ? input : null;
  // A test fixture may put valid_snapshot alongside the canonical snapshot.
  // A bare canonical snapshot without that explicit attestation is rejected.
  const snapshot = envelope ? envelope.snapshot : (isObject(input) && input.valid_snapshot === true ? input : null);
  const validity = envelope ? (isObject(envelope.validity) ? envelope.validity : {}) : (snapshot ? { valid_snapshot: snapshot.valid_snapshot === true } : {});
  const errors = [];
  if (!snapshot) errors.push(errorRecord('INVALID_CAPTURE_ENVELOPE', 'Hardware Assertions require a capture envelope with snapshot and validity.'));
  if (validity.valid_snapshot !== true) errors.push(errorRecord('INVALID_SNAPSHOT', 'Capture validity.valid_snapshot is not true.'));
  if (!snapshot?.snapshot_hash) errors.push(errorRecord('SNAPSHOT_HASH_MISSING', 'Canonical snapshot_hash is missing.'));
  const identity = identityComparable(snapshot);
  if (!identity.project_uuid || !identity.document_uuid || !['pcb', 'schematic'].includes(identity.document_type)) {
    errors.push(errorRecord('SNAPSHOT_IDENTITY_MISSING', 'Canonical project/document identity is incomplete or document type is unknown.'));
  }
  return { envelope, snapshot, validity, identity, errors };
}

function facetStatus(info, names, data = undefined) {
  const statuses = info?.validity?.facet_status || {};
  const rawFacets = info?.envelope?.raw?.facets || {};
  let sawBad = null;
  let sawGood = null;
  for (const name of names) {
    const value = statuses[name] || rawFacets[name];
    const status = typeof value === 'string' ? value : value?.status;
    if (FACET_BAD.has(status)) sawBad = status;
    if (FACET_OK.has(status)) sawGood = status;
  }
  if (sawBad) return { status: sawBad, available: false, names };
  if (sawGood) return { status: sawGood, available: true, names };
  if (data !== undefined) {
    if (Array.isArray(data)) return { status: data.length ? 'ok' : 'verified_empty', available: true, names };
    if (data !== null && data !== undefined) return { status: 'ok', available: true, names };
  }
  return { status: 'missing', available: false, names };
}

function componentFacet(info) {
  return facetStatus(info, ['pcb_components', 'schematic_components', 'components'], info?.snapshot?.components);
}

function bomFacet(info) {
  return facetStatus(info, ['bom', 'pcb_components', 'schematic_components'], info?.snapshot?.bom);
}

function connectivityFacet(info) {
  const connectivity = info?.snapshot?.connectivity;
  const selected = preferredConnectivity(info?.snapshot).nets;
  return facetStatus(info, ['manufacture_nets', 'pcb_nets', 'schematic_nets', 'connectivity'], selected ?? connectivity);
}

function geometryFacet(info) {
  const geometry = info?.snapshot?.geometry;
  return facetStatus(info, ['pcb_polylines', 'pcb_lines', 'board_outline', 'geometry'], geometry?.board_outline);
}

function preferredConnectivity(snapshot) {
  const connectivity = isObject(snapshot?.connectivity) ? snapshot.connectivity : {};
  const source = connectivity.preferred_source || null;
  const sourceMap = {
    manufacture_netlist: 'manufacture_nets',
    manufacture: 'manufacture_nets',
    pcb_api: 'pcb_nets',
    schematic_api: 'direct_nets',
    direct_api: 'direct_nets',
    direct: 'direct_nets',
  };
  const selectedName = sourceMap[source] || (asArray(connectivity.manufacture_nets).length ? 'manufacture_nets'
    : (asArray(connectivity.pcb_nets).length ? 'pcb_nets' : (asArray(connectivity.direct_nets).length ? 'direct_nets' : null)));
  const nets = selectedName ? asArray(connectivity[selectedName]) : [];
  const hasMembers = nets.some((net) => netMembers(net).length > 0);
  // The canonical Diff contract permits the same conservative, offline
  // derivation used for a PCB net-name source: pad net/number plus a unique
  // component primitive prefix can supply membership evidence. This never
  // consults a second runtime/API source and remains bound to the preferred
  // PCB net source.
  if (!hasMembers && selectedName === 'pcb_nets' && nets.length) {
    const components = asArray(snapshot?.components);
    const byPrimitive = new Map(components.map((component) => [identityValue(component, 'primitive_id'), component]).filter(([key]) => key));
    const grouped = new Map(nets.map((net) => [String(netName(net) ?? '<unnamed-net>'), { name: String(netName(net) ?? '<unnamed-net>'), pins: [] }]));
    for (const pad of asArray(snapshot?.pads)) {
      const padNet = pad?.net === null || pad?.net === undefined ? null : String(pad.net);
      if (!padNet) continue;
      if (!grouped.has(padNet)) grouped.set(padNet, { name: padNet, pins: [] });
      let component = byPrimitive.get(pad?.component_primitive_id ? String(pad.component_primitive_id) : '');
      if (!component && pad?.primitive_id) {
        const candidates = components.filter((item) => {
          const primitive = identityValue(item, 'primitive_id');
          return primitive && String(pad.primitive_id).startsWith(primitive);
        });
        if (candidates.length === 1) component = candidates[0];
      }
      const id = component ? identityOf(component) : {};
      grouped.get(padNet).pins.push({
        component_identity: id.unique_id || id.primitive_id || id.designator || null,
        designator: id.designator || null,
        pin: pad?.number ?? pad?.pad_number ?? pad?.padNumber ?? null,
        pin_name: pad?.name ?? pad?.pin_name ?? pad?.pinName ?? null,
      });
    }
    return { source, selectedName, source_detail: 'pads_derived', nets: [...grouped.values()] };
  }
  return { source, selectedName, source_detail: 'native', nets };
}

function selectorParts(selector) {
  if (isObject(selector)) {
    return Object.fromEntries(['unique_id', 'uniqueId', 'primitive_id', 'primitiveId', 'designator', 'key']
      .filter((key) => selector[key] !== undefined && selector[key] !== null && String(selector[key]).trim() !== '')
      .map((key) => [key.replace('uniqueId', 'unique_id').replace('primitiveId', 'primitive_id'), String(selector[key])]));
  }
  if (selector === null || selector === undefined || String(selector).trim() === '') return {};
  return { query: String(selector) };
}

function resolveComponent(selector, snapshot) {
  const parts = selectorParts(selector);
  const components = asArray(snapshot?.components);
  if (!Object.keys(parts).length) return { state: 'unresolved', selector: selector ?? null, candidates: [] };
  const candidates = components.map((component, index) => ({ component, index })).filter(({ component }) => {
    const id = identityOf(component);
    if (parts.query) return ['unique_id', 'primitive_id', 'designator', 'key'].some((field) => String(id[field] ?? '') === parts.query);
    return Object.entries(parts).every(([field, value]) => String(id[field] ?? '') === String(value));
  });
  const source = isObject(selector) ? { ...parts } : String(selector);
  if (candidates.length === 0) return { state: 'unresolved', selector: source, candidates: [] };
  if (candidates.length > 1) {
    return {
      state: 'ambiguous',
      selector: source,
      candidates: candidates.map(({ component }) => identityOf(component)),
    };
  }
  const candidate = candidates[0];
  const id = identityOf(candidate.component);
  const matchMethod = parts.query
    ? ['unique_id', 'primitive_id', 'designator', 'key'].find((field) => String(id[field] ?? '') === parts.query) || 'key'
    : Object.keys(parts)[0];
  return {
    state: 'resolved',
    selector: source,
    index: candidate.index,
    component: candidate.component,
    resolved_identity: id,
    resolved_label: componentLabel(candidate.component),
    match_method: matchMethod,
    match_key: String(id[matchMethod] ?? parts.query ?? ''),
  };
}

function selectorForRule(rule) {
  return rule.component ?? rule.entity ?? rule.selector ?? rule.target_component ?? null;
}

function normalizeField(field) {
  const aliases = {
    supplier: 'supplier',
    supplier_id: 'supplier_id',
    supplierid: 'supplier_id',
    lcsc: 'supplier_id',
    lcsc_id: 'supplier_id',
    manufacturer: 'manufacturer',
    manufacturer_id: 'manufacturer_id',
    manufacturerid: 'manufacturer_id',
    footprint: 'footprint_name',
    footprint_name: 'footprint_name',
    footprint_uuid: 'footprint_uuid',
    value: 'value',
    name: 'name',
    designator: 'designator',
    unique_id: 'unique_id',
    primitive_id: 'primitive_id',
    key: 'key',
  };
  const key = String(field ?? '');
  return aliases[key.toLowerCase()] || key;
}

function componentProperty(component, field) {
  const normalized = normalizeField(field);
  const id = identityOf(component);
  if (Object.hasOwn(id, normalized)) return id[normalized];
  if (normalized === 'footprint_name') return component?.footprint_name ?? component?.footprint?.name ?? null;
  if (normalized === 'footprint_uuid') return component?.footprint_uuid ?? component?.footprint?.uuid ?? null;
  if (normalized === 'supplier_id') return component?.supplier_id ?? component?.supplierId ?? null;
  if (normalized === 'manufacturer_id') return component?.manufacturer_id ?? component?.manufacturerId ?? null;
  if (normalized === 'supplier') return component?.supplier ?? component?.supplier_name ?? null;
  if (normalized === 'manufacturer') return component?.manufacturer ?? component?.manufacturer_name ?? null;
  if (Object.hasOwn(component || {}, normalized)) return component[normalized];
  if (normalized === 'name' || normalized === 'value') return component?.[normalized] ?? null;
  const other = component?.other_property ?? component?.otherProperty ?? {};
  const exact = Object.keys(other).find((key) => key.toLowerCase() === String(field ?? '').toLowerCase());
  return exact ? other[exact] : null;
}

function normalizeExpected(rule) {
  if (rule.expected !== undefined) return rule.expected;
  if (rule.value !== undefined && !['property_equals', 'property_matches'].includes(rule.type)) return rule.value;
  return rule.value !== undefined ? rule.value : null;
}

function compileRegex(rule, errors, context) {
  const raw = rule.pattern ?? rule.regex ?? rule.expected;
  const pattern = isObject(raw) ? raw.pattern : raw;
  const flags = isObject(raw) ? (raw.flags ?? '') : (rule.flags ?? '');
  if (typeof pattern !== 'string' || pattern.length > 256) {
    errors.push(errorRecord('INVALID_REGEX', `${context} requires a bounded string pattern.`));
    return null;
  }
  if ([...String(flags)].some((flag) => !SAFE_REGEX_FLAGS.has(flag)) || new Set(String(flags)).size !== String(flags).length) {
    errors.push(errorRecord('UNSAFE_REGEX_FLAGS', `${context} uses unsupported or duplicate regex flags.`));
    return null;
  }
  try {
    // RegExp is the only evaluator permitted here; no JavaScript expression is accepted.
    return { pattern, flags: String(flags), source: new RegExp(pattern, flags).source };
  } catch (error) {
    errors.push(errorRecord('INVALID_REGEX', `${context} has an invalid regular expression: ${error.message}`));
    return null;
  }
}

function normalizeDistance(rule) {
  const raw = rule.max_nm ?? rule.max_distance_nm ?? rule.limit_nm ?? rule.max ?? rule.threshold_nm;
  const mm = rule.max_mm ?? rule.limit_mm;
  const value = mm !== undefined ? Number(mm) * 1_000_000 : Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function normalizeRule(raw, index, snapshot, errors) {
  const context = `rules[${index}]`;
  if (!isObject(raw)) {
    errors.push(errorRecord('INVALID_RULE', `${context} must be an object.`, { context }));
    return { id: `HW-${String(index + 1).padStart(3, '0')}`, type: null, description: '', severity: 'ERROR', compile_resolution: 'invalid' };
  }
  const type = text(raw.type || raw.assertion || raw.rule_type).trim();
  const id = text(raw.id || raw.rule_id || `HW-${String(index + 1).padStart(3, '0')}`).trim();
  const severity = text(raw.severity || 'ERROR').toUpperCase();
  if (!SUPPORTED_TYPES.has(type)) errors.push(errorRecord('UNSUPPORTED_ASSERTION_TYPE', `Unsupported hardware assertion type: ${type || '(empty)'}.`, { rule_id: id, type }));
  if (!SEVERITIES.has(severity)) errors.push(errorRecord('INVALID_SEVERITY', `Invalid severity for ${id}: ${severity}.`, { rule_id: id, severity }));
  const rule = {
    id,
    type,
    description: text(raw.description || raw.message || id),
    severity: SEVERITIES.has(severity) ? severity : 'ERROR',
    component: raw.component ?? raw.entity ?? raw.selector ?? raw.target_component ?? null,
    component_a: raw.component_a ?? raw.from ?? raw.source ?? raw.first ?? raw.a ?? null,
    component_b: raw.component_b ?? raw.to ?? raw.target ?? raw.second ?? raw.b ?? null,
    pin_a: raw.pin_a ?? raw.first_pin_number ?? null,
    pin_b: raw.pin_b ?? raw.second_pin_number ?? null,
    property: raw.property ?? raw.field ?? null,
    expected: normalizeExpected(raw),
    pattern: raw.pattern ?? raw.regex ?? null,
    flags: raw.flags ?? '',
    supplier: raw.supplier ?? null,
    field: raw.field ?? raw.property ?? null,
    net: raw.net ?? raw.net_name ?? null,
    member: raw.member ?? null,
    pin: raw.pin ?? raw.pin_number ?? raw.number ?? null,
    max_nm: normalizeDistance(raw),
    exact: raw.exact ?? raw.equals ?? raw.count ?? raw.expected_count ?? null,
    min: raw.min ?? raw.minimum ?? null,
    max: raw.max_count ?? raw.maximum ?? (type === 'component_count' ? raw.max : null),
    source_rule: raw,
    compile_resolution: 'none',
  };
  if (type === 'property_matches') rule.regex = compileRegex(raw, errors, context);
  if (type === 'component_distance' && (!rule.component_a || !rule.component_b || rule.max_nm === null)) {
    errors.push(errorRecord('INVALID_DISTANCE_RULE', `${context} requires component_a, component_b, and integer max_nm (or max_mm).`, { rule_id: id }));
  }
  if (type === 'component_distance' && raw.max_nm !== undefined && !Number.isInteger(Number(raw.max_nm))) {
    errors.push(errorRecord('INVALID_DISTANCE_RULE', `${context}.max_nm must be an integer number of nanometres.`, { rule_id: id }));
  }
  if (type === 'component_near_board_edge' && (!rule.component || rule.max_nm === null)) {
    errors.push(errorRecord('INVALID_EDGE_RULE', `${context} requires component and integer max_nm (or max_mm).`, { rule_id: id }));
  }
  if (type === 'component_count') {
    const expectedExact = rule.exact !== null && rule.exact !== undefined
      ? rule.exact
      : (typeof raw.expected === 'number' || typeof raw.expected === 'string' ? raw.expected : null);
    const exact = expectedExact !== null && expectedExact !== undefined ? Number(expectedExact) : null;
    const min = rule.min !== null && rule.min !== undefined ? Number(rule.min) : null;
    const max = rule.max !== null && rule.max !== undefined ? Number(rule.max) : null;
    rule.exact = Number.isInteger(exact) && exact >= 0 ? exact : null;
    rule.min = Number.isInteger(min) && min >= 0 ? min : null;
    rule.max = Number.isInteger(max) && max >= 0 ? max : null;
    if (rule.exact === null && rule.min === null && rule.max === null) errors.push(errorRecord('INVALID_COUNT_RULE', `${context} requires exact/equals, min, or max.`, { rule_id: id }));
  }
  const componentTypes = new Set(['component_exists', 'component_not_exists', 'property_present', 'property_equals', 'property_matches', 'valid_lcsc_id', 'footprint_present', 'bom_field_present', 'component_near_board_edge']);
  if (componentTypes.has(type)) {
    const resolved = resolveComponent(rule.component, snapshot);
    rule.compile_resolution = resolved.state;
    rule.selector = resolved.selector;
    rule.resolved_identity = resolved.resolved_identity ?? null;
    rule.resolved_label = resolved.resolved_label ?? null;
    rule.match_method = resolved.match_method ?? null;
    rule.match_key = resolved.match_key ?? null;
    rule.candidate_identities = resolved.candidates ?? [];
    if (!rule.component) errors.push(errorRecord('EMPTY_COMPONENT_SELECTOR', `${context} requires a component selector.`, { rule_id: id }));
    // Existence rules intentionally keep an unresolved selector for run-time
    // evaluation: absent component => FAIL/PASS is useful evidence. Ambiguity
    // is retained and becomes UNVERIFIABLE instead of guessing.
  }
  if (type === 'component_distance') {
    const first = resolveComponent(rule.component_a, snapshot);
    const second = resolveComponent(rule.component_b, snapshot);
    rule.component_a_resolution = serialiseResolution(first);
    rule.component_b_resolution = serialiseResolution(second);
  }
  if (['net_contains', 'net_not_contains', 'pin_connected'].includes(type)) {
    const endpoint = endpointFromRule(rule);
    if (endpoint) {
      const resolved = resolveComponent(endpoint.component, snapshot);
      rule.endpoint = { component: endpoint.component, pin: endpoint.pin, resolution: serialiseResolution(resolved) };
    }
  }
  if (['pins_same_net', 'pins_different_net'].includes(type)) {
    const endpointA = rule.component_a && rule.pin_a !== null ? { component: rule.component_a, pin: rule.pin_a } : (rule.component_a ?? raw.pin_a ?? raw.first_pin ?? raw.first_pin_number);
    const endpointB = rule.component_b && rule.pin_b !== null ? { component: rule.component_b, pin: rule.pin_b } : (rule.component_b ?? raw.pin_b ?? raw.second_pin ?? raw.second_pin_number);
    rule.endpoint_a = compileEndpoint(endpointA, snapshot);
    rule.endpoint_b = compileEndpoint(endpointB, snapshot);
  }
  return rule;
}

function serialiseResolution(resolution) {
  return {
    state: resolution?.state || 'unresolved',
    selector: resolution?.selector ?? null,
    resolved_identity: resolution?.resolved_identity ?? null,
    resolved_label: resolution?.resolved_label ?? null,
    match_method: resolution?.match_method ?? null,
    match_key: resolution?.match_key ?? null,
    candidates: resolution?.candidates ?? [],
  };
}

function endpointFromRule(rule) {
  let component = rule.component;
  let pin = rule.pin;
  const member = rule.member;
  if (isObject(member)) {
    component = member.component ?? member.designator ?? member.component_identity ?? component;
    pin = member.pin ?? member.pin_number ?? member.number ?? member.pad ?? member.pin_name ?? pin;
  } else if (typeof member === 'string' && member.includes('.')) {
    const split = member.split('.');
    component = component || split.shift();
    pin = pin || split.join('.');
  } else if (typeof member === 'string' && !component) {
    component = member;
  }
  return component && pin !== null && pin !== undefined && String(pin) !== '' ? { component, pin: String(pin) } : null;
}

function compileEndpoint(input, snapshot) {
  if (isObject(input) && (input.component || input.designator || input.component_identity)) {
    const component = input.component ?? input.designator ?? input.component_identity;
    const pin = input.pin ?? input.pin_number ?? input.number ?? input.pad ?? input.pin_name;
    const resolution = resolveComponent(component, snapshot);
    return { component, pin: pin === undefined ? null : String(pin), resolution: serialiseResolution(resolution) };
  }
  if (typeof input === 'string' && input.includes('.')) {
    const [component, ...rest] = input.split('.');
    const resolution = resolveComponent(component, snapshot);
    return { component, pin: rest.join('.'), resolution: serialiseResolution(resolution) };
  }
  return { component: input ?? null, pin: null, resolution: serialiseResolution(resolveComponent(input, snapshot)) };
}

function normaliseCompiledRule(rule) {
  const result = { ...rule };
  delete result.source_rule;
  return result;
}

/** Compile and bind selectors against a trusted capture, without touching EasyEDA. */
export function compileAssertions(input, targetInput) {
  const source = isObject(input) ? input : {};
  const target = unwrapCapture(targetInput);
  const errors = [...target.errors];
  if (source.schema && source.schema !== ASSERTIONS_SCHEMA) errors.push(errorRecord('INVALID_ASSERTIONS_SCHEMA', `Expected ${ASSERTIONS_SCHEMA}.`));
  const strict = source.strict === undefined ? true : source.strict === true;
  if (source.strict !== undefined && typeof source.strict !== 'boolean') errors.push(errorRecord('INVALID_STRICT', 'strict must be boolean.'));
  const rules = asArray(source.rules);
  const compiledRules = rules.map((rule, index) => normalizeRule(rule, index, target.snapshot, errors));
  const ids = new Set();
  for (const rule of compiledRules) {
    if (ids.has(rule.id)) errors.push(errorRecord('DUPLICATE_RULE_ID', `Rule ID ${rule.id} is used more than once.`, { rule_id: rule.id }));
    ids.add(rule.id);
  }
  const valid = errors.length === 0;
  const baseline = {
    snapshot_hash: target.snapshot?.snapshot_hash ?? null,
    ...target.identity,
    profile: target.envelope?.profile?.name ?? target.validity?.profile_name ?? null,
  };
  const compiled = {
    schema: ASSERTIONS_SCHEMA,
    schema_version: ASSERTIONS_SCHEMA_VERSION,
    name: text(source.name || source.description || 'Hardware Assertions'),
    description: text(source.description || source.name || 'Hardware Assertions'),
    strict,
    compiled: valid,
    valid,
    baseline,
    compiled_snapshot_hash: baseline.snapshot_hash,
    rules: compiledRules.map(normaliseCompiledRule),
    errors,
    warnings: [],
  };
  compiled.assertions_hash = hashObject({
    schema: compiled.schema,
    schema_version: compiled.schema_version,
    name: compiled.name,
    strict: compiled.strict,
    baseline,
    rules: compiled.rules,
  });
  return compiled;
}

function resolutionFromCompiled(snapshot, compiledResolution, selector) {
  if (compiledResolution?.state === 'ambiguous') return { ...compiledResolution, state: 'ambiguous' };
  if (compiledResolution?.state === 'resolved' && compiledResolution.resolved_identity) {
    const frozen = compiledResolution.resolved_identity;
    const candidates = asArray(snapshot?.components).map((component, index) => ({ component, index })).filter(({ component }) => {
      const id = identityOf(component);
      return [
        ['unique_id', frozen.unique_id],
        ['primitive_id', frozen.primitive_id],
        ['key', frozen.key],
      ].some(([field, value]) => present(value) && String(id[field] ?? '') === String(value));
    });
    if (candidates.length > 1) return { state: 'ambiguous', selector: compiledResolution.selector ?? selector, candidates: candidates.map(({ component }) => identityOf(component)) };
    if (candidates.length === 1) {
      const candidate = candidates[0];
      return {
        state: 'resolved',
        selector: compiledResolution.selector ?? selector,
        index: candidate.index,
        component: candidate.component,
        resolved_identity: identityOf(candidate.component),
        resolved_label: componentLabel(candidate.component),
        match_method: compiledResolution.match_method ?? 'unique_id',
        match_key: compiledResolution.match_key ?? frozen.unique_id ?? frozen.primitive_id ?? frozen.key ?? null,
      };
    }
    return { state: 'unresolved', selector: compiledResolution.selector ?? selector, candidates: [] };
  }
  return resolveComponent(selector, snapshot);
}

function resultRecord(rule, result, expected, actual, reason, evidence = {}, extra = {}) {
  return {
    rule_id: rule.id,
    type: rule.type,
    description: rule.description,
    severity: rule.severity,
    result,
    expected: expected ?? null,
    actual: actual ?? null,
    reason: reason || null,
    evidence: evidence || {},
    ...extra,
  };
}

function unresolvedOutcome(rule, resolution, expected, reason = 'Component identity cannot be resolved reliably.') {
  if (resolution?.state === 'ambiguous') return resultRecord(rule, 'UNVERIFIABLE', expected, null, reason, { selector: resolution.selector, candidates: resolution.candidates });
  return null;
}

function evaluateComponentRule(rule, snapshot, info) {
  const componentStatus = componentFacet(info);
  if (!componentStatus.available) return resultRecord(rule, 'UNVERIFIABLE', rule.expected, null, `Component facet is ${componentStatus.status}.`, { facet: componentStatus.names, facet_status: componentStatus.status });
  const resolution = resolutionFromCompiled(snapshot, {
    state: rule.compile_resolution,
    selector: rule.selector,
    candidates: rule.candidate_identities,
    resolved_identity: rule.resolved_identity,
    match_method: rule.match_method,
    match_key: rule.match_key,
  }, rule.component);
  if (resolution.state === 'ambiguous') return unresolvedOutcome(rule, resolution, rule.expected);
  const component = resolution.state === 'resolved' ? resolution.component : null;
  const label = component ? componentLabel(component) : text(rule.component || rule.selector || 'component');
  if (rule.type === 'component_exists') {
    return resultRecord(rule, component ? 'PASS' : 'FAIL', true, Boolean(component), component ? `${label} exists.` : `${label} is absent from the canonical component list.`, { facet: 'components', selector: resolution.selector, resolved_identity: resolution.resolved_identity });
  }
  if (rule.type === 'component_not_exists') {
    return resultRecord(rule, component ? 'FAIL' : 'PASS', false, Boolean(component), component ? `${label} unexpectedly exists.` : `${label} is absent as required.`, { facet: 'components', selector: resolution.selector, resolved_identity: resolution.resolved_identity });
  }
  if (!component) return resultRecord(rule, 'FAIL', rule.expected, null, `${label} is absent from the canonical component list.`, { facet: 'components', selector: resolution.selector });
  if (rule.type === 'valid_lcsc_id') {
    const bomItem = asArray(snapshot.bom).find((entry) => identityMatchesEntry(entry, component));
    const actual = componentProperty(component, 'supplier_id') || bomItem?.supplier_id || bomItem?.supplierId || null;
    const valid = /^C[0-9]+$/i.test(String(actual || ''));
    return resultRecord(rule, valid ? 'PASS' : 'FAIL', 'C<digits>', actual || null, valid ? `${label} has a valid LCSC ID.` : `${label} does not have a valid LCSC ID.`, { facet: 'bom', component: identityOf(component), source: 'canonical component/BOM supplier_id' });
  }
  if (rule.type === 'footprint_present') {
    const bomItem = asArray(snapshot.bom).find((entry) => identityMatchesEntry(entry, component));
    const actual = componentProperty(component, 'footprint_name') || componentProperty(component, 'footprint_uuid') || bomItem?.footprint_name || bomItem?.footprint_uuid || bomItem?.footprint?.name || bomItem?.footprint?.uuid || null;
    const valid = present(actual);
    return resultRecord(rule, valid ? 'PASS' : 'FAIL', 'non-empty footprint', actual || null, valid ? `${label} has a footprint.` : `${label} has no footprint.`, { facet: 'components', component: identityOf(component) });
  }
  if (rule.type === 'bom_field_present') {
    const status = bomFacet(info);
    if (!status.available) return resultRecord(rule, 'UNVERIFIABLE', rule.field, null, `BOM facet is ${status.status}.`, { facet: status.names, facet_status: status.status });
    const item = asArray(snapshot.bom).find((entry) => identityMatchesEntry(entry, component));
    const field = normalizeField(rule.field || rule.property || 'supplier_id');
    const actual = item ? bomProperty(item, field) : null;
    const valid = Boolean(item && present(actual));
    return resultRecord(rule, valid ? 'PASS' : 'FAIL', `BOM.${field} present`, actual, valid ? `${label} BOM field ${field} is present.` : `${label} BOM field ${field} is missing.`, { facet: 'bom', component: identityOf(component), bom_item: item || null });
  }
  const field = normalizeField(rule.property || rule.field || 'value');
  const actual = componentProperty(component, field);
  if (rule.type === 'property_present') {
    const valid = present(actual);
    return resultRecord(rule, valid ? 'PASS' : 'FAIL', `${field} present`, actual, valid ? `${label}.${field} is present.` : `${label}.${field} is missing.`, { facet: 'components', component: identityOf(component), field });
  }
  if (rule.type === 'property_equals') {
    const valid = stableStringify(actual) === stableStringify(rule.expected);
    return resultRecord(rule, valid ? 'PASS' : 'FAIL', rule.expected, actual, valid ? `${label}.${field} equals the expected value.` : `${label}.${field} does not equal the expected value.`, { facet: 'components', component: identityOf(component), field });
  }
  if (rule.type === 'property_matches') {
    if (!rule.regex) return resultRecord(rule, 'UNVERIFIABLE', rule.pattern, actual, 'No compiled safe regular expression is available.', { field });
    const valid = new RegExp(rule.regex.pattern, rule.regex.flags).test(String(actual ?? ''));
    return resultRecord(rule, valid ? 'PASS' : 'FAIL', { pattern: rule.regex.pattern, flags: rule.regex.flags }, actual, valid ? `${label}.${field} matches the expected pattern.` : `${label}.${field} does not match the expected pattern.`, { facet: 'components', component: identityOf(component), field });
  }
  return resultRecord(rule, 'UNVERIFIABLE', rule.expected, actual, 'Assertion evaluator is not available for this rule.', { type: rule.type });
}

function bomProperty(item, field) {
  if (!item) return null;
  if (field === 'footprint_name') return item.footprint_name ?? item.footprintName ?? item.footprint?.name ?? null;
  if (field === 'footprint_uuid') return item.footprint_uuid ?? item.footprintUuid ?? item.footprint?.uuid ?? null;
  if (field === 'supplier_id') return item.supplier_id ?? item.supplierId ?? null;
  if (field === 'manufacturer_id') return item.manufacturer_id ?? item.manufacturerId ?? null;
  return item[field] ?? item[field.replaceAll('_', '')] ?? null;
}

function identityMatchesEntry(entry, component) {
  const id = identityOf(component);
  return [entry?.unique_id, entry?.uniqueId, entry?.primitive_id, entry?.primitiveId, entry?.designator].filter(present)
    .some((value) => [id.unique_id, id.primitive_id, id.designator, id.key].filter(present).map(String).includes(String(value)));
}

function netName(net) {
  if (typeof net === 'string') return net;
  return net?.name ?? net?.net ?? net?.net_name ?? null;
}

function netMembers(net) {
  if (!isObject(net)) return [];
  const value = net.members ?? net.pins ?? net.endpoints;
  return Array.isArray(value) ? value : [];
}

function memberComponentSelector(member) {
  return member?.component ?? member?.designator ?? member?.component_identity ?? member?.component_unique_id ?? member?.component_primitive_id ?? null;
}

function memberPinValues(member) {
  return [member?.pin, member?.pin_name, member?.pin_number, member?.number, member?.pad, member?.name].filter((value) => value !== null && value !== undefined && String(value) !== '').map(String);
}

function memberMatchesEndpoint(member, endpoint, snapshot) {
  if (!endpoint) return false;
  const resolution = endpoint?.resolution?.state
    ? resolutionFromCompiled(snapshot, endpoint.resolution, endpoint.component)
    : resolveComponent(endpoint.component, snapshot);
  if (resolution.state !== 'resolved') return false;
  const memberSelector = memberComponentSelector(member);
  const memberResolution = resolveComponent(memberSelector, snapshot);
  const endpointId = resolution.resolved_identity;
  const memberId = memberResolution.state === 'resolved' ? memberResolution.resolved_identity : null;
  let componentEqual = false;
  if (memberId) componentEqual = [endpointId.unique_id, endpointId.primitive_id, endpointId.designator, endpointId.key].filter(present).some((value) => [memberId.unique_id, memberId.primitive_id, memberId.designator, memberId.key].filter(present).map(String).includes(String(value)));
  else if (memberSelector) componentEqual = [endpointId.unique_id, endpointId.primitive_id, endpointId.designator, endpointId.key].filter(present).map(String).includes(String(memberSelector).replace(/^match:[^:]+:/, ''));
  if (!componentEqual) return false;
  return memberPinValues(member).map(String).includes(String(endpoint.pin));
}

function netByName(snapshot, name) {
  const selected = preferredConnectivity(snapshot);
  const wanted = String(name ?? '');
  const net = selected.nets.find((item) => String(netName(item) ?? '') === wanted);
  return { ...selected, net: net || null };
}

function sourceMembersAvailable(selected) {
  return selected.nets.some((net) => netMembers(net).length > 0);
}

function evaluateNetRule(rule, snapshot, info) {
  const status = connectivityFacet(info);
  if (!status.available) return resultRecord(rule, 'UNVERIFIABLE', rule.expected ?? true, null, `Connectivity facet is ${status.status}.`, { facet: status.names, facet_status: status.status });
  const selected = preferredConnectivity(snapshot);
  if (rule.type === 'pin_connected') {
    const endpoint = rule.endpoint || { component: rule.component, pin: rule.pin };
    const endpointResolution = endpoint?.resolution
      ? resolutionFromCompiled(snapshot, endpoint.resolution, endpoint.component)
      : resolveComponent(endpoint?.component, snapshot);
    if (endpointResolution.state === 'ambiguous') return resultRecord(rule, 'UNVERIFIABLE', true, null, 'Endpoint component identity is ambiguous.', { source: selected.selectedName, selector: endpointResolution.selector, candidates: endpointResolution.candidates });
    if (endpointResolution.state !== 'resolved') return resultRecord(rule, 'FAIL', true, false, 'Endpoint component is absent from the canonical component list.', { source: selected.selectedName, selector: endpointResolution.selector });
    if (!sourceMembersAvailable(selected)) return resultRecord(rule, 'UNVERIFIABLE', true, null, 'Preferred connectivity source provides net names but no pin membership evidence.', { facet: 'connectivity', source: selected.selectedName });
    const connectedNet = selected.nets.find((net) => netMembers(net).some((member) => memberMatchesEndpoint(member, endpoint, snapshot)));
    const connected = Boolean(connectedNet);
    return resultRecord(rule, connected ? 'PASS' : 'FAIL', true, connected ? netName(connectedNet) : null, connected ? `Endpoint is connected to ${netName(connectedNet)}.` : 'Endpoint has no proven net membership.', { facet: 'connectivity', source: selected.selectedName, endpoint: { component: endpoint.component, pin: endpoint.pin }, net: connected ? netName(connectedNet) : null });
  }
  const selectedNet = netByName(snapshot, rule.net);
  if (rule.type === 'net_exists') {
    const exists = Boolean(selectedNet.net);
    return resultRecord(rule, exists ? 'PASS' : 'FAIL', true, exists, exists ? `Net ${rule.net} exists.` : `Net ${rule.net} is absent.`, { facet: 'connectivity', source: selected.selectedName || selected.source, net: rule.net });
  }
  const endpoint = rule.endpoint || { component: rule.component, pin: rule.pin };
  const endpointResolution = endpoint?.resolution ? endpoint.resolution : serialiseResolution(resolveComponent(endpoint?.component, snapshot));
  if (endpointResolution.state === 'ambiguous') return resultRecord(rule, 'UNVERIFIABLE', true, null, 'Endpoint component identity is ambiguous.', { source: selected.selectedName, selector: endpointResolution.selector, candidates: endpointResolution.candidates });
  if (!selectedNet.net) {
    const expected = rule.type === 'net_not_contains' ? true : false;
    return resultRecord(rule, rule.type === 'net_not_contains' ? 'PASS' : 'FAIL', expected, false, rule.type === 'net_not_contains' ? `Net ${rule.net} is absent, so it cannot contain the endpoint.` : `Net ${rule.net} is absent.`, { facet: 'connectivity', source: selected.selectedName, net: rule.net });
  }
  if (!sourceMembersAvailable(selected)) return resultRecord(rule, 'UNVERIFIABLE', true, null, 'Preferred connectivity source provides net names but no pin membership evidence.', { facet: 'connectivity', source: selected.selectedName, net: rule.net });
  const member = netMembers(selectedNet.net).some((item) => memberMatchesEndpoint(item, endpoint, snapshot));
  const contains = Boolean(member);
  const pass = rule.type === 'net_not_contains' ? !contains : contains;
  return resultRecord(rule, pass ? 'PASS' : 'FAIL', rule.type === 'net_not_contains' ? false : true, contains, pass ? `Endpoint is ${rule.type === 'net_not_contains' ? 'not ' : ''}in net ${rule.net}.` : `Endpoint membership does not satisfy the assertion.`, { facet: 'connectivity', source: selected.selectedName, net: rule.net, endpoint: { component: endpoint?.component ?? null, pin: endpoint?.pin ?? null } });
}

function endpointNets(snapshot, endpoint) {
  const selected = preferredConnectivity(snapshot);
  const resolution = endpoint?.resolution?.state
    ? resolutionFromCompiled(snapshot, endpoint.resolution, endpoint.component)
    : resolveComponent(endpoint?.component, snapshot);
  if (resolution.state !== 'resolved') return { selected, resolution, nets: [] };
  const nets = selected.nets.filter((net) => netMembers(net).some((member) => memberMatchesEndpoint(member, endpoint, snapshot))).map(netName).filter(present);
  return { selected, resolution, nets };
}

function evaluatePinPairRule(rule, snapshot, info) {
  const status = connectivityFacet(info);
  if (!status.available) return resultRecord(rule, 'UNVERIFIABLE', rule.type === 'pins_same_net', null, `Connectivity facet is ${status.status}.`, { facet: status.names, facet_status: status.status });
  const a = endpointNets(snapshot, rule.endpoint_a);
  const b = endpointNets(snapshot, rule.endpoint_b);
  if (a.resolution.state === 'ambiguous' || b.resolution.state === 'ambiguous') return resultRecord(rule, 'UNVERIFIABLE', rule.type === 'pins_same_net', null, 'One or both endpoint identities are ambiguous.', { endpoint_a: a.resolution, endpoint_b: b.resolution });
  if (!sourceMembersAvailable(a.selected)) return resultRecord(rule, 'UNVERIFIABLE', rule.type === 'pins_same_net', null, 'Preferred connectivity source provides no pin membership evidence.', { source: a.selected.selectedName });
  const aConnected = a.nets.length > 0;
  const bConnected = b.nets.length > 0;
  if (rule.type === 'pins_same_net') {
    const same = aConnected && bConnected && a.nets.some((name) => b.nets.includes(name));
    return resultRecord(rule, same ? 'PASS' : 'FAIL', true, same, same ? 'Both pins resolve to a common net.' : 'Pins are not proven to share a net.', { endpoint_a: a.nets, endpoint_b: b.nets });
  }
  if (!aConnected || !bConnected) return resultRecord(rule, 'UNVERIFIABLE', true, null, 'At least one endpoint has no proven connectivity.', { endpoint_a: a.nets, endpoint_b: b.nets });
  const same = a.nets.some((name) => b.nets.includes(name));
  return resultRecord(rule, !same ? 'PASS' : 'FAIL', false, same, !same ? 'Pins resolve to disjoint nets.' : 'Pins unexpectedly share a net.', { endpoint_a: a.nets, endpoint_b: b.nets });
}

function coordinate(component) {
  const x = Number(component?.x_nm);
  const y = Number(component?.y_nm);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function evaluateDistance(rule, snapshot, info) {
  if (!componentFacet(info).available) return resultRecord(rule, 'UNVERIFIABLE', rule.max_nm, null, 'Component facet is unavailable.', { facet: 'components' });
  const aResolution = resolutionFromCompiled(snapshot, rule.component_a_resolution, rule.component_a);
  const bResolution = resolutionFromCompiled(snapshot, rule.component_b_resolution, rule.component_b);
  if (aResolution.state === 'ambiguous' || bResolution.state === 'ambiguous') return resultRecord(rule, 'UNVERIFIABLE', rule.max_nm, null, 'Component identity is ambiguous.', { component_a: aResolution, component_b: bResolution });
  if (aResolution.state !== 'resolved' || bResolution.state !== 'resolved') return resultRecord(rule, 'FAIL', rule.max_nm, null, 'One or both distance endpoints are absent.', { component_a: aResolution, component_b: bResolution });
  const a = coordinate(aResolution.component);
  const b = coordinate(bResolution.component);
  if (!a || !b) return resultRecord(rule, 'UNVERIFIABLE', rule.max_nm, null, 'Component center/reference position is missing.', { component_a: identityOf(aResolution.component), component_b: identityOf(bResolution.component) });
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const actual = Math.round(Math.hypot(dx, dy));
  const pass = actual <= rule.max_nm;
  return resultRecord(rule, pass ? 'PASS' : 'FAIL', rule.max_nm, actual, pass ? 'Component center distance is within the limit.' : 'Component center distance exceeds the limit.', { unit: 'nm', measured: 'component_center_to_component_center', component_a: identityOf(aResolution.component), component_b: identityOf(bResolution.component) });
}

function pointValue(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const x = Number(point[0]); const y = Number(point[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  if (!isObject(point)) return null;
  const x = Number(point.x_nm ?? point.x); const y = Number(point.y_nm ?? point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function outlineSegments(outline) {
  const segments = [];
  const entries = Array.isArray(outline) ? outline : (outline ? [outline] : []);
  for (const item of entries) {
    if (item?.rectangle) {
      const x = Number(item.rectangle.x_nm ?? item.rectangle.x); const y = Number(item.rectangle.y_nm ?? item.rectangle.y);
      const w = Number(item.rectangle.width_nm ?? item.rectangle.width); const h = Number(item.rectangle.height_nm ?? item.rectangle.height);
      if ([x, y, w, h].every(Number.isFinite)) {
        const p = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
        for (let i = 0; i < p.length; i += 1) segments.push([p[i], p[(i + 1) % p.length]]);
        continue;
      }
    }
    const rawPoints = item?.points ?? item?.source;
    const points = asArray(rawPoints).map(pointValue).filter(Boolean);
    if (points.length > 1) {
      const closed = item.closed === true || stableStringify(points[0]) === stableStringify(points[points.length - 1]);
      for (let i = 0; i < points.length - 1; i += 1) segments.push([points[i], points[i + 1]]);
      if (closed) segments.push([points[points.length - 1], points[0]]);
      continue;
    }
    const start = pointValue(item?.start); const end = pointValue(item?.end);
    if (start && end) segments.push([start, end]);
  }
  return segments;
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function evaluateBoardEdge(rule, snapshot, info) {
  const geometryStatus = geometryFacet(info);
  const segments = outlineSegments(snapshot?.geometry?.board_outline);
  if (!geometryStatus.available || !segments.length) return resultRecord(rule, 'UNVERIFIABLE', rule.max_nm, null, `Reliable board outline is unavailable (${geometryStatus.status}).`, { facet: geometryStatus.names, facet_status: geometryStatus.status });
  const resolution = resolutionFromCompiled(snapshot, {
    state: rule.compile_resolution,
    selector: rule.selector,
    candidates: rule.candidate_identities,
    resolved_identity: rule.resolved_identity,
    match_method: rule.match_method,
    match_key: rule.match_key,
  }, rule.component);
  if (resolution.state === 'ambiguous') return unresolvedOutcome(rule, resolution, rule.max_nm);
  if (resolution.state !== 'resolved') return resultRecord(rule, 'FAIL', rule.max_nm, null, 'Component is absent from the canonical component list.', { selector: resolution.selector });
  const point = coordinate(resolution.component);
  if (!point) return resultRecord(rule, 'UNVERIFIABLE', rule.max_nm, null, 'Component center/reference position is missing.', { component: identityOf(resolution.component) });
  const actual = Math.round(Math.min(...segments.map(([a, b]) => pointSegmentDistance(point, a, b))));
  const pass = actual <= rule.max_nm;
  return resultRecord(rule, pass ? 'PASS' : 'FAIL', rule.max_nm, actual, pass ? 'Component center is within the board-edge limit.' : 'Component center is too far from the board edge.', { unit: 'nm', measured: 'component_center_to_board_outline', component: identityOf(resolution.component) });
}

function evaluateCount(rule, snapshot, info) {
  const status = componentFacet(info);
  if (!status.available) return resultRecord(rule, 'UNVERIFIABLE', rule.exact ?? rule.min ?? rule.max, null, `Component facet is ${status.status}.`, { facet: status.names, facet_status: status.status });
  const actual = asArray(snapshot?.components).length;
  const checks = [];
  if (rule.exact !== null && rule.exact !== undefined) checks.push(actual === rule.exact);
  if (rule.min !== null && rule.min !== undefined) checks.push(actual >= rule.min);
  if (rule.max !== null && rule.max !== undefined) checks.push(actual <= rule.max);
  const pass = checks.length > 0 && checks.every(Boolean);
  const expected = rule.exact !== null && rule.exact !== undefined ? { exact: rule.exact } : { min: rule.min, max: rule.max };
  return resultRecord(rule, pass ? 'PASS' : 'FAIL', expected, actual, pass ? 'Component count satisfies the assertion.' : 'Component count does not satisfy the assertion.', { facet: 'components', count: actual });
}

function evaluateRule(rule, snapshot, info) {
  if (['component_exists', 'component_not_exists', 'property_present', 'property_equals', 'property_matches', 'valid_lcsc_id', 'footprint_present', 'bom_field_present'].includes(rule.type)) return evaluateComponentRule(rule, snapshot, info);
  if (['net_exists', 'net_contains', 'net_not_contains', 'pin_connected'].includes(rule.type)) return evaluateNetRule(rule, snapshot, info);
  if (['pins_same_net', 'pins_different_net'].includes(rule.type)) return evaluatePinPairRule(rule, snapshot, info);
  if (rule.type === 'component_distance') return evaluateDistance(rule, snapshot, info);
  if (rule.type === 'component_near_board_edge') return evaluateBoardEdge(rule, snapshot, info);
  if (rule.type === 'component_count') return evaluateCount(rule, snapshot, info);
  return resultRecord(rule, 'UNVERIFIABLE', null, null, 'Assertion type is unsupported by the evaluator.', { type: rule.type });
}

function baseAssertionResult(compiled, info, status, valid, errors = []) {
  return {
    schema: ASSERTION_RESULT_SCHEMA,
    schema_version: ASSERTIONS_SCHEMA_VERSION,
    name: compiled?.name ?? 'Hardware Assertions',
    assertions_hash: compiled?.assertions_hash ?? null,
    snapshot_hash: info?.snapshot?.snapshot_hash ?? null,
    snapshot_identity: info?.identity ?? identityComparable(info?.snapshot),
    compiled_snapshot_hash: compiled?.compiled_snapshot_hash ?? null,
    strict: compiled?.strict !== false,
    status,
    valid,
    passed: false,
    summary: { pass: 0, fail: 0, unverifiable: 0, total: 0 },
    results: [],
    errors,
    warnings: [],
  };
}

/** Run compiled assertions against another valid capture of the same design identity. */
export function runAssertions(compiledInput, targetInput) {
  const compiled = isObject(compiledInput) ? compiledInput : {};
  const info = unwrapCapture(targetInput);
  const policyErrors = [];
  if (compiled.schema !== ASSERTIONS_SCHEMA) policyErrors.push(errorRecord('INVALID_ASSERTIONS_SCHEMA', `Expected compiled ${ASSERTIONS_SCHEMA}.`));
  if (compiled.valid === false || compiled.compiled === false || asArray(compiled.errors).length) policyErrors.push(...asArray(compiled.errors));
  if (!isObject(compiled.baseline) || !compiled.baseline.project_uuid || !compiled.baseline.document_uuid || !compiled.baseline.document_type) policyErrors.push(errorRecord('COMPILED_IDENTITY_MISSING', 'Compiled assertion identity binding is incomplete.'));
  if (policyErrors.length) return baseAssertionResult(compiled, info, 'INVALID_POLICY', false, policyErrors);
  if (info.errors.length) {
    const result = baseAssertionResult(compiled, info, 'ABORTED', false, info.errors);
    result.aborted = true;
    return result;
  }
  const observed = info.identity;
  const expected = compiled.baseline;
  const mismatched = ['project_uuid', 'document_uuid', 'document_type'].filter((field) => expected[field] !== observed[field]);
  if (mismatched.length) {
    return baseAssertionResult(compiled, info, 'IDENTITY_MISMATCH', false, [errorRecord('ASSERTION_IDENTITY_MISMATCH', 'Target capture identity does not match compiled assertion identity.', { mismatched_fields: mismatched, expected, observed })]);
  }
  const result = baseAssertionResult(compiled, info, 'FAIL', true);
  result.results = asArray(compiled.rules).map((rule) => evaluateRule(rule, info.snapshot, info));
  result.summary = {
    pass: result.results.filter((item) => item.result === 'PASS').length,
    fail: result.results.filter((item) => item.result === 'FAIL').length,
    unverifiable: result.results.filter((item) => item.result === 'UNVERIFIABLE').length,
    total: result.results.length,
  };
  result.passed = result.strict
    ? result.summary.fail === 0 && result.summary.unverifiable === 0
    : result.summary.fail === 0;
  result.status = result.passed ? 'PASS' : 'FAIL';
  if (!result.strict && result.summary.unverifiable) result.warnings.push('UNVERIFIABLE assertions do not block because strict=false.');
  return result;
}

export function renderAssertionCompile(compiled, outputPath = null) {
  const lines = [`ASSERTION COMPILE: ${compiled?.valid ? 'PASS' : 'FAIL'}`, ''];
  lines.push(`Suite: ${compiled?.name || 'Hardware Assertions'}`);
  lines.push(`Baseline: ${shortHash(compiled?.baseline?.snapshot_hash)}`);
  lines.push(`Rules: ${(compiled?.rules || []).length}`);
  if (outputPath) lines.push(`Wrote: ${outputPath}`);
  if (!compiled?.valid) {
    lines.push('', 'Errors:');
    for (const error of compiled?.errors || []) lines.push(`- ${error.message || error}`);
  }
  return lines.join('\n');
}

export function renderAssertionResult(result) {
  const lines = ['EDA-GUARD HARDWARE ASSERTIONS', ''];
  if (!result?.valid || result?.status === 'ABORTED' || result?.status === 'IDENTITY_MISMATCH' || result?.status === 'INVALID_POLICY') {
    if (result?.status === 'ABORTED') lines.push('ASSERTION RUN ABORTED', '');
    else if (result?.status === 'IDENTITY_MISMATCH') lines.push('ASSERTION IDENTITY MISMATCH', '');
    else lines.push('INVALID ASSERTION RUN', '');
    for (const error of result?.errors || [{ message: 'Unknown assertion error.' }]) lines.push(`- ${error.message || error}`);
    lines.push('', 'HARDWARE ASSERTIONS: FAIL');
    return lines.join('\n');
  }
  lines.push(`Suite: ${result.name || 'Hardware Assertions'}`);
  lines.push(`Snapshot: ${shortHash(result.snapshot_hash)}`, '');
  if (!result.results.length) lines.push('No rules.', '');
  for (const item of result.results) {
    lines.push(`${item.result} ${item.rule_id} [${item.severity}]`);
    lines.push(item.description || item.type);
    if (item.expected !== null && item.expected !== undefined) lines.push(`Expected: ${displayValue(item.expected)}`);
    if (item.actual !== null && item.actual !== undefined) lines.push(`Actual:   ${displayValue(item.actual)}`);
    if (item.reason) lines.push(`Reason:   ${item.reason}`);
    lines.push('');
  }
  lines.push('SUMMARY', '');
  lines.push(`PASS:           ${result.summary.pass}`);
  lines.push(`FAIL:           ${result.summary.fail}`);
  lines.push(`UNVERIFIABLE:   ${result.summary.unverifiable}`);
  lines.push(`Total rules:    ${result.summary.total}`, '');
  lines.push(`HARDWARE ASSERTIONS: ${result.passed ? 'PASS' : 'FAIL'}`);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}
