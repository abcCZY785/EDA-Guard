import { hashObject, stableStringify } from './hash.mjs';

export const SEMANTIC_DIFF_SCHEMA = 'edaguard.semantic-diff.v1';
export const SEMANTIC_DIFF_VERSION = '0.1.0';

export const SEVERITIES = Object.freeze(['INFO', 'NOTICE', 'WARNING', 'CRITICAL']);

const CATEGORY_ORDER = Object.freeze({
  connectivity: 0,
  components: 1,
  properties: 2,
  bom: 3,
  board_rules: 5,
  routing: 6,
});

const EVENT_ORDER = Object.freeze({
  connectivity_net_removed: 0,
  connectivity_net_added: 1,
  pin_reassigned: 2,
  connectivity_member_removed: 3,
  connectivity_member_added: 4,
  component_added: 0,
  component_removed: 1,
  ambiguous_match: 2,
  component_moved: 4,
  component_rotated: 5,
  property_changed: 0,
  bom_item_removed: 0,
  bom_item_added: 1,
  bom_supplier_id_changed: 2,
  bom_property_changed: 3,
  board_bounds_changed: 0,
  board_outline_changed: 1,
  rule_changed: 2,
  layer_added: 3,
  layer_removed: 4,
  layer_changed: 5,
  routing_changed: 0,
});

const FACET_NAMES = Object.freeze(['components', 'pads', 'connectivity', 'geometry', 'vias', 'bom', 'rules', 'layers']);
const COMPONENT_ID_FIELDS = Object.freeze(['unique_id', 'primitive_id']);
const BOM_ID_FIELDS = Object.freeze(['unique_id', 'designator']);
const EMPTY_COMPONENT_LABEL = 'UNKNOWN_COMPONENT';

const IMPORTANT_ATTRIBUTE_ALIASES = Object.freeze({
  description: ['Description'],
  device: ['Device'],
  mpn: ['MPN', 'Manufacturer Part Number', 'Manufacturer P/N'],
  package: ['Package'],
  library: ['Library', 'Library UUID', 'Library Identity'],
});

const PROPERTY_DESCRIPTORS = Object.freeze([
  { name: 'designator', className: 'semantic', severity: 'NOTICE' },
  { name: 'value', className: 'semantic', severity: 'NOTICE' },
  { name: 'footprint', className: 'semantic', severity: 'WARNING' },
  { name: 'manufacturer', className: 'semantic', severity: 'NOTICE' },
  { name: 'supplier', className: 'semantic', severity: 'NOTICE' },
  { name: 'supplierId', className: 'semantic', severity: 'WARNING' },
  { name: 'library_identity', className: 'semantic', severity: 'NOTICE' },
  { name: 'attributes', className: 'semantic', severity: 'NOTICE' },
  { name: 'name', className: 'informational', severity: 'INFO' },
  { name: 'mirror', className: 'informational', severity: 'INFO' },
  { name: 'layer', className: 'informational', severity: 'INFO' },
]);

const BOM_PROPERTY_DESCRIPTORS = Object.freeze([
  { name: 'value', severity: 'NOTICE' },
  { name: 'footprint', severity: 'WARNING' },
  { name: 'manufacturer', severity: 'NOTICE' },
  { name: 'supplier', severity: 'NOTICE' },
  { name: 'supplierId', severity: 'WARNING' },
]);

