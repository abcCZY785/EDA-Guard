import { hashObject, sortByKeys } from './hash.mjs';

export const CANONICAL_SCHEMA_VERSION = '0.1.0';
export const LENGTH_UNIT = 'nm';
export const ANGLE_UNIT = 'microdegree';

export function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function milToNm(value) {
  const n = asNumber(value);
  return n === null ? null : Math.round(n * 25_400);
}

/** Schematic coordinates are documented as hundredths of an inch (10 mil). */
export function schematicUnitToNm(value) {
  const n = asNumber(value);
  return n === null ? null : Math.round(n * 254_000);
}

export function angleToMicrodegree(value) {
  const n = asNumber(value);
  if (n === null) return null;
  const full = 360_000_000;
  return ((Math.round(n * 1_000_000) % full) + full) % full;
}

export function pointToNm(point, unit = 'mil') {
  if (Array.isArray(point)) {
    return point.map((entry) => Array.isArray(entry) ? pointToNm(entry, unit) : (unit === 'schematic' ? schematicUnitToNm(entry) : milToNm(entry)));
  }
  if (point && typeof point === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(point)) {
      if (/^(x|y|cx|cy|radius|width|height|startX|startY|endX|endY)$/i.test(key)) {
        out[`${key}_nm`] = unit === 'schematic' ? schematicUnitToNm(value) : milToNm(value);
      } else if (Array.isArray(value)) {
        out[key] = pointToNm(value, unit);
      } else {
        out[key] = value;
      }
    }
    return out;
  }
  return point;
}

function rawItems(facet) {
  return Array.isArray(facet?.items) ? facet.items : [];
}

function identityFor(item) {
  const uniqueId = item?.unique_id ?? item?.uniqueId ?? null;
  const primitiveId = item?.primitive_id ?? item?.primitiveId ?? null;
  const designator = item?.designator ?? null;
  return {
    key: uniqueId || primitiveId || designator || null,
    unique_id: uniqueId,
    primitive_id: primitiveId,
    designator,
    confidence: uniqueId ? 'high' : (primitiveId ? 'medium' : 'low'),
  };
}

function normalizeComponent(item, unit) {
  const id = identityFor(item);
  const other = item?.other_property ?? item?.otherProperty ?? {};
  const footprint = item?.footprint_name ?? item?.footprintName ?? null;
  return {
    identity: id,
    name: item?.name ?? item?.value ?? null,
    value: item?.value ?? other?.Value ?? null,
    x_nm: unit === 'schematic' ? schematicUnitToNm(item?.x) : milToNm(item?.x),
    y_nm: unit === 'schematic' ? schematicUnitToNm(item?.y) : milToNm(item?.y),
    rotation_microdegree: angleToMicrodegree(item?.rotation),
    mirror: item?.mirror ?? null,
    layer: item?.layer ?? null,
    footprint_uuid: item?.footprint_uuid ?? item?.footprintUuid ?? footprint?.uuid ?? null,
    footprint_name: typeof footprint === 'object' ? (footprint?.name ?? null) : footprint,
    manufacturer_id: item?.manufacturer_id ?? item?.manufacturerId ?? null,
    supplier_id: item?.supplier_id ?? item?.supplierId ?? null,
    other_property: other,
    is_business_component: Boolean(item?.is_business_component ?? item?.designator),
  };
}

function normalizePad(item, unit) {
  const length = unit === 'schematic' ? schematicUnitToNm : milToNm;
  return {
    primitive_id: item?.primitive_id ?? item?.primitiveId ?? null,
    component_primitive_id: item?.component_primitive_id ?? item?.componentPrimitiveId ?? null,
    number: item?.number ?? item?.pad_number ?? item?.padNumber ?? null,
    name: item?.name ?? null,
    net: item?.net ?? null,
    x_nm: unit === 'schematic' ? schematicUnitToNm(item?.x) : milToNm(item?.x),
    y_nm: unit === 'schematic' ? schematicUnitToNm(item?.y) : milToNm(item?.y),
    rotation_microdegree: angleToMicrodegree(item?.rotation),
    layer: item?.layer ?? null,
    pad_type: item?.pad_type ?? item?.padType ?? null,
    shape: item?.shape ?? item?.pad_shape ?? item?.padShape ?? null,
    hole_nm: length(item?.hole),
    metallization: item?.metallization ?? null,
  };
}

