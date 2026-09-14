/**
 * Build the JavaScript executed inside EasyEDA. The script is intentionally
 * read-only: it only calls getters/inspectors and never opens, edits, saves,
 * selects, or switches a document.
 */
export function buildCaptureScript({ includeDrc = true } = {}) {
  return `return await (async () => {
    const has = (value) => value !== null && value !== undefined;
    const safeJson = (value, depth = 0, seen = new WeakSet()) => {
      if (value === undefined || value === null) return value ?? null;
      if (typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'bigint') return Number(value);
      if (typeof value === 'function') return null;
      if (depth > 5) return '[Object]';
      if (Array.isArray(value)) return value.slice(0, 10000).map((entry) => safeJson(entry, depth + 1, seen));
      if (typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        const out = {};
        for (const key of Object.keys(value).slice(0, 200)) {
          try { out[key] = safeJson(value[key], depth + 1, seen); } catch { out[key] = null; }
        }
        return out;
      }
      return String(value);
    };
    const read = (object, methodNames, fallback = null) => {
      if (!object) return fallback;
      for (const name of methodNames) {
        try {
          if (typeof object[name] === 'function') return safeJson(object[name]());
          if (has(object[name])) return safeJson(object[name]);
        } catch { /* one unavailable getter must not discard the component */ }
      }
      return fallback;
    };
    const readRaw = (object, methodNames, fallback = null) => {
      if (!object) return fallback;
      for (const name of methodNames) {
        try {
          if (typeof object[name] === 'function') return object[name]();
          if (has(object[name])) return object[name];
        } catch { /* try the next spelling */ }
      }
      return fallback;
    };
    const invoke = async (object, methodNames, args = []) => {
      if (!object) throw new Error('API namespace is unavailable');
      let found = false;
      let lastError;
      for (const name of methodNames) {
        if (typeof object[name] !== 'function') continue;
        found = true;
        try { return await object[name](...args); } catch (error) { lastError = error; }
      }
      if (!found) throw new Error('Unsupported API method: ' + methodNames.join(' / '));
      throw lastError || new Error('API method failed');
    };
    const invokeOptional = async (object, methodNames, args = []) => {
      if (!object || !methodNames.some((name) => typeof object[name] === 'function')) return { supported: false };
      try { return { supported: true, value: await invoke(object, methodNames, args) }; }
      catch (error) { return { supported: true, error: String(error?.message || error) }; }
    };
    const list = (value) => Array.isArray(value) ? value : (has(value) ? [value] : []);
    const facets = {};
    const facet = async (name, source, producer, { scalar = false } = {}) => {
      try {
        const result = await producer();
        if (result && result.__unsupported) {
          facets[name] = { facet: name, source, status: 'unsupported', evidence: 'UNKNOWN', count: null, items: null, error: result.reason };
          return;
        }
        const value = scalar ? safeJson(result) : safeJson(result);
        const empty = value === null || value === undefined || (Array.isArray(value) && value.length === 0) || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
        const count = name === 'manufacture_nets' && Array.isArray(value) && value[0] && Array.isArray(value[0].nets)
          ? value[0].nets.length
          : (Array.isArray(value) ? value.length : (empty ? 0 : 1));
        facets[name] = { facet: name, source, status: empty ? 'verified_empty' : 'ok', evidence: 'READ', count, items: value, error: null };
      } catch (error) {
        const message = String(error?.message || error);
        const unsupported = message.startsWith('Unsupported API method') || message.includes('API namespace is unavailable');
        facets[name] = { facet: name, source, status: unsupported ? 'unsupported' : 'error', evidence: unsupported ? 'UNKNOWN' : 'READ', count: null, items: null, error: message };
      }
    };
    const mapComponent = (component, domain) => ({
      primitive_id: read(component, ['getState_PrimitiveId', 'getPrimitiveId']),
      unique_id: read(component, ['getState_UniqueId', 'getUniqueId']),
      designator: read(component, ['getState_Designator', 'getDesignator']),
      name: read(component, ['getState_Name', 'getName']),
      value: read(component, ['getState_Value', 'getValue']),
      x: read(component, ['getState_X', 'getX']),
      y: read(component, ['getState_Y', 'getY']),
      rotation: read(component, ['getState_Rotation', 'getRotation']),
      mirror: read(component, ['getState_Mirror', 'getMirror']),
      layer: read(component, ['getState_Layer', 'getLayer']),
      manufacturer: read(component, ['getState_Manufacturer', 'getManufacturer']),
      manufacturer_id: read(component, ['getState_ManufacturerId', 'getManufacturerId']),
      supplier: read(component, ['getState_Supplier', 'getSupplier']),
      supplier_id: read(component, ['getState_SupplierId', 'getSupplierId']),
      footprint_uuid: read(component, ['getState_FootprintUuid', 'getState_FootprintUUID', 'getFootprintUuid', 'getFootprintUUID']),
      footprint_name: read(component, ['getState_Footprint', 'getState_FootprintName', 'getFootprint', 'getFootprintName']),
      other_property: read(component, ['getState_OtherProperty', 'getOtherProperty']),
      is_business_component: Boolean(read(component, ['getState_Designator', 'getDesignator'])) || domain === 'pcb',
    });
    const mapSchematicPin = (pin, parentId) => ({
      primitive_id: read(pin, ['getState_PrimitiveId', 'getPrimitiveId']),
      component_primitive_id: parentId,
      number: read(pin, ['getState_PinNumber', 'getState_Number', 'getPinNumber', 'getNumber']),
      name: read(pin, ['getState_PinName', 'getState_Name', 'getPinName', 'getName']),
      net: read(pin, ['getState_Net', 'getNet']),
      x: read(pin, ['getState_X', 'getX']),
      y: read(pin, ['getState_Y', 'getY']),
      rotation: read(pin, ['getState_Rotation', 'getRotation']),
      layer: read(pin, ['getState_Layer', 'getLayer']),
    });
    const mapPcbPad = (pad, parentId = null) => {
      const hole = readRaw(pad, ['getState_Hole', 'getHole']);
      return {
        primitive_id: read(pad, ['getState_PrimitiveId', 'getPrimitiveId']),
        component_primitive_id: parentId,
        number: read(pad, ['getState_PadNumber', 'getPadNumber']),
        name: read(pad, ['getState_Name', 'getName']),
        net: read(pad, ['getState_Net', 'getNet']),
        x: read(pad, ['getState_X', 'getX']),
        y: read(pad, ['getState_Y', 'getY']),
        rotation: read(pad, ['getState_Rotation', 'getRotation']),
        layer: read(pad, ['getState_Layer', 'getLayer']),
        pad_type: read(pad, ['getState_PadType', 'getPadType']),
        shape: read(pad, ['getState_PadShape', 'getState_Shape', 'getPadShape', 'getShape']),
        hole: hole && typeof hole === 'object' ? (read(hole, ['getState_Diameter', 'getState_HoleDiameter', 'getDiameter', 'getHoleDiameter']) ?? safeJson(hole)) : hole,
        metallization: read(pad, ['getState_Metallization', 'getMetallization']),
      };
    };
    const mapPcbLine = (line) => ({
      primitive_id: read(line, ['getState_PrimitiveId', 'getPrimitiveId']),
      primitive_type: read(line, ['getState_PrimitiveType', 'getPrimitiveType']),
      layer: read(line, ['getState_Layer', 'getLayer']),
      net: read(line, ['getState_Net', 'getNet']),
      line_width: read(line, ['getState_LineWidth', 'getLineWidth']),
      start: { x: read(line, ['getState_StartX', 'getStartX']), y: read(line, ['getState_StartY', 'getStartY']) },
      end: { x: read(line, ['getState_EndX', 'getEndX']), y: read(line, ['getState_EndY', 'getEndY']) },
    });
    const mapPcbArc = (arc) => ({
      primitive_id: read(arc, ['getState_PrimitiveId', 'getPrimitiveId']),
      primitive_type: read(arc, ['getState_PrimitiveType', 'getPrimitiveType']),
      layer: read(arc, ['getState_Layer', 'getLayer']),
      net: read(arc, ['getState_Net', 'getNet']),
      line_width: read(arc, ['getState_LineWidth', 'getLineWidth']),
      start: { x: read(arc, ['getState_StartX', 'getStartX']), y: read(arc, ['getState_StartY', 'getStartY']) },
      end: { x: read(arc, ['getState_EndX', 'getEndX']), y: read(arc, ['getState_EndY', 'getEndY']) },
      rotation: read(arc, ['getState_ArcAngle', 'getArcAngle']),
    });
    const mapPcbPolyline = (polyline) => {
      const polygon = readRaw(polyline, ['getState_Polygon', 'getPolygon']);
      const source = polygon && typeof polygon === 'object' ? read(polygon, ['getSource', 'getState_Source', 'getState_Points']) : polygon;
      return {
        primitive_id: read(polyline, ['getState_PrimitiveId', 'getPrimitiveId']),
        primitive_type: read(polyline, ['getState_PrimitiveType', 'getPrimitiveType']),
        layer: read(polyline, ['getState_Layer', 'getLayer']),
        net: read(polyline, ['getState_Net', 'getNet']),
        line_width: read(polyline, ['getState_LineWidth', 'getLineWidth']),
        source,
        points: Array.isArray(source) ? source : null,
      };
    };
    const mapPcbVia = (via) => ({
      primitive_id: read(via, ['getState_PrimitiveId', 'getPrimitiveId']),
      primitive_type: read(via, ['getState_PrimitiveType', 'getPrimitiveType']),
      net: read(via, ['getState_Net', 'getNet']),
      x: read(via, ['getState_X', 'getX']),
      y: read(via, ['getState_Y', 'getY']),
      diameter: read(via, ['getState_Diameter', 'getDiameter']),
      hole: read(via, ['getState_HoleDiameter', 'getHoleDiameter']),
      via_type: read(via, ['getState_ViaType', 'getViaType']),
    });
    const mapWire = (wire) => ({
      primitive_id: read(wire, ['getState_PrimitiveId', 'getPrimitiveId']),
      primitive_type: read(wire, ['getState_PrimitiveType', 'getPrimitiveType']),
      net: read(wire, ['getState_Net', 'getNet']),
      line: read(wire, ['getState_Line', 'getLine']),
      line_type: read(wire, ['getState_LineType', 'getLineType']),
      line_width: read(wire, ['getState_LineWidth', 'getLineWidth']),
    });
    const docTypeValue = read(eda?.dmt_SelectControl, ['getCurrentDocumentInfo'])?.documentType;
    const docInfo = safeJson(await invoke(eda?.dmt_SelectControl, ['getCurrentDocumentInfo']));
    const projectInfo = safeJson(await invoke(eda?.dmt_Project, ['getCurrentProjectInfo']));
    const editorVersion = safeJson(await invoke(eda?.sys_Environment, ['getEditorCurrentVersion']));
    const documentType = docTypeValue === 1 || docInfo?.documentType === 1 ? 'schematic' : (docTypeValue === 3 || docInfo?.documentType === 3 ? 'pcb' : 'unknown');
    const identity = {
      project_uuid: projectInfo?.uuid ?? projectInfo?.projectUuid ?? projectInfo?.id ?? null,
      project_name: projectInfo?.name ?? projectInfo?.title ?? null,
      project_info: projectInfo,
      document_uuid: docInfo?.documentUuid ?? docInfo?.uuid ?? docInfo?.documentId ?? null,
      document_name: docInfo?.documentName ?? docInfo?.name ?? docInfo?.title ?? null,
      document_type: documentType,
      document_type_value: docInfo?.documentType ?? null,
      document_info: docInfo,
      editor_version: editorVersion,
    };
    const capability_presence = {
      identity: {
        editor_version: typeof eda?.sys_Environment?.getEditorCurrentVersion === 'function',
        project_info: typeof eda?.dmt_Project?.getCurrentProjectInfo === 'function',
        document_info: typeof eda?.dmt_SelectControl?.getCurrentDocumentInfo === 'function',
      },
      schematic: {
        components: typeof eda?.sch_PrimitiveComponent?.getAll === 'function',
        component_pins: typeof eda?.sch_PrimitiveComponent?.getAllPinsByPrimitiveId === 'function',
        wires: typeof eda?.sch_PrimitiveWire?.getAll === 'function',
        direct_nets: typeof eda?.sch_Net?.getAllNets === 'function',
        manufacture_netlist: typeof eda?.sch_ManufactureData?.getNetlistFile === 'function',
        drc: typeof eda?.sch_Drc?.check === 'function',
      },
      pcb: {
        components: typeof eda?.pcb_PrimitiveComponent?.getAll === 'function',
        pads: typeof eda?.pcb_PrimitivePad?.getAll === 'function',
        lines: typeof eda?.pcb_PrimitiveLine?.getAll === 'function',
        arcs: typeof eda?.pcb_PrimitiveArc?.getAll === 'function',
        polylines: typeof eda?.pcb_PrimitivePolyline?.getAll === 'function',
        vias: typeof eda?.pcb_PrimitiveVia?.getAll === 'function',
        pours: typeof eda?.pcb_PrimitivePour?.getAll === 'function',
        regions: typeof eda?.pcb_PrimitiveRegion?.getAll === 'function',
        fills: typeof eda?.pcb_PrimitiveFill?.getAll === 'function',
        nets: typeof eda?.pcb_Net?.getAllNetsName === 'function',
        drc: typeof eda?.pcb_Drc?.check === 'function',
        rules: typeof eda?.pcb_Drc?.getCurrentRuleConfiguration === 'function',
        layers: typeof eda?.pcb_Layer?.getAllLayers === 'function',
      },
    };
    if (documentType === 'schematic') {
      await facet('schematic_components', 'official-api:sch_PrimitiveComponent.getAll', async () => {
        const components = list(await invoke(eda.sch_PrimitiveComponent, ['getAll']));
        return components.map((component) => mapComponent(component, 'schematic'));
      });
      await facet('schematic_pins', 'official-api:sch_PrimitiveComponent.getAllPinsByPrimitiveId', async () => {
        if (typeof eda.sch_PrimitiveComponent?.getAllPinsByPrimitiveId !== 'function') return { __unsupported: true, reason: 'Pin getter is not exposed.' };
        const components = list(await invoke(eda.sch_PrimitiveComponent, ['getAll']));
        const pins = [];
        for (const component of components) {
          const parentId = read(component, ['getState_PrimitiveId', 'getPrimitiveId']);
          try { pins.push(...list(await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(parentId)).map((pin) => mapSchematicPin(pin, parentId))); } catch { /* keep the component */ }
        }
        return pins;
      });
      await facet('schematic_wires', 'official-api:sch_PrimitiveWire.getAll', async () => list(await invoke(eda.sch_PrimitiveWire, ['getAll'])).map(mapWire));
      await facet('schematic_nets', 'official-api:sch_Net.getAllNets', async () => list(await invoke(eda.sch_Net, ['getAllNets'])).map((net) => ({ name: read(net, ['getState_Name', 'getName']), pins: safeJson(read(net, ['getState_Pins', 'getPins', 'getState_Members', 'getMembers'], [])) })));
      await facet('manufacture_nets', 'official-api:sch_ManufactureData.getNetlistFile(Allegro)', async () => {
        const file = await invoke(eda.sch_ManufactureData, ['getNetlistFile'], [undefined, 'Allegro']);
        if (!file) return null;
        let text = null;
        try { if (typeof file.text === 'function') text = await file.text(); } catch { text = null; }
        const rawText = typeof text === 'string' ? text.slice(0, 2_000_000) : null;
        const nets = [];
        let inNets = false;
        for (const rawLine of String(rawText || '').split(/\\r?\\n/)) {
          const line = rawLine.trim();
          if (!line) continue;
          if (/^\\$NETS/i.test(line)) { inNets = true; continue; }
          if (/^\\$END/i.test(line)) { inNets = false; continue; }
          if (!inNets) continue;
          const netLine = line.match(/^'?([^';]+?)'?\\s*;\\s*(.*)$/);
          if (!netLine) continue;
          const name = netLine[1].trim();
          const pins = netLine[2].trim().split(/\\s+/).filter(Boolean).map((token) => {
            const separator = token.indexOf('.');
            return separator > 0 ? { component: token.slice(0, separator), pin: token.slice(separator + 1) } : { component: token, pin: null };
          });
          nets.push({ name, pins });
        }
        return [{ file_name: safeJson(file?.name), file_size: safeJson(file?.size), format: 'Allegro', text: rawText, nets }];
      });
      if (${Boolean(includeDrc)}) await facet('schematic_drc', 'official-api:sch_Drc.check', async () => invoke(eda.sch_Drc, ['check'], [false, false, true]));
    } else if (documentType === 'pcb') {
      await facet('pcb_components', 'official-api:pcb_PrimitiveComponent.getAll', async () => {
        const components = list(await invoke(eda.pcb_PrimitiveComponent, ['getAll']));
        return components.map((component) => mapComponent(component, 'pcb'));
      });
      await facet('pcb_pads', 'official-api:pcb_PrimitivePad.getAll', async () => list(await invoke(eda.pcb_PrimitivePad, ['getAll'])).map((pad) => mapPcbPad(pad)));
      await facet('pcb_component_pads', 'official-api:pcb_PrimitiveComponent.getAllPinsByPrimitiveId', async () => {
        if (typeof eda.pcb_PrimitiveComponent?.getAllPinsByPrimitiveId !== 'function') return { __unsupported: true, reason: 'Component pad getter is not exposed.' };
        const components = list(await invoke(eda.pcb_PrimitiveComponent, ['getAll']));
        const pads = [];
        for (const component of components) {
          const parentId = read(component, ['getState_PrimitiveId', 'getPrimitiveId']);
          try { pads.push(...list(await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(parentId)).map((pad) => mapPcbPad(pad, parentId))); } catch { /* keep global pads */ }
        }
        return pads;
      });
      await facet('pcb_lines', 'official-api:pcb_PrimitiveLine.getAll', async () => list(await invoke(eda.pcb_PrimitiveLine, ['getAll'])).map(mapPcbLine));
      await facet('pcb_arcs', 'official-api:pcb_PrimitiveArc.getAll', async () => list(await invoke(eda.pcb_PrimitiveArc, ['getAll'])).map(mapPcbArc));
      await facet('pcb_polylines', 'official-api:pcb_PrimitivePolyline.getAll', async () => list(await invoke(eda.pcb_PrimitivePolyline, ['getAll'])).map(mapPcbPolyline));
      await facet('pcb_vias', 'official-api:pcb_PrimitiveVia.getAll', async () => list(await invoke(eda.pcb_PrimitiveVia, ['getAll'])).map(mapPcbVia));
      const primitiveCollections = [
        ['pcb_pours', 'pcb_PrimitivePour'], ['pcb_regions', 'pcb_PrimitiveRegion'], ['pcb_fills', 'pcb_PrimitiveFill'], ['pcb_attributes', 'pcb_PrimitiveAttribute'],
      ];
      for (const [name, namespace] of primitiveCollections) {
        await facet(name, 'official-api:' + namespace + '.getAll', async () => {
          const api = eda[namespace];
          if (!api || typeof api.getAll !== 'function') return { __unsupported: true, reason: namespace + '.getAll is not exposed.' };
          return list(await api.getAll()).map((item) => ({
            primitive_id: read(item, ['getState_PrimitiveId', 'getPrimitiveId']),
            primitive_type: read(item, ['getState_PrimitiveType', 'getPrimitiveType']),
            layer: read(item, ['getState_Layer', 'getLayer']),
            net: read(item, ['getState_Net', 'getNet']),
            line_width: read(item, ['getState_LineWidth', 'getLineWidth']),
            source: safeJson(readRaw(item, ['getState_Polygon', 'getState_Source', 'getSource', 'getState_Points', 'getPoints'])),
          }));
        });
      }
      await facet('pcb_nets', 'official-api:pcb_Net.getAllNetsName', async () => list(await invoke(eda.pcb_Net, ['getAllNetsName'])).map((name) => ({ name: String(name), pins: [] })));
      await facet('pcb_rules', 'official-api:pcb_Drc.rule-configuration', async () => {
        const result = {};
        for (const [key, api, methods] of [
          ['configuration', eda.pcb_Drc, ['getCurrentRuleConfiguration']],
          ['net_rules', eda.pcb_Drc, ['getNetRules']],
          ['net_by_net_rules', eda.pcb_Drc, ['getNetByNetRules']],
          ['net_classes', eda.pcb_Drc, ['getAllNetClasses']],
          ['differential_pairs', eda.pcb_Drc, ['getAllDifferentialPairs']],
          ['equal_length_groups', eda.pcb_Drc, ['getAllEqualLengthNetGroups']],
          ['pad_pair_groups', eda.pcb_Drc, ['getAllPadPairGroups']],
          ['region_rules', eda.pcb_Drc, ['getRegionRules']],
        ]) {
          const optional = await invokeOptional(api, methods);
          if (optional.supported) result[key] = optional.error ? { error: optional.error } : safeJson(optional.value);
        }
        return result;
      }, { scalar: true });
      await facet('pcb_layers', 'official-api:pcb_Layer.getAllLayers', async () => {
        const layers = list(await invoke(eda.pcb_Layer, ['getAllLayers']));
        const stack = await invokeOptional(eda.pcb_Layer, ['getAllPhysicalStackingConfigurations']);
        return { layers: safeJson(layers), physical_stacking: stack.supported ? safeJson(stack.value) : null };
      }, { scalar: true });
      if (${Boolean(includeDrc)}) await facet('pcb_drc', 'official-api:pcb_Drc.check', async () => invoke(eda.pcb_Drc, ['check'], [false, false, true]));
    } else {
      facets.document = { facet: 'document', source: 'official-api:dmt_SelectControl.getCurrentDocumentInfo', status: 'error', evidence: 'READ', count: null, items: null, error: 'Current document type is unknown; capture is fail-closed.' };
    }
    return { identity, capability_presence, facets, read_only: true };
  })()`;
}