const IGNORED_PROPERTY_NAMES = Object.freeze([
  'identity.primitive_id',
  'identity.confidence',
  'primitive_id',
  'component_primitive_id',
  'captured_at',
  'timestamp',
  'window_id',
  'bridge_url',
  'source_versions',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isEmpty(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function nullable(value) {
  return isEmpty(value) ? null : value;
}

function text(value) {
  return value === null || value === undefined ? '' : String(value);
}

// Do not use localeCompare for canonical ordering: its result can vary with
// the host locale. Code-unit ordering is stable across Node/EasyEDA hosts.
function compareText(a, b) {
  const left = text(a);
  const right = text(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function same(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function firstDefined(...values) {
  for (const value of values) if (!isEmpty(value)) return value;
  return null;
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

function identityFieldValue(component, field) {
  const value = identityOf(component)[field];
  return isEmpty(value) ? null : String(value);
}

function itemIdentityValue(item, field) {
  if (field === 'unique_id') return nullable(item?.unique_id ?? item?.uniqueId);
  if (field === 'primitive_id') return nullable(item?.primitive_id ?? item?.primitiveId);
  return nullable(item?.[field]);
}

function componentLabel(component, fallback = EMPTY_COMPONENT_LABEL) {
  const identity = identityOf(component);
  return identity.designator || identity.unique_id || identity.primitive_id || identity.key || fallback;
}

function attrsOf(component) {
  return isObject(component?.other_property) ? component.other_property
    : (isObject(component?.otherProperty) ? component.otherProperty : {});
}

function attributeValue(component, aliases) {
  const attrs = attrsOf(component);
  const entries = Object.entries(attrs);
  for (const alias of aliases) {
    const match = entries.find(([key]) => key.toLowerCase() === alias.toLowerCase());
    if (match && !isEmpty(match[1])) return match[1];
  }
  return null;
}

function importantAttributes(component) {
  const result = {};
  for (const [name, aliases] of Object.entries(IMPORTANT_ATTRIBUTE_ALIASES)) {
    const value = attributeValue(component, aliases);
    if (!isEmpty(value)) result[name] = value;
  }
  return result;
}

function footprintValue(component) {
  // EasyEDA exposes the associated footprint as a getter and also mirrors its
  // display value in the canonical Footprint property. Prefer that explicit
  // property when present so an official property edit is visible even on
  // editor versions that do not expose a footprint-association setter.
  const name = nullable(attributeValue(component, ['Footprint']) ?? component?.footprint_name ?? component?.footprintName);
  const uuid = nullable(component?.footprint_uuid ?? component?.footprintUuid);
  if (name === null && uuid === null) return null;
  return { name, uuid };
}

function componentPropertyValues(component) {
  const attrs = attrsOf(component);
  return {
    designator: nullable(identityOf(component).designator),
    value: nullable(component?.value ?? attributeValue(component, ['Value'])),
    footprint: footprintValue(component),
    manufacturer: nullable(component?.manufacturer_id ?? component?.manufacturerId ?? attributeValue(component, ['Manufacturer'])),
    supplier: nullable(component?.supplier ?? component?.supplier_name ?? component?.supplierName ?? attributeValue(component, ['Supplier', 'Supplier Name'])),
    supplierId: nullable(component?.supplier_id ?? component?.supplierId ?? attributeValue(component, ['LCSC', 'LCSC Part #', 'LCSC Supplier ID', 'Supplier ID'])),
    library_identity: nullable(component?.library_identity ?? component?.library_uuid ?? component?.libraryUuid ?? identityOf(component).library_uuid ?? attributeValue(component, IMPORTANT_ATTRIBUTE_ALIASES.library)),
    attributes: importantAttributes(component),
    name: nullable(component?.name),
    mirror: component?.mirror ?? null,
    layer: component?.layer ?? null,
    // Keep a reference in the implementation so adding fields to the raw
    // component does not accidentally make them semantic by default.
    _raw_attribute_count: Object.keys(attrs).length,
  };
}

function bomPropertyValues(item) {
  const footprintName = nullable(item?.footprint_name ?? item?.footprintName);
  const footprintUuid = nullable(item?.footprint_uuid ?? item?.footprintUuid);
  return {
    value: nullable(item?.value),
    footprint: footprintName === null && footprintUuid === null ? null : { name: footprintName, uuid: footprintUuid },
    manufacturer: nullable(item?.manufacturer_id ?? item?.manufacturerId ?? item?.manufacturer),
    supplier: nullable(item?.supplier ?? item?.supplier_name ?? item?.supplierName),
    supplierId: nullable(item?.supplier_id ?? item?.supplierId),
  };
}

function makeEvent(type, category, severity, entity, details = {}) {
  return { type, category, severity, entity: entity || EMPTY_COMPONENT_LABEL, ...details };
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const categoryA = CATEGORY_ORDER[a.category] ?? 99;
    const categoryB = CATEGORY_ORDER[b.category] ?? 99;
    if (categoryA !== categoryB) return categoryA - categoryB;
    const orderA = EVENT_ORDER[a.type] ?? 99;
    const orderB = EVENT_ORDER[b.type] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    const entityA = text(a.entity);
    const entityB = text(b.entity);
    if (entityA !== entityB) return compareText(entityA, entityB);
    const propA = text(a.property);
    const propB = text(b.property);
    if (propA !== propB) return compareText(propA, propB);
    return compareText(stableStringify(a), stableStringify(b));
  });
}

function mapBy(items, fieldReader) {
  const map = new Map();
  items.forEach((item, index) => {
    const key = fieldReader(item);
    if (key === null) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(index);
  });
  return map;
}

function matchComponents(beforeItems, afterItems) {
  const before = asArray(beforeItems);
  const after = asArray(afterItems);
  const beforeUsed = new Set();
  const afterUsed = new Set();
  const matches = [];
  const ambiguous = [];

  for (const field of COMPONENT_ID_FIELDS) {
    const beforeMap = mapBy(before, (item) => identityFieldValue(item, field));
    const afterMap = mapBy(after, (item) => identityFieldValue(item, field));
    const keys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
    for (const key of keys) {
      const b = (beforeMap.get(key) || []).filter((index) => !beforeUsed.has(index));
      const a = (afterMap.get(key) || []).filter((index) => !afterUsed.has(index));
      if (!b.length || !a.length) continue;
      if (b.length === 1 && a.length === 1) {
        beforeUsed.add(b[0]);
        afterUsed.add(a[0]);
        matches.push({ beforeIndex: b[0], afterIndex: a[0], match_method: field, match_key: key });
      } else if (field === 'primitive_id') {
        b.forEach((index) => beforeUsed.add(index));
        a.forEach((index) => afterUsed.add(index));
        ambiguous.push({ field, key, beforeIndices: b, afterIndices: a });
      }
      // Duplicate unique IDs are left for primitive_id matching.  This lets a
      // stable primitive ID disambiguate a malformed/duplicated unique ID.
    }
  }

  // A designator is never used as a successful identity match.  A common
  // designator without a unique/primitive identity is explicitly ambiguous.
  const beforeDesignators = mapBy(before, (item) => identityFieldValue(item, 'designator'));
  const afterDesignators = mapBy(after, (item) => identityFieldValue(item, 'designator'));
  const designatorKeys = [...new Set([...beforeDesignators.keys(), ...afterDesignators.keys()])].sort();
  for (const key of designatorKeys) {
    const b = (beforeDesignators.get(key) || []).filter((index) => !beforeUsed.has(index));
    const a = (afterDesignators.get(key) || []).filter((index) => !afterUsed.has(index));
    if (!b.length || !a.length) continue;
    b.forEach((index) => beforeUsed.add(index));
    a.forEach((index) => afterUsed.add(index));
    ambiguous.push({ field: 'designator', key, beforeIndices: b, afterIndices: a });
  }

  const unmatchedBefore = before.map((_, index) => index).filter((index) => !beforeUsed.has(index));
  const unmatchedAfter = after.map((_, index) => index).filter((index) => !afterUsed.has(index));
  if (unmatchedBefore.length && unmatchedAfter.length) {
    const noIdentityBefore = unmatchedBefore.filter((index) => Object.values(identityOf(before[index])).every(isEmpty));
    const noIdentityAfter = unmatchedAfter.filter((index) => Object.values(identityOf(after[index])).every(isEmpty));
    if (noIdentityBefore.length && noIdentityAfter.length) {
      noIdentityBefore.forEach((index) => beforeUsed.add(index));
      noIdentityAfter.forEach((index) => afterUsed.add(index));
      ambiguous.push({ field: 'none', key: null, beforeIndices: noIdentityBefore, afterIndices: noIdentityAfter });
    }
  }

  return {
    matches: matches.sort((a, b) => a.beforeIndex - b.beforeIndex),
    ambiguous: ambiguous.sort((a, b) => compareText(`${a.field}:${a.key}`, `${b.field}:${b.key}`)),
    removed: before.map((_, index) => index).filter((index) => !beforeUsed.has(index)),
    added: after.map((_, index) => index).filter((index) => !afterUsed.has(index)),
  };
}

function componentDiff(beforeSnapshot, afterSnapshot) {
  const beforeItems = asArray(beforeSnapshot?.components);
  const afterItems = asArray(afterSnapshot?.components);
  const matching = matchComponents(beforeItems, afterItems);
  const changes = [];

  for (const index of matching.removed) {
    const component = beforeItems[index];
    changes.push(makeEvent('component_removed', 'components', 'WARNING', componentLabel(component), {
      identity: identityOf(component),
      before: { value: componentPropertyValues(component).value, footprint: componentPropertyValues(component).footprint },
    }));
  }
  for (const index of matching.added) {
    const component = afterItems[index];
    changes.push(makeEvent('component_added', 'components', 'NOTICE', componentLabel(component), {
      identity: identityOf(component),
      after: { value: componentPropertyValues(component).value, footprint: componentPropertyValues(component).footprint },
    }));
  }
  for (const group of matching.ambiguous) {
    changes.push(makeEvent('ambiguous_match', 'components', 'WARNING', group.key || EMPTY_COMPONENT_LABEL, {
      code: 'AMBIGUOUS_MATCH',
      identity_field: group.field,
      before_candidates: group.beforeIndices.map((index) => ({ index, identity: identityOf(beforeItems[index]), entity: componentLabel(beforeItems[index]) })),
      after_candidates: group.afterIndices.map((index) => ({ index, identity: identityOf(afterItems[index]), entity: componentLabel(afterItems[index]) })),
    }));
  }

  for (const match of matching.matches) {
    const before = beforeItems[match.beforeIndex];
    const after = afterItems[match.afterIndex];
    const entity = componentLabel(after, componentLabel(before));
    const identityBefore = identityOf(before);
    const identityAfter = identityOf(after);
    const componentMatch = {
      match_method: match.match_method,
      match_key: match.match_key,
      component_identity: identityAfter,
      identity_before: identityBefore,
      identity_after: identityAfter,
    };
    const beforeProperties = componentPropertyValues(before);
    const afterProperties = componentPropertyValues(after);
    for (const descriptor of PROPERTY_DESCRIPTORS) {
      if (descriptor.name === '_raw_attribute_count') continue;
      const beforeValue = beforeProperties[descriptor.name];
      const afterValue = afterProperties[descriptor.name];
      if (!same(beforeValue, afterValue)) {
        changes.push(makeEvent('property_changed', 'properties', descriptor.severity, entity, {
          property: descriptor.name,
          property_class: descriptor.className,
          ...componentMatch,
          before: beforeValue,
          after: afterValue,
          before_entity: componentLabel(before),
          after_entity: componentLabel(after),
        }));
      }
    }

    const beforePosition = { x_nm: before?.x_nm ?? null, y_nm: before?.y_nm ?? null };
    const afterPosition = { x_nm: after?.x_nm ?? null, y_nm: after?.y_nm ?? null };
    if (!same(beforePosition, afterPosition)) {
      const numeric = [beforePosition.x_nm, beforePosition.y_nm, afterPosition.x_nm, afterPosition.y_nm].every((value) => typeof value === 'number' && Number.isFinite(value));
      changes.push(makeEvent('component_moved', 'components', 'NOTICE', entity, {
        ...componentMatch,
        before: beforePosition,
        after: afterPosition,
        delta: numeric ? {
          x_nm: afterPosition.x_nm - beforePosition.x_nm,
          y_nm: afterPosition.y_nm - beforePosition.y_nm,
        } : null,
      }));
    }
    const beforeRotation = before?.rotation_microdegree ?? null;
    const afterRotation = after?.rotation_microdegree ?? null;
    if (!same(beforeRotation, afterRotation)) {
      changes.push(makeEvent('component_rotated', 'components', 'NOTICE', entity, {
        ...componentMatch,
        before: beforeRotation,
        after: afterRotation,
        delta_microdegree: typeof beforeRotation === 'number' && typeof afterRotation === 'number' ? afterRotation - beforeRotation : null,
      }));
    }
  }
  return { changes, matching };
}

function matchBomItems(beforeItems, afterItems) {
  const before = asArray(beforeItems);
  const after = asArray(afterItems);
  const beforeUsed = new Set();
  const afterUsed = new Set();
  const matches = [];
  const ambiguous = [];
  for (const field of BOM_ID_FIELDS) {
    const beforeMap = mapBy(before, (item) => {
      const value = itemIdentityValue(item, field);
      return isEmpty(value) ? null : String(value);
    });
    const afterMap = mapBy(after, (item) => {
      const value = itemIdentityValue(item, field);
      return isEmpty(value) ? null : String(value);
    });
    for (const key of [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort()) {
      const b = (beforeMap.get(key) || []).filter((index) => !beforeUsed.has(index));
      const a = (afterMap.get(key) || []).filter((index) => !afterUsed.has(index));
      if (!b.length || !a.length) continue;
      if (b.length === 1 && a.length === 1) {
        beforeUsed.add(b[0]);
        afterUsed.add(a[0]);
        matches.push({ beforeIndex: b[0], afterIndex: a[0], match_method: field, match_key: key });
      } else {
        b.forEach((index) => beforeUsed.add(index));
        a.forEach((index) => afterUsed.add(index));
        ambiguous.push({ field, key, beforeIndices: b, afterIndices: a });
      }
    }
  }
  return {
    matches,
    ambiguous,
    removed: before.map((_, index) => index).filter((index) => !beforeUsed.has(index)),
    added: after.map((_, index) => index).filter((index) => !afterUsed.has(index)),
  };
}

function bomDiff(beforeSnapshot, afterSnapshot) {
  const beforeItems = asArray(beforeSnapshot?.bom);
  const afterItems = asArray(afterSnapshot?.bom);
  const matching = matchBomItems(beforeItems, afterItems);
  const changes = [];
  for (const index of matching.removed) {
    const item = beforeItems[index];
    changes.push(makeEvent('bom_item_removed', 'bom', 'WARNING', item?.designator || item?.unique_id || EMPTY_COMPONENT_LABEL, {
      identity: { unique_id: nullable(item?.unique_id), designator: nullable(item?.designator) },
      before: bomPropertyValues(item),
    }));
  }
  for (const index of matching.added) {
    const item = afterItems[index];
    changes.push(makeEvent('bom_item_added', 'bom', 'NOTICE', item?.designator || item?.unique_id || EMPTY_COMPONENT_LABEL, {
      identity: { unique_id: nullable(item?.unique_id), designator: nullable(item?.designator) },
      after: bomPropertyValues(item),
    }));
  }
  for (const group of matching.ambiguous) {
    changes.push(makeEvent('ambiguous_match', 'bom', 'WARNING', group.key || EMPTY_COMPONENT_LABEL, {
      code: 'AMBIGUOUS_MATCH',
      identity_field: group.field,
      before_candidates: group.beforeIndices.map((index) => beforeItems[index]),
      after_candidates: group.afterIndices.map((index) => afterItems[index]),
    }));
  }
  for (const match of matching.matches) {
    const before = beforeItems[match.beforeIndex];
    const after = afterItems[match.afterIndex];
    const entity = after?.designator || before?.designator || after?.unique_id || before?.unique_id || EMPTY_COMPONENT_LABEL;
    const beforeValues = bomPropertyValues(before);
    const afterValues = bomPropertyValues(after);
    for (const descriptor of BOM_PROPERTY_DESCRIPTORS) {
      if (same(beforeValues[descriptor.name], afterValues[descriptor.name])) continue;
      const type = descriptor.name === 'supplierId' ? 'bom_supplier_id_changed' : 'bom_property_changed';
      changes.push(makeEvent(type, 'bom', descriptor.severity, entity, {
        property: descriptor.name,
        match_method: match.match_method,
        match_key: match.match_key,
        identity: { unique_id: nullable(after?.unique_id ?? before?.unique_id), designator: nullable(after?.designator ?? before?.designator) },
        identity_before: { unique_id: nullable(before?.unique_id), designator: nullable(before?.designator) },
        identity_after: { unique_id: nullable(after?.unique_id), designator: nullable(after?.designator) },
        before: beforeValues[descriptor.name],
        after: afterValues[descriptor.name],
      }));
    }
  }
  return { changes, matching };
}

function preferredConnectivity(snapshot) {
  const connectivity = snapshot?.connectivity || {};
  const sourceMap = {
    manufacture_netlist: 'manufacture_nets',
    manufacture_nets: 'manufacture_nets',
    pcb_api: 'pcb_nets',
    pcb_nets: 'pcb_nets',
    direct_api: 'direct_nets',
    direct_nets: 'direct_nets',
  };
  const preferred = sourceMap[connectivity.preferred_source] || null;
  const candidates = preferred ? [preferred, 'manufacture_nets', 'pcb_nets', 'direct_nets'] : ['manufacture_nets', 'pcb_nets', 'direct_nets'];
  const source = candidates.find((key) => asArray(connectivity[key]).length) || preferred || candidates[0];
  const nets = asArray(connectivity[source]);
  const hasMembers = nets.some((net) => asArray(net?.pins ?? net?.members ?? net?.memberships).length > 0);
  // PCB_Net.getAllNetsName() is a reliable net-name read but, in the
  // currently supported EasyEDA version, returns empty pin arrays. Rebuild a
  // conservative member view from canonical pad net/number fields when that
  // happens. This stays inside Diff and never calls the editor API.
  if (!hasMembers && source === 'pcb_nets') {
    const components = asArray(snapshot?.components);
    const byPrimitive = new Map(components.map((component) => [identityFieldValue(component, 'primitive_id'), component]).filter(([key]) => key));
    const grouped = new Map(nets.map((net) => [String(net?.name ?? net?.net ?? net?.net_name ?? '<unnamed-net>'), { name: String(net?.name ?? net?.net ?? net?.net_name ?? '<unnamed-net>'), pins: [] }]));
    for (const pad of asArray(snapshot?.pads)) {
      const netName = nullable(pad?.net);
      if (netName === null) continue;
      const key = String(netName);
      if (!grouped.has(key)) grouped.set(key, { name: key, pins: [] });
      let component = byPrimitive.get(nullable(pad?.component_primitive_id));
      if (!component && !isEmpty(pad?.primitive_id)) {
        const candidatesByPrefix = components.filter((item) => {
          const primitive = identityFieldValue(item, 'primitive_id');
          return primitive && String(pad.primitive_id).startsWith(primitive);
        });
        if (candidatesByPrefix.length === 1) component = candidatesByPrefix[0];
      }
      const componentIdentity = component ? firstDefined(identityOf(component).unique_id, identityOf(component).primitive_id, identityOf(component).designator) : null;
      grouped.get(key).pins.push({
        component_identity: componentIdentity,
        designator: component ? identityOf(component).designator : null,
        pin: firstDefined(pad?.number, pad?.pad_number, pad?.padNumber),
        pin_name: firstDefined(pad?.name, pad?.pin_name, pad?.pinName),
      });
    }
    return { source, source_detail: 'pads_derived', nets: [...grouped.values()] };
  }
  return { source, source_detail: 'native', nets };
}

function makeComponentResolver(snapshot, matching) {
  const components = asArray(snapshot?.components);
  const resolver = new Map();
  const labels = new Map();
  const identities = new Map();
  for (const match of matching.matches) {
    const before = matching.beforeItems?.[match.beforeIndex];
    const after = matching.afterItems?.[match.afterIndex];
    const stable = `match:${match.match_method}:${match.match_key}`;
    for (const component of [before, after]) {
      if (!component) continue;
      for (const field of ['unique_id', 'primitive_id', 'designator', 'key']) {
        const value = field === 'key' ? identityOf(component).key : identityFieldValue(component, field);
        if (!isEmpty(value) && !resolver.has(String(value))) resolver.set(String(value), stable);
      }
    }
    labels.set(stable, componentLabel(after || before));
    identities.set(stable, identityOf(after || before));
  }
  const fieldMaps = {};
  for (const field of ['unique_id', 'primitive_id', 'designator', 'key']) fieldMaps[field] = mapBy(components, (item) => field === 'key' ? identityOf(item).key : identityFieldValue(item, field));
  for (const [field, map] of Object.entries(fieldMaps)) {
    for (const [key, indices] of map.entries()) {
      if (indices.length === 1 && !resolver.has(key)) {
        const stable = `unmatched:${field}:${key}`;
        resolver.set(key, stable);
        labels.set(stable, componentLabel(components[indices[0]]));
        identities.set(stable, identityOf(components[indices[0]]));
      }
    }
  }
  return { resolver, labels, identities };
}

function normalizeNetMember(member, resolver, labels, identities = new Map()) {
  const rawComponent = firstDefined(member?.component_identity, member?.componentIdentity, member?.component, member?.designator, member?.component_id, member?.componentId);
  const rawComponentIdentity = isObject(rawComponent)
    ? firstDefined(rawComponent.unique_id, rawComponent.uniqueId, rawComponent.primitive_id, rawComponent.primitiveId, rawComponent.designator, rawComponent.key, rawComponent.identity?.unique_id, rawComponent.identity?.designator)
    : rawComponent;
  const rawComponentText = nullable(rawComponentIdentity);
  const rawDesignator = isObject(rawComponent)
    ? nullable(firstDefined(rawComponent.designator, rawComponent.identity?.designator))
    : nullable(member?.designator ?? (typeof rawComponent === 'string' ? rawComponent : null));
  const stableComponent = rawComponentText === null ? 'unknown-component' : (resolver.get(String(rawComponentText)) || `raw:${rawComponentText}`);
  const pin = firstDefined(member?.pin, member?.number, member?.pin_number, member?.pinNumber, member?.pad);
  const pinName = firstDefined(member?.pin_name, member?.pinName, member?.name);
  const pinText = nullable(pin);
  const pinNameText = nullable(pinName);
  const label = labels.get(stableComponent) || rawDesignator || rawComponentText || EMPTY_COMPONENT_LABEL;
  const canonicalIdentity = identities.get(stableComponent) || {};
  return {
    component_identity: stableComponent,
    component_unique_id: canonicalIdentity.unique_id || null,
    component: label,
    designator: rawDesignator || label,
    pin: pinText,
    pin_name: pinNameText,
    signature: `${stableComponent}|${pinText || ''}|${pinNameText || ''}`,
  };
}

function normalizeNet(net, resolver, labels, identities = new Map()) {
  const name = nullable(net?.name ?? net?.net ?? net?.net_name) || '<unnamed-net>';
  const rawMembers = net?.pins ?? net?.members ?? net?.memberships ?? [];
  const members = asArray(rawMembers).map((member) => normalizeNetMember(member, resolver, labels, identities));
  const bySignature = new Map();
  for (const member of members) if (!bySignature.has(member.signature)) bySignature.set(member.signature, member);
  const normalizedName = String(name);
  return {
    // `net_name` is the contract-facing key; keep `name` as a small
    // compatibility alias for callers that consumed the first MVP draft.
    net_name: normalizedName,
    name: normalizedName,
    members: [...bySignature.values()].sort((a, b) => compareText(a.signature, b.signature)),
  };
}

function connectivityDiff(beforeSnapshot, afterSnapshot, componentMatching) {
  const beforeResolver = makeComponentResolver(beforeSnapshot, { ...componentMatching, beforeItems: asArray(beforeSnapshot?.components), afterItems: asArray(afterSnapshot?.components) });
  const afterResolver = makeComponentResolver(afterSnapshot, { ...componentMatching, beforeItems: asArray(beforeSnapshot?.components), afterItems: asArray(afterSnapshot?.components) });
  const beforeSource = preferredConnectivity(beforeSnapshot);
  const afterSource = preferredConnectivity(afterSnapshot);
  const beforeNets = beforeSource.nets.map((net) => normalizeNet(net, beforeResolver.resolver, beforeResolver.labels, beforeResolver.identities)).sort((a, b) => compareText(a.net_name, b.net_name));
  const afterNets = afterSource.nets.map((net) => normalizeNet(net, afterResolver.resolver, afterResolver.labels, afterResolver.identities)).sort((a, b) => compareText(a.net_name, b.net_name));
  const beforeMap = new Map(beforeNets.map((net) => [net.name, net]));
  const afterMap = new Map(afterNets.map((net) => [net.name, net]));
  const changes = [];
  const rawEvents = [];

  const beforePinNets = new Map();
  const afterPinNets = new Map();
  for (const net of beforeNets) for (const member of net.members) if (!beforePinNets.has(member.signature)) beforePinNets.set(member.signature, net.name);
  for (const net of afterNets) for (const member of net.members) if (!afterPinNets.has(member.signature)) afterPinNets.set(member.signature, net.name);
  const reassigned = new Set();
  for (const signature of [...beforePinNets.keys()].sort()) {
    const from = beforePinNets.get(signature);
    const to = afterPinNets.get(signature);
    if (to && from !== to) {
      reassigned.add(signature);
      const member = afterNets.flatMap((net) => net.members).find((item) => item.signature === signature)
        || beforeNets.flatMap((net) => net.members).find((item) => item.signature === signature);
      const event = makeEvent('pin_reassigned', 'connectivity', 'CRITICAL', member?.component || EMPTY_COMPONENT_LABEL, {
        member,
        from_net: from,
        to_net: to,
      });
      changes.push(event);
      rawEvents.push({ type: 'connectivity_member_removed', net: from, member, aggregated_into: 'pin_reassigned' });
      rawEvents.push({ type: 'connectivity_member_added', net: to, member, aggregated_into: 'pin_reassigned' });
    }
  }

  for (const name of [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort()) {
    const beforeNet = beforeMap.get(name);
    const afterNet = afterMap.get(name);
    if (!beforeNet) {
      changes.push(makeEvent('connectivity_net_added', 'connectivity', 'NOTICE', name, { member_count: afterNet.members.length, after: afterNet }));
      rawEvents.push({ type: 'connectivity_net_added', net: name, member_count: afterNet.members.length });
      continue;
    }
    if (!afterNet) {
      changes.push(makeEvent('connectivity_net_removed', 'connectivity', 'CRITICAL', name, { member_count: beforeNet.members.length, before: beforeNet }));
      rawEvents.push({ type: 'connectivity_net_removed', net: name, member_count: beforeNet.members.length });
      continue;
    }
    const beforeMembers = new Map(beforeNet.members.map((member) => [member.signature, member]));
    const afterMembers = new Map(afterNet.members.map((member) => [member.signature, member]));
    for (const signature of [...new Set([...beforeMembers.keys(), ...afterMembers.keys()])].sort()) {
      if (reassigned.has(signature)) continue;
      if (!beforeMembers.has(signature)) {
        const member = afterMembers.get(signature);
        changes.push(makeEvent('connectivity_member_added', 'connectivity', 'NOTICE', member.component, { net: name, member }));
        rawEvents.push({ type: 'connectivity_member_added', net: name, member });
      } else if (!afterMembers.has(signature)) {
        const member = beforeMembers.get(signature);
        changes.push(makeEvent('connectivity_member_removed', 'connectivity', 'CRITICAL', member.component, { net: name, member }));
        rawEvents.push({ type: 'connectivity_member_removed', net: name, member });
      }
    }
  }
  return {
    changes,
    rawEvents: rawEvents.sort((a, b) => compareText(`${a.type}:${a.net}:${stableStringify(a.member)}`, `${b.type}:${b.net}:${stableStringify(b.member)}`)),
    source_before: beforeSource.source,
    source_after: afterSource.source,
    before: { source: beforeSource.source, source_detail: beforeSource.source_detail, nets: beforeNets },
    after: { source: afterSource.source, source_detail: afterSource.source_detail, nets: afterNets },
  };
}

function dropRuntimeKeys(value) {
  if (Array.isArray(value)) return value.map(dropRuntimeKeys);
  if (!isObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (/^(primitive_id|component_primitive_id|captured_at|timestamp|window_id|bridge_url|source_versions)$/i.test(key)) continue;
    out[key] = dropRuntimeKeys(value[key]);
  }
  return out;
}

function stableSorted(values) {
  return asArray(values).map(dropRuntimeKeys).sort((a, b) => compareText(stableStringify(a), stableStringify(b)));
}

function geometryComparable(snapshot) {
  const geometry = snapshot?.geometry || {};
  return {
    lines: stableSorted(geometry.lines),
    arcs: stableSorted(geometry.arcs),
    polylines: stableSorted(geometry.polylines),
    board_outline: stableSorted(geometry.board_outline),
    regions: stableSorted(geometry.regions),
    pours: stableSorted(geometry.pours),
    fills: stableSorted(geometry.fills),
  };
}

function boardBounds(snapshot) {
  const geometry = snapshot?.geometry || {};
  const explicit = snapshot?.board_bounds || geometry.board_bounds || geometry.bounds || null;
  if (isObject(explicit)) {
    const keys = ['min_x_nm', 'min_y_nm', 'max_x_nm', 'max_y_nm'];
    if (keys.every((key) => typeof explicit[key] === 'number')) return { source: 'explicit', bounds: Object.fromEntries(keys.map((key) => [key, explicit[key]])) };
    if (typeof explicit.x_nm === 'number' && typeof explicit.y_nm === 'number' && typeof explicit.width_nm === 'number' && typeof explicit.height_nm === 'number') {
      return { source: 'explicit', bounds: { min_x_nm: explicit.x_nm, min_y_nm: explicit.y_nm, max_x_nm: explicit.x_nm + explicit.width_nm, max_y_nm: explicit.y_nm + explicit.height_nm } };
    }
  }
  const points = [];
  const visit = (value) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isObject(value)) return;
    if (isObject(value.rectangle) && typeof value.rectangle.x_nm === 'number' && typeof value.rectangle.y_nm === 'number' && typeof value.rectangle.width_nm === 'number' && typeof value.rectangle.height_nm === 'number') {
      const r = value.rectangle;
      points.push([r.x_nm, r.y_nm], [r.x_nm + r.width_nm, r.y_nm + r.height_nm]);
    }
    if (typeof value.x_nm === 'number' && typeof value.y_nm === 'number') points.push([value.x_nm, value.y_nm]);
    for (const [key, child] of Object.entries(value)) if (key !== 'source_raw') visit(child);
  };
  visit(geometry.board_outline);
  if (!points.length) return { source: 'none', bounds: null };
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    source: 'derived',
    bounds: { min_x_nm: Math.min(...xs), min_y_nm: Math.min(...ys), max_x_nm: Math.max(...xs), max_y_nm: Math.max(...ys) },
  };
}

function flattenRuleLeaves(value, path = '', out = {}) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.map((item) => normalizeRuleValue(item)).sort((a, b) => compareText(stableStringify(a), stableStringify(b))).forEach((item, index) => flattenRuleLeaves(item, `${path}[${index}]`, out));
    return out;
  }
  if (isObject(value)) {
    for (const key of Object.keys(value).sort()) {
      if (/^(created_at|updated_at|createTime|updateTime|timestamp|window_id|bridge_url|source_versions|primitive_id)$/i.test(key)) continue;
      const next = path ? `${path}.${key}` : key;
      flattenRuleLeaves(value[key], next, out);
    }
    return out;
  }
  out[path] = value;
  return out;
}

function normalizeRuleValue(value) {
  if (Array.isArray(value)) return value.map(normalizeRuleValue).sort((a, b) => compareText(stableStringify(a), stableStringify(b)));
  if (!isObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (/^(created_at|updated_at|createTime|updateTime|timestamp|window_id|bridge_url|source_versions|primitive_id)$/i.test(key)) continue;
    out[key] = normalizeRuleValue(value[key]);
  }
  return out;
}

function ruleMap(snapshot) {
  return flattenRuleLeaves(normalizeRuleValue(snapshot?.rules));
}

function layerItems(snapshot) {
  const value = snapshot?.layers;
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.layers)) return value.layers;
  return [];
}