function normalizeGeometry(item, unit, kind) {
  const length = unit === 'schematic' ? schematicUnitToNm : milToNm;
  const rawSource = item?.source ?? item?.line ?? item?.polygon ?? item?.path ?? null;
  const nestedPoints = Array.isArray(rawSource) && rawSource.some((entry) => Array.isArray(entry));
  const rectangle = Array.isArray(rawSource) && String(rawSource[0]).toUpperCase() === 'R' && rawSource.length >= 5
    ? { x_nm: length(rawSource[1]), y_nm: length(rawSource[2]), width_nm: length(rawSource[3]), height_nm: length(rawSource[4]) }
    : null;
  const flatLine = Array.isArray(rawSource) && rawSource.length >= 4 && rawSource.slice(0, 4).every((value) => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))));
  const out = {
    kind,
    primitive_id: item?.primitive_id ?? item?.primitiveId ?? null,
    layer: item?.layer ?? null,
    net: item?.net ?? null,
    line_width_nm: length(item?.line_width ?? item?.lineWidth),
    source_raw: rawSource,
    source: nestedPoints ? pointToNm(rawSource, unit) : null,
    start: item?.start ? pointToNm(item.start, unit) : (flatLine ? { x_nm: unit === 'schematic' ? schematicUnitToNm(rawSource[0]) : milToNm(rawSource[0]), y_nm: unit === 'schematic' ? schematicUnitToNm(rawSource[1]) : milToNm(rawSource[1]) } : null),
    end: item?.end ? pointToNm(item.end, unit) : (flatLine ? { x_nm: unit === 'schematic' ? schematicUnitToNm(rawSource[2]) : milToNm(rawSource[2]), y_nm: unit === 'schematic' ? schematicUnitToNm(rawSource[3]) : milToNm(rawSource[3]) } : null),
    center: item?.center ? pointToNm(item.center, unit) : null,
    rotation_microdegree: angleToMicrodegree(item?.rotation),
    points: Array.isArray(item?.points) && item.points.some((entry) => Array.isArray(entry)) ? pointToNm(item.points, unit) : null,
    closed: rectangle ? true : (item?.closed ?? null),
    rectangle,
    width_nm: length(item?.width),
    height_nm: length(item?.height),
  };
  if (kind === 'polyline' && Array.isArray(out.points) && out.points.length > 1) {
    const first = JSON.stringify(out.points[0]);
    const last = JSON.stringify(out.points[out.points.length - 1]);
    out.closed = out.closed === true || first === last;
  }
  return out;
}

function normalizeNet(item) {
  if (typeof item === 'string') return { name: item, pins: [] };
  return {
    name: item?.name ?? item?.net ?? item?.net_name ?? null,
    pins: sortByKeys(item?.pins ?? item?.members ?? [], ['component', 'designator', 'pin', 'number']).map((pin) => ({
      component: pin?.component ?? pin?.designator ?? null,
      pin: pin?.pin ?? pin?.number ?? pin?.pad ?? null,
    })),
  };
}

function facetItems(facets, ...names) {
  for (const name of names) if (facets?.[name]) return rawItems(facets[name]);
  return [];
}