/** A small identity-only read used immediately before and after a capture. */
export function buildIdentityScript() {
  return `return await (async () => {
    const safe = (value, depth = 0, seen = new WeakSet()) => {
      if (value === undefined || value === null) return value ?? null;
      if (typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'function') return null;
      if (depth > 3) return '[Object]';
      if (Array.isArray(value)) return value.slice(0, 100).map((v) => safe(v, depth + 1, seen));
      if (typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        const out = {};
        for (const key of Object.keys(value).slice(0, 100)) { try { out[key] = safe(value[key], depth + 1, seen); } catch { out[key] = null; } }
        return out;
      }
      return String(value);
    };
    const call = async (object, name) => {
      if (!object || typeof object[name] !== 'function') throw new Error('Unsupported identity API: ' + name);
      return safe(await object[name]());
    };
    const documentInfo = await call(eda.dmt_SelectControl, 'getCurrentDocumentInfo');
    const projectInfo = await call(eda.dmt_Project, 'getCurrentProjectInfo');
    const editorVersion = await call(eda.sys_Environment, 'getEditorCurrentVersion');
    const typeValue = documentInfo?.documentType ?? null;
    const documentType = typeValue === 1 ? 'schematic' : (typeValue === 3 ? 'pcb' : 'unknown');
    return {
      project_uuid: projectInfo?.uuid ?? projectInfo?.projectUuid ?? projectInfo?.id ?? null,
      project_name: projectInfo?.name ?? projectInfo?.title ?? null,
      document_uuid: documentInfo?.documentUuid ?? documentInfo?.uuid ?? documentInfo?.documentId ?? null,
      document_name: documentInfo?.documentName ?? documentInfo?.name ?? documentInfo?.title ?? null,
      document_type: documentType,
      document_type_value: typeValue,
      editor_version: editorVersion,
      project_info: projectInfo,
      document_info: documentInfo,
    };
  })()`;
}

export function documentTypeFromValue(value) {
  if (value === 1 || value === '1' || value === 'schematic') return 'schematic';
  if (value === 3 || value === '3' || value === 'pcb') return 'pcb';
  return 'unknown';
}