function layerIdentity(layer) {
  return String(firstDefined(layer?.id, layer?.layer_id, layer?.name, '<unnamed-layer>'));
}

function layerComparable(layer) {
  return {
    id: layer?.id ?? layer?.layer_id ?? null,
    name: layer?.name ?? null,
    type: layer?.type ?? null,
    color: layer?.color ?? null,
    inactiveColor: layer?.inactiveColor ?? null,
    layerStatus: layer?.layerStatus ?? layer?.status ?? null,
    locked: layer?.locked ?? null,
    transparency: layer?.transparency ?? null,
    inactiveTransparency: layer?.inactiveTransparency ?? null,
  };
}

function boardRulesDiff(beforeSnapshot, afterSnapshot) {
  const changes = [];
  const beforeBounds = boardBounds(beforeSnapshot);
  const afterBounds = boardBounds(afterSnapshot);
  const boundsChanged = !same(beforeBounds.bounds, afterBounds.bounds);
  const beforeOutline = geometryComparable(beforeSnapshot).board_outline;
  const afterOutline = geometryComparable(afterSnapshot).board_outline;
  const outlineChanged = !same(beforeOutline, afterOutline);
  if (boundsChanged && (beforeBounds.bounds || afterBounds.bounds)) {
    changes.push(makeEvent('board_bounds_changed', 'board_rules', 'NOTICE', 'BOARD', {
      before: beforeBounds.bounds,
      after: afterBounds.bounds,
      before_source: beforeBounds.source,
      after_source: afterBounds.source,
    }));
  }
  if (outlineChanged && !(boundsChanged && beforeBounds.source === 'derived' && afterBounds.source === 'derived')) {
    changes.push(makeEvent('board_outline_changed', 'board_rules', 'NOTICE', 'BOARD_OUTLINE', {
      before: beforeOutline,
      after: afterOutline,
    }));
  }

  const beforeRules = ruleMap(beforeSnapshot);
  const afterRules = ruleMap(afterSnapshot);
  for (const property of [...new Set([...Object.keys(beforeRules), ...Object.keys(afterRules)])].sort()) {
    if (same(beforeRules[property], afterRules[property])) continue;
    changes.push(makeEvent('rule_changed', 'board_rules', 'NOTICE', property, {
      property,
      before: beforeRules[property] ?? null,
      after: afterRules[property] ?? null,
    }));
  }

  const beforeLayers = new Map(layerItems(beforeSnapshot).map((layer) => [layerIdentity(layer), layer]));
  const afterLayers = new Map(layerItems(afterSnapshot).map((layer) => [layerIdentity(layer), layer]));
  for (const key of [...new Set([...beforeLayers.keys(), ...afterLayers.keys()])].sort()) {
    const before = beforeLayers.get(key);
    const after = afterLayers.get(key);
    if (!before) changes.push(makeEvent('layer_added', 'board_rules', 'NOTICE', key, { after: layerComparable(after) }));
    else if (!after) changes.push(makeEvent('layer_removed', 'board_rules', 'WARNING', key, { before: layerComparable(before) }));
    else if (!same(layerComparable(before), layerComparable(after))) changes.push(makeEvent('layer_changed', 'board_rules', 'NOTICE', key, { before: layerComparable(before), after: layerComparable(after) }));
  }
  return { changes };
}