export function canonicalizeCapture(rawCapture, { hashFacets = null } = {}) {
  const identity = rawCapture?.identity || {};
  const rawDocumentType = identity.document_type ?? rawCapture?.document?.type;
  const documentType = rawDocumentType === 1 || rawDocumentType === '1' ? 'schematic'
    : (rawDocumentType === 3 || rawDocumentType === '3' ? 'pcb' : (rawDocumentType || 'unknown'));
  const unit = documentType === 'schematic' ? 'schematic' : 'mil';
  const facets = rawCapture?.facets || {};

  const components = sortByKeys(
    facetItems(facets, 'schematic_components', 'pcb_components').map((item) => normalizeComponent(item, unit)),
    ['identity.key', 'identity.designator'],
  );
  const pads = sortByKeys(
    facetItems(facets, 'schematic_pins', 'pcb_pads').map((item) => normalizePad(item, unit)),
    ['component_primitive_id', 'primitive_id', 'number'],
  );
  const lines = facetItems(facets, 'pcb_lines', 'schematic_wires').map((item) => normalizeGeometry(item, unit, documentType === 'schematic' ? 'schematic_wire' : 'line'));
  const arcs = facetItems(facets, 'pcb_arcs').map((item) => normalizeGeometry(item, unit, 'arc'));
  const polylines = facetItems(facets, 'pcb_polylines').map((item) => normalizeGeometry(item, unit, 'polyline'));
  const vias = sortByKeys(facetItems(facets, 'pcb_vias').map((item) => ({
    primitive_id: item?.primitive_id ?? item?.primitiveId ?? null,
    net: item?.net ?? null,
    x_nm: milToNm(item?.x),
    y_nm: milToNm(item?.y),
    diameter_nm: milToNm(item?.diameter),
    hole_nm: milToNm(item?.hole),
    layers: item?.layers ?? null,
  })), ['primitive_id', 'net', 'x_nm', 'y_nm']);
  const directNets = facetItems(facets, 'schematic_nets').map(normalizeNet);
  const manufactureNets = facetItems(facets, 'manufacture_nets').flatMap((item) => {
    if (Array.isArray(item?.nets)) return item.nets.map(normalizeNet);
    return [normalizeNet(item)];
  });
  const pcbNets = facetItems(facets, 'pcb_nets').map(normalizeNet);

  const geometry = {
    lines: sortByKeys(lines, ['kind', 'primitive_id', 'layer', 'net']),
    arcs: sortByKeys(arcs, ['primitive_id', 'layer', 'net']),
    polylines: sortByKeys(polylines, ['primitive_id', 'layer']),
    board_outline: sortByKeys([...lines, ...arcs, ...polylines].filter((item) => item.layer === 11 || item.layer === '11'), ['kind', 'primitive_id']),
    regions: sortByKeys(facetItems(facets, 'pcb_regions').map((item) => normalizeGeometry(item, unit, 'region')), ['primitive_id']),
    pours: sortByKeys(facetItems(facets, 'pcb_pours').map((item) => normalizeGeometry(item, unit, 'pour')), ['primitive_id']),
    fills: sortByKeys(facetItems(facets, 'pcb_fills').map((item) => normalizeGeometry(item, unit, 'fill')), ['primitive_id']),
  };
  const connectivity = {
    direct_nets: sortByKeys(directNets, ['name']),
    manufacture_nets: sortByKeys(manufactureNets, ['name']),
    pcb_nets: sortByKeys(pcbNets, ['name']),
    preferred_source: manufactureNets.length ? 'manufacture_netlist' : (pcbNets.length ? 'pcb_api' : null),
  };
  const facetValues = {
    components,
    pads,
    connectivity,
    geometry,
    vias,
    bom: components.filter((item) => item.is_business_component).map((item) => ({
      designator: item.identity.designator,
      unique_id: item.identity.unique_id,
      value: item.value,
      footprint_uuid: item.footprint_uuid,
      supplier_id: item.supplier_id,
      manufacturer_id: item.manufacturer_id,
    })).sort((a, b) => String(a.designator || '').localeCompare(String(b.designator || ''))),
    rules: facets.pcb_rules?.items ?? null,
    layers: facets.pcb_layers?.items ?? null,
  };
  const facetHashes = {};
  for (const [name, value] of Object.entries(facetValues)) facetHashes[name] = hashObject(value);
  const contentForHash = Array.isArray(hashFacets) && hashFacets.length
    ? Object.fromEntries(hashFacets.filter((name) => Object.hasOwn(facetValues, name)).map((name) => [name, facetValues[name]]))
    : facetValues;
  const snapshot = {
    schema_version: CANONICAL_SCHEMA_VERSION,
    units: { length: LENGTH_UNIT, angle: ANGLE_UNIT },
    identity: {
      project_uuid: identity.project_uuid ?? null,
      document_uuid: identity.document_uuid ?? null,
      document_type: documentType,
    },
    components,
    pads,
    connectivity,
    geometry,
    vias,
    bom: facetValues.bom,
    rules: facetValues.rules,
    layers: facetValues.layers,
    facet_hashes: facetHashes,
    // Only design identity and profile-selected design facets enter this hash.
    // Bridge URL, window ID, timestamps, editor/API versions and evidence
    // labels stay in the manifest/runtime envelope and cannot perturb it.
    snapshot_hash: hashObject({ ...contentForHash, identity: snapshotIdentity(identity, documentType) }),
  };
  return snapshot;
}

function snapshotIdentity(identity, documentType) {
  return {
    project_uuid: identity.project_uuid ?? null,
    document_uuid: identity.document_uuid ?? null,
    document_type: documentType,
  };
}

export function criticalFacetHash(snapshot, { profile = null } = {}) {
  const fullGeometry = snapshot?.geometry;
  const geometry = profile?.advanced_non_blocking && fullGeometry
    ? {
      // Basic profiles require line/polyline geometry.  Arc and copper
      // derived geometry are optional and must not make a basic repeat fail.
      lines: fullGeometry.lines,
      polylines: fullGeometry.polylines,
      board_outline: (fullGeometry.board_outline || []).filter((item) => item?.kind === 'line' || item?.kind === 'polyline'),
    }
    : fullGeometry;
  return hashObject({
    identity: snapshot?.identity,
    components: snapshot?.components,
    pads: snapshot?.pads,
    connectivity: snapshot?.connectivity,
    geometry,
    vias: snapshot?.vias,
  });
}