function routingSummary(snapshot) {
  const result = new Map();
  const ensure = (name) => {
    if (!result.has(name)) result.set(name, { net: name, segment_count: 0, via_count: 0, length_nm: 0, length_known: true, layers: new Set() });
    return result.get(name);
  };
  for (const line of asArray(snapshot?.geometry?.lines)) {
    const net = nullable(line?.net);
    if (net === null || String(line?.layer) === '11') continue;
    const item = ensure(String(net));
    item.segment_count += 1;
    if (!isEmpty(line?.layer)) item.layers.add(String(line.layer));
    const start = line?.start;
    const end = line?.end;
    const numeric = [start?.x_nm, start?.y_nm, end?.x_nm, end?.y_nm].every((value) => typeof value === 'number' && Number.isFinite(value));
    if (numeric) item.length_nm += Math.hypot(end.x_nm - start.x_nm, end.y_nm - start.y_nm);
    else item.length_known = false;
  }
  for (const via of asArray(snapshot?.vias)) {
    const net = nullable(via?.net);
    if (net === null) continue;
    const item = ensure(String(net));
    item.via_count += 1;
    if (Array.isArray(via?.layers)) via.layers.forEach((layer) => item.layers.add(String(layer)));
  }
  return Object.fromEntries([...result.entries()].sort(([a], [b]) => compareText(a, b)).map(([key, item]) => [key, {
    net: item.net,
    segment_count: item.segment_count,
    via_count: item.via_count,
    length_nm: item.length_known ? Math.round(item.length_nm) : null,
    layer_set: [...item.layers].sort(),
  }]));
}

function fallbackRoutingSummary(snapshot) {
  const geometry = snapshot?.geometry || {};
  const lines = asArray(geometry.lines).filter((line) => String(line?.layer) !== '11');
  let length = 0;
  let lengthKnown = true;
  for (const line of lines) {
    const start = line?.start;
    const end = line?.end;
    const numeric = [start?.x_nm, start?.y_nm, end?.x_nm, end?.y_nm].every((value) => typeof value === 'number' && Number.isFinite(value));
    if (numeric) length += Math.hypot(end.x_nm - start.x_nm, end.y_nm - start.y_nm);
    else lengthKnown = false;
  }
  const layers = new Set(lines.flatMap((line) => isEmpty(line?.layer) ? [] : [String(line.layer)]));
  for (const via of asArray(snapshot?.vias)) for (const layer of asArray(via?.layers)) layers.add(String(layer));
  return {
    segment_count: lines.length,
    via_count: asArray(snapshot?.vias).length,
    length_nm: lengthKnown ? Math.round(length) : null,
    layer_set: [...layers].sort(),
  };
}

function routingDiff(beforeSnapshot, afterSnapshot) {
  const before = routingSummary(beforeSnapshot);
  const after = routingSummary(afterSnapshot);
  const changes = [];
  for (const net of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (same(before[net], after[net])) continue;
    changes.push(makeEvent('routing_changed', 'routing', 'NOTICE', net, {
      routing_changed: true,
      before: before[net] ?? null,
      after: after[net] ?? null,
    }));
  }
  // A line/via may not carry a reliable net name (or may use an unsupported
  // primitive shape). Preserve a conservative aggregate signal instead of
  // silently claiming zero routing changes. Board-outline geometry is excluded
  // so an outline edit remains a board event, not a routing event.
  const beforeRoutingGeometry = {
    lines: stableSorted(asArray(beforeSnapshot?.geometry?.lines).filter((line) => String(line?.layer) !== '11')),
    arcs: stableSorted(asArray(beforeSnapshot?.geometry?.arcs).filter((arc) => String(arc?.layer) !== '11')),
    vias: stableSorted(beforeSnapshot?.vias),
  };
  const afterRoutingGeometry = {
    lines: stableSorted(asArray(afterSnapshot?.geometry?.lines).filter((line) => String(line?.layer) !== '11')),
    arcs: stableSorted(asArray(afterSnapshot?.geometry?.arcs).filter((arc) => String(arc?.layer) !== '11')),
    vias: stableSorted(afterSnapshot?.vias),
  };
  if (changes.length === 0 && !same(beforeRoutingGeometry, afterRoutingGeometry)) {
    changes.push(makeEvent('routing_changed', 'routing', 'NOTICE', 'UNKNOWN_NET', {
      routing_changed: true,
      fallback: true,
      before: fallbackRoutingSummary(beforeSnapshot),
      after: fallbackRoutingSummary(afterSnapshot),
    }));
  }
  return { changes, before, after };
}

function facetComparison(beforeSnapshot, afterSnapshot) {
  const before = isObject(beforeSnapshot?.facet_hashes) ? beforeSnapshot.facet_hashes : {};
  const after = isObject(afterSnapshot?.facet_hashes) ? afterSnapshot.facet_hashes : {};
  const facets = {};
  for (const name of FACET_NAMES) facets[name] = {
    before: before[name] ?? null,
    after: after[name] ?? null,
    equal: before[name] !== undefined && after[name] !== undefined && before[name] === after[name],
  };
  return {
    before,
    after,
    facets,
    equal: FACET_NAMES.every((name) => facets[name].equal),
  };
}

function summarize(changes) {
  const summary = {
    total_changes: changes.length,
    components: 0,
    properties: 0,
    bom: 0,
    connectivity: 0,
    board_rules: 0,
    routing: 0,
    by_severity: { INFO: 0, NOTICE: 0, WARNING: 0, CRITICAL: 0 },
  };
  for (const change of changes) {
    if (Object.hasOwn(summary, change.category)) summary[change.category] += 1;
    if (Object.hasOwn(summary.by_severity, change.severity)) summary.by_severity[change.severity] += 1;
  }
  return summary;
}

function unwrapSnapshot(input) {
  const envelope = isObject(input) && isObject(input.snapshot) ? input : null;
  const snapshot = envelope ? envelope.snapshot : input;
  const errors = [];
  if (!isObject(snapshot)) errors.push('Input is not a canonical snapshot or capture envelope.');
  const validity = envelope?.validity;
  if (envelope && validity?.valid_snapshot !== true) errors.push('Capture validity.valid_snapshot is not true.');
  if (input?.valid_snapshot === false || input?.valid === false) errors.push('Input explicitly attests an invalid snapshot.');
  if (!snapshot?.snapshot_hash) errors.push('Canonical snapshot_hash is missing.');
  const identity = snapshot?.identity;
  if (!identity?.project_uuid || !identity?.document_uuid || !['pcb', 'schematic'].includes(identity?.document_type)) errors.push('Canonical design identity is incomplete or document type is unknown.');
  return {
    snapshot: snapshot || null,
    errors,
    profile: envelope?.profile?.name || envelope?.validity?.profile_name || null,
  };
}

function identityComparable(snapshot) {
  return {
    project_uuid: snapshot?.identity?.project_uuid ?? null,
    document_uuid: snapshot?.identity?.document_uuid ?? null,
    document_type: snapshot?.identity?.document_type ?? 'unknown',
  };
}

function emptyResult(before, after, errors = []) {
  return {
    schema: SEMANTIC_DIFF_SCHEMA,
    schema_version: SEMANTIC_DIFF_VERSION,
    before_hash: before?.snapshot_hash ?? null,
    after_hash: after?.snapshot_hash ?? null,
    valid: errors.length === 0,
    zero_diff: errors.length === 0,
    identity: { equal: errors.length === 0, before: identityComparable(before), after: identityComparable(after) },
    facet_hashes: facetComparison(before || {}, after || {}),
    summary: summarize([]),
    property_policy: {
      semantic: PROPERTY_DESCRIPTORS.filter((item) => item.className === 'semantic').map((item) => item.name),
      informational: PROPERTY_DESCRIPTORS.filter((item) => item.className === 'informational').map((item) => item.name),
      ignored: IGNORED_PROPERTY_NAMES,
    },
    changes: [],
    raw_connectivity_events: [],
    connectivity: { before: null, after: null },
    errors,
    warnings: [],
  };
}

/**
 * Compare two Gate-A-backed canonical snapshots.  The function never calls
 * EasyEDA; it only consumes the supplied snapshot/capture JSON.
 */
export function semanticDiff(beforeInput, afterInput) {
  const beforeInputInfo = unwrapSnapshot(beforeInput);
  const afterInputInfo = unwrapSnapshot(afterInput);
  const before = beforeInputInfo.snapshot;
  const after = afterInputInfo.snapshot;
  const inputErrors = [...beforeInputInfo.errors.map((error) => `before: ${error}`), ...afterInputInfo.errors.map((error) => `after: ${error}`)];
  if (inputErrors.length) return emptyResult(before, after, inputErrors);
  const beforeIdentity = identityComparable(before);
  const afterIdentity = identityComparable(after);
  if (!same(beforeIdentity, afterIdentity)) {
    return emptyResult(before, after, ['Before/after design identity differs; diff is fail-closed.']);
  }

  const componentResult = componentDiff(before, after);
  const bomResult = bomDiff(before, after);
  const connectivityResult = connectivityDiff(before, after, componentResult.matching);
  const boardRulesResult = boardRulesDiff(before, after);
  const routingResult = routingDiff(before, after);
  const changes = sortEvents([
    ...componentResult.changes,
    ...bomResult.changes,
    ...connectivityResult.changes,
    ...boardRulesResult.changes,
    ...routingResult.changes,
  ]).map((change, index) => ({
    event_id: `EVT-${String(index + 1).padStart(3, '0')}`,
    ...change,
  }));
  const facetHashes = facetComparison(before, after);
  const warnings = [];
  if (!facetHashes.equal && changes.length === 0) warnings.push('Facet hashes differ but no semantic fields changed; inspect canonicalization/runtime separation.');
  return {
    schema: SEMANTIC_DIFF_SCHEMA,
    schema_version: SEMANTIC_DIFF_VERSION,
    before_hash: before.snapshot_hash,
    after_hash: after.snapshot_hash,
    valid: true,
    zero_diff: changes.length === 0,
    identity: { equal: true, before: beforeIdentity, after: afterIdentity },
    profiles: { before: beforeInputInfo.profile, after: afterInputInfo.profile },
    facet_hashes: facetHashes,
    summary: summarize(changes),
    property_policy: {
      semantic: PROPERTY_DESCRIPTORS.filter((item) => item.className === 'semantic').map((item) => item.name),
      informational: PROPERTY_DESCRIPTORS.filter((item) => item.className === 'informational').map((item) => item.name),
      ignored: IGNORED_PROPERTY_NAMES,
    },
    connectivity: { before: connectivityResult.before, after: connectivityResult.after },
    routing: { before: routingResult.before, after: routingResult.after },
    changes,
    raw_connectivity_events: connectivityResult.rawEvents,
    errors: [],
    warnings,
  };
}

function mm(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'EMPTY';
  return (value / 1_000_000).toFixed(3);
}

function signedMm(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'EMPTY';
  const sign = value > 0 ? '+' : '';
  return `${sign}${mm(value)} mm`;
}

function formatValue(value, key = '') {
  if (isEmpty(value)) return 'EMPTY';
  if (typeof value === 'number') {
    if (/_nm$|length_nm|clearance_nm|width_nm|diameter_nm|hole_nm/i.test(key)) return `${mm(value)} mm`;
    if (/microdegree/i.test(key)) return `${(value / 1_000_000).toFixed(3)}°`;
    return String(value);
  }
  if (isObject(value)) {
    if (typeof value.x_nm === 'number' && typeof value.y_nm === 'number') return `(${mm(value.x_nm)} mm, ${mm(value.y_nm)} mm)`;
    if (Object.hasOwn(value, 'name') && Object.hasOwn(value, 'uuid')) return value.name || value.uuid || 'EMPTY';
    return stableStringify(value);
  }
  if (Array.isArray(value)) return stableStringify(value);
  return String(value);
}

function formatMember(member) {
  if (!member) return EMPTY_COMPONENT_LABEL;
  const component = member.component || member.component_identity || EMPTY_COMPONENT_LABEL;
  const pin = member.pin_name ? `${member.pin}/${member.pin_name}` : (member.pin || 'UNKNOWN_PIN');
  return `${component}.${pin}`;
}

function formatChange(change) {
  const severity = change.severity ? ` [${change.severity}]` : '';
  switch (change.type) {
    case 'component_moved': {
      const before = change.before || {};
      const after = change.after || {};
      return [`MOVED${severity}`, change.entity, 'position:', `(${mm(before.x_nm)} mm, ${mm(before.y_nm)} mm)`, '→', `(${mm(after.x_nm)} mm, ${mm(after.y_nm)} mm)`, 'delta:', `${signedMm(change.delta?.x_nm)} X`, `${signedMm(change.delta?.y_nm)} Y`];
    }
    case 'component_rotated':
      return [`ROTATION CHANGED${severity}`, change.entity, `${formatValue(change.before, 'rotation_microdegree')} → ${formatValue(change.after, 'rotation_microdegree')}`];
    case 'property_changed':
      return [`PROPERTY CHANGED${severity}`, `${change.entity}.${change.property}`, formatValue(change.before, change.property), '→', formatValue(change.after, change.property)];
    case 'bom_supplier_id_changed':
      return [`BOM CHANGED${severity}`, `${change.entity}.supplierId`, formatValue(change.before, 'supplierId'), '→', formatValue(change.after, 'supplierId')];
    case 'bom_property_changed':
      return [`BOM CHANGED${severity}`, `${change.entity}.${change.property}`, formatValue(change.before, change.property), '→', formatValue(change.after, change.property)];
    case 'component_added':
      return [`COMPONENT ADDED${severity}`, change.entity];
    case 'component_removed':
      return [`COMPONENT REMOVED${severity}`, change.entity];
    case 'ambiguous_match':
      return [`AMBIGUOUS_MATCH${severity}`, change.entity, `identity field: ${change.identity_field}`];
    case 'connectivity_net_added':
      return [`NET ADDED${severity}`, change.entity, `members: ${change.member_count}`];
    case 'connectivity_net_removed':
      return [`NET REMOVED${severity}`, change.entity, `members: ${change.member_count}`];
    case 'connectivity_member_removed':
      return [`CONNECTIVITY CHANGED${severity}`, change.net || change.entity, 'REMOVED MEMBER:', formatMember(change.member)];
    case 'connectivity_member_added':
      return [`CONNECTIVITY CHANGED${severity}`, change.net || change.entity, 'ADDED MEMBER:', formatMember(change.member)];
    case 'pin_reassigned':
      return [`PIN REASSIGNED${severity}`, formatMember(change.member), change.from_net || 'EMPTY', '→', change.to_net || 'EMPTY'];
    case 'board_bounds_changed':
      return [`BOARD BOUNDS CHANGED${severity}`, 'before:', formatValue(change.before), '→', formatValue(change.after)];
    case 'board_outline_changed':
      return [`BOARD OUTLINE CHANGED${severity}`, change.entity];
    case 'rule_changed':
      return [`RULE CHANGED${severity}`, change.property, formatValue(change.before, change.property), '→', formatValue(change.after, change.property)];
    case 'layer_added':
      return [`LAYER ADDED${severity}`, change.entity];
    case 'layer_removed':
      return [`LAYER REMOVED${severity}`, change.entity];
    case 'layer_changed':
      return [`LAYER CHANGED${severity}`, change.entity];
    case 'routing_changed': {
      const before = change.before || {};
      const after = change.after || {};
      const lines = [`ROUTING CHANGED${severity}`, change.entity, `segments: ${before.segment_count ?? 0} → ${after.segment_count ?? 0}`, `vias: ${before.via_count ?? 0} → ${after.via_count ?? 0}`];
      if (before.length_nm !== null || after.length_nm !== null) lines.push(`length: ${formatValue(before.length_nm, 'length_nm')} → ${formatValue(after.length_nm, 'length_nm')}`);
      return lines;
    }
    default:
      return [`${text(change.type).toUpperCase()}${severity}`, change.entity, stableStringify(change)];
  }
}

const CATEGORY_LABELS = Object.freeze({
  connectivity: 'CONNECTIVITY',
  components: 'COMPONENTS',
  properties: 'PROPERTIES',
  bom: 'BOM',
  board_rules: 'BOARD / RULES',
  routing: 'ROUTING',
});

/** Render the machine diff for a human without changing the underlying model. */
export function renderSemanticDiff(diff) {
  const lines = ['EDA-GUARD SEMANTIC DIFF', ''];
  if (!diff?.valid) {
    lines.push('INVALID SNAPSHOT INPUT', '');
    for (const error of diff?.errors || ['Unknown diff error']) lines.push(`- ${error}`);
    return lines.join('\n');
  }
  if (diff.zero_diff) {
    lines.push('NO DESIGN CHANGES');
    if (diff.warnings?.length) lines.push('', ...diff.warnings.map((warning) => `NOTE: ${warning}`));
    return lines.join('\n');
  }
  const grouped = new Map();
  for (const change of diff.changes || []) {
    if (!grouped.has(change.category)) grouped.set(change.category, []);
    grouped.get(change.category).push(change);
  }
  for (const category of [...grouped.keys()].sort((a, b) => (CATEGORY_ORDER[a] ?? 99) - (CATEGORY_ORDER[b] ?? 99))) {
    lines.push(CATEGORY_LABELS[category] || category.toUpperCase(), '');
    for (const change of grouped.get(category)) {
      lines.push(...formatChange(change), '');
    }
  }
  lines.push('SUMMARY', '', `${diff.summary.total_changes} semantic changes`);
  for (const [key, label] of [['components', 'component'], ['properties', 'property'], ['bom', 'BOM'], ['connectivity', 'connectivity'], ['board_rules', 'board/rule'], ['routing', 'routing']]) {
    if (diff.summary[key]) lines.push(`${diff.summary[key]} ${label} change${diff.summary[key] === 1 ? '' : 's'}`);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function diffHash(value) {
  return hashObject(value);
}
