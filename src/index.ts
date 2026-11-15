import type { CircuitJson } from "circuit-json";

const DEFAULT_COORDINATE_TOLERANCE = 1e-6;
const HOLE_TYPES = ["pcb_hole", "pcb_plated_hole", "pcb_via"] as const;

export type HoleElementType = (typeof HOLE_TYPES)[number];

type CircuitElement = CircuitJson[number];
type HoleElement = Extract<CircuitElement, { type: HoleElementType }>;
type PcbTrace = Extract<CircuitElement, { type: "pcb_trace" }>;
type JsonRecord = Record<string, unknown>;

export interface RemoveUnusedPrefabHolesOptions {
	/** Maximum numeric difference accepted while comparing PCB geometry. */
	coordinateTolerance?: number;
}

export interface HoleRemovalCounts {
	matched: number;
	removed: number;
	preserved: number;
}

export interface RemoveUnusedPrefabHolesResult {
	circuitJson: CircuitJson;
	matchedCladHoleCount: number;
	alreadyAbsentCladHoleCount: number;
	removedUnusedCladHoleCount: number;
	preservedUsedCladHoleCount: number;
	matchedCladTraceCount: number;
	removedCladTraceCount: number;
	unmatchedCladTraceCount: number;
	emittedSyntheticSourceTraceCount: number;
	countsByType: Record<HoleElementType, HoleRemovalCounts>;
}

interface IndexedHole {
	element: HoleElement;
	index: number;
}

interface Point {
	x: number;
	y: number;
}

const HOLE_GEOMETRY_KEYS = [
	"type",
	"x",
	"y",
	"shape",
	"hole_shape",
	"pad_shape",
	"hole_diameter",
	"hole_width",
	"hole_height",
	"outer_diameter",
	"outer_width",
	"outer_height",
	"rect_pad_width",
	"rect_pad_height",
	"rect_border_radius",
	"hole_offset_x",
	"hole_offset_y",
	"ccw_rotation",
	"hole_ccw_rotation",
	"rect_ccw_rotation",
	"pad_outline",
] as const;

const isHoleElement = (element: CircuitElement): element is HoleElement =>
	HOLE_TYPES.includes(element.type as HoleElementType);

const approximatelyEqual = (
	left: unknown,
	right: unknown,
	tolerance: number,
): boolean => {
	if (typeof left === "number" && typeof right === "number") {
		return Number.isFinite(left) &&
			Number.isFinite(right) &&
			Math.abs(left - right) <= tolerance;
	}
	if (typeof left !== typeof right) return false;
	if (left === null || right === null) return left === right;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right)) return false;
		return (
			left.length === right.length &&
			left.every((value, index) =>
				approximatelyEqual(value, right[index], tolerance),
			)
		);
	}
	if (typeof left === "object" && typeof right === "object") {
		const leftRecord = left as JsonRecord;
		const rightRecord = right as JsonRecord;
		const leftKeys = Object.keys(leftRecord).sort();
		const rightKeys = Object.keys(rightRecord).sort();
		return (
			leftKeys.length === rightKeys.length &&
			leftKeys.every(
				(key, index) =>
					key === rightKeys[index] &&
					approximatelyEqual(leftRecord[key], rightRecord[key], tolerance),
			)
		);
	}
	return left === right;
};

const selectKeys = (
	record: JsonRecord,
	keys: readonly string[],
): JsonRecord => {
	const selected: JsonRecord = {};
	for (const key of keys) {
		if (record[key] !== undefined) selected[key] = record[key];
	}
	return selected;
};

const getHoleGeometry = (hole: HoleElement): JsonRecord => {
	const record = hole as unknown as JsonRecord;
	const geometry = selectKeys(record, HOLE_GEOMETRY_KEYS);
	const effectiveLayers = Array.isArray(record.layers)
		? record.layers
		: [record.from_layer, record.to_layer].filter(
				(layer): layer is string => typeof layer === "string",
			);
	if (effectiveLayers.length > 0) {
		geometry.layers = [...new Set(effectiveLayers)].sort();
	}
	return geometry;
};

const holesMatch = (
	left: HoleElement,
	right: HoleElement,
	tolerance: number,
): boolean =>
	approximatelyEqual(
		getHoleGeometry(left),
		getHoleGeometry(right),
		tolerance,
	);

const normalizeTracePoint = (point: PcbTrace["route"][number]): JsonRecord => {
	if (point.route_type === "wire") {
		return selectKeys(point as unknown as JsonRecord, [
			"route_type",
			"x",
			"y",
			"width",
			"layer",
		]);
	}
	if (point.route_type === "via") {
		return selectKeys(point as unknown as JsonRecord, [
			"route_type",
			"x",
			"y",
			"hole_diameter",
			"outer_diameter",
			"from_layer",
			"to_layer",
		]);
	}
	return selectKeys(point as unknown as JsonRecord, [
		"route_type",
		"start",
		"end",
		"width",
		"start_layer",
		"end_layer",
	]);
};

const reverseTracePoint = (point: JsonRecord): JsonRecord => {
	if (point.route_type === "via") {
		return {
			...point,
			from_layer: point.to_layer,
			to_layer: point.from_layer,
		};
	}
	if (point.route_type === "through_pad") {
		return {
			...point,
			start: point.end,
			end: point.start,
			start_layer: point.end_layer,
			end_layer: point.start_layer,
		};
	}
	return point;
};

const getTraceRoute = (trace: PcbTrace): PcbTrace["route"] =>
	Array.isArray(trace.route) ? trace.route : [];

const tracesMatch = (
	left: PcbTrace,
	right: PcbTrace,
	tolerance: number,
): boolean => {
	if (!Array.isArray(left.route) || !Array.isArray(right.route)) return false;
	if (left.route.length !== right.route.length) return false;
	const leftNormalized = left.route.map(normalizeTracePoint);
	const rightNormalized = right.route.map(normalizeTracePoint);
	if (approximatelyEqual(leftNormalized, rightNormalized, tolerance)) {
		return true;
	}

	const reversedRightRoute = [...rightNormalized]
		.reverse()
		.map(reverseTracePoint);
	return approximatelyEqual(leftNormalized, reversedRightRoute, tolerance);
};

const getPoint = (value: unknown): Point | undefined => {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as JsonRecord;
	return typeof record.x === "number" && typeof record.y === "number"
		? { x: record.x, y: record.y }
		: undefined;
};

const getRoutePoints = (
	point: PcbTrace["route"][number],
): Point[] => {
	if (point.route_type === "through_pad") {
		return [getPoint(point.start), getPoint(point.end)].filter(
			(routePoint): routePoint is Point => routePoint !== undefined,
		);
	}
	return [{ x: point.x, y: point.y }];
};

const pointsMatch = (left: Point, right: Point, tolerance: number): boolean =>
	Math.abs(left.x - right.x) <= tolerance &&
	Math.abs(left.y - right.y) <= tolerance;

const getHolePoint = (hole: HoleElement): Point => ({ x: hole.x, y: hole.y });

const addReferencedHoleIndices = ({
	trace,
	portIdToHoleIndex,
	platedHoleIdToHoleIndex,
	usedHoleIndices,
}: {
	trace: PcbTrace;
	portIdToHoleIndex: Map<string, number>;
	platedHoleIdToHoleIndex: Map<string, number>;
	usedHoleIndices: Set<number>;
}): void => {
	for (const point of getTraceRoute(trace)) {
		if (point.route_type === "wire") {
			if (point.start_pcb_port_id) {
				const index = portIdToHoleIndex.get(point.start_pcb_port_id);
				if (index !== undefined) usedHoleIndices.add(index);
			}
			if (point.end_pcb_port_id) {
				const index = portIdToHoleIndex.get(point.end_pcb_port_id);
				if (index !== undefined) usedHoleIndices.add(index);
			}
		}
		if (point.route_type === "through_pad" && point.pcb_plated_hole_id) {
			const index = platedHoleIdToHoleIndex.get(point.pcb_plated_hole_id);
			if (index !== undefined) usedHoleIndices.add(index);
		}
	}
};

const emptyCountsByType = (): Record<HoleElementType, HoleRemovalCounts> => ({
	pcb_hole: { matched: 0, removed: 0, preserved: 0 },
	pcb_plated_hole: { matched: 0, removed: 0, preserved: 0 },
	pcb_via: { matched: 0, removed: 0, preserved: 0 },
});

const ensurePcbTracesHaveSourceConnectivity = (
	circuitJson: CircuitJson,
): { circuitJson: CircuitJson; emittedSyntheticSourceTraceCount: number } => {
	const sourceTraceIds = new Set(
		circuitJson
			.filter((element) => element.type === "source_trace")
			.map((trace) => trace.source_trace_id),
	);
	const outputCircuitJson: CircuitJson = [];
	const syntheticSourceTraces: CircuitElement[] = [];

	for (const element of circuitJson) {
		if (element.type !== "pcb_trace" || element.source_trace_id) {
			outputCircuitJson.push(element);
			continue;
		}

		const baseId = `source_trace_remove_prefab_vias_${element.pcb_trace_id}`;
		let sourceTraceId = baseId;
		let collisionIndex = 1;
		while (sourceTraceIds.has(sourceTraceId)) {
			sourceTraceId = `${baseId}_${collisionIndex}`;
			collisionIndex += 1;
		}
		sourceTraceIds.add(sourceTraceId);

		outputCircuitJson.push({
			...element,
			source_trace_id: sourceTraceId,
		});
		syntheticSourceTraces.push({
			type: "source_trace",
			source_trace_id: sourceTraceId,
			connected_source_port_ids: [],
			connected_source_net_ids: [],
		} as CircuitElement);
	}

	outputCircuitJson.push(...syntheticSourceTraces);
	return {
		circuitJson: outputCircuitJson,
		emittedSyntheticSourceTraceCount: syntheticSourceTraces.length,
	};
};

export const parseCircuitJson = (contents: string): CircuitJson => {
	const parsed: unknown = JSON.parse(contents);
	if (!Array.isArray(parsed)) {
		throw new Error("Circuit JSON must be an array of circuit elements");
	}
	parsed.forEach((element, index) => {
		if (
			typeof element !== "object" ||
			element === null ||
			!("type" in element) ||
			typeof element.type !== "string" ||
			element.type.length === 0
		) {
			throw new Error(
				`Circuit JSON element at index ${index} must be an object with a type`,
			);
		}
	});
	return parsed as CircuitJson;
};

export const removeUnusedPrefabHoles = (
	cladCircuitJson: CircuitJson,
	finalCircuitJson: CircuitJson,
	options: RemoveUnusedPrefabHolesOptions = {},
): RemoveUnusedPrefabHolesResult => {
	const tolerance =
		options.coordinateTolerance ?? DEFAULT_COORDINATE_TOLERANCE;
	if (!Number.isFinite(tolerance) || tolerance <= 0) {
		throw new Error("coordinateTolerance must be a positive finite number");
	}

	const cladHoles = cladCircuitJson.filter(isHoleElement);
	if (cladHoles.length === 0) {
		throw new Error(
			"The clad Circuit JSON does not contain any pcb_hole, pcb_plated_hole, or pcb_via elements",
		);
	}

	const finalHoles: IndexedHole[] = [];
	for (const [index, element] of finalCircuitJson.entries()) {
		if (isHoleElement(element)) finalHoles.push({ element, index });
	}

	const availableFinalHoleIndices = new Set(
		finalHoles.map((_, index) => index),
	);
	const matchedHolesByFinalIndex = new Map<number, HoleElement>();
	const unmatchedCladHoles: HoleElement[] = [];
	for (const cladHole of cladHoles) {
		const candidateIndex = finalHoles.findIndex(
			(candidate, index) =>
				availableFinalHoleIndices.has(index) &&
				holesMatch(cladHole, candidate.element, tolerance),
		);
		if (candidateIndex === -1) {
			unmatchedCladHoles.push(cladHole);
			continue;
		}
		availableFinalHoleIndices.delete(candidateIndex);
		matchedHolesByFinalIndex.set(
			finalHoles[candidateIndex]!.index,
			finalHoles[candidateIndex]!.element,
		);
	}

	if (matchedHolesByFinalIndex.size === 0) {
		throw new Error(
			`Could not match ${unmatchedCladHoles.length} of ${cladHoles.length} clad holes in the final Circuit JSON; ensure both files use the same coordinates and unmodified hole geometry`,
		);
	}

	const cladTraces = cladCircuitJson.filter(
		(element): element is PcbTrace => element.type === "pcb_trace",
	);
	const finalTraces = finalCircuitJson
		.map((element, index) => ({ element, index }))
		.filter(
			(entry): entry is { element: PcbTrace; index: number } =>
				entry.element.type === "pcb_trace",
		);
	const availableFinalTraceIndices = new Set(
		finalTraces.map((_, index) => index),
	);
	const matchedCladTraceFinalIndices = new Set<number>();
	for (const cladTrace of cladTraces) {
		const candidateIndex = finalTraces.findIndex(
			(candidate, index) =>
				availableFinalTraceIndices.has(index) &&
				tracesMatch(cladTrace, candidate.element, tolerance),
		);
		if (candidateIndex === -1) continue;
		availableFinalTraceIndices.delete(candidateIndex);
		matchedCladTraceFinalIndices.add(finalTraces[candidateIndex]!.index);
	}

	const portIdToHoleIndex = new Map<string, number>();
	const platedHoleIdToHoleIndex = new Map<string, number>();
	const matchedConductiveHoles: IndexedHole[] = [];
	for (const [index, hole] of matchedHolesByFinalIndex) {
		if (hole.type === "pcb_plated_hole") {
			if (hole.pcb_port_id) portIdToHoleIndex.set(hole.pcb_port_id, index);
			platedHoleIdToHoleIndex.set(hole.pcb_plated_hole_id, index);
			matchedConductiveHoles.push({ element: hole, index });
		} else if (hole.type === "pcb_via") {
			matchedConductiveHoles.push({ element: hole, index });
		}
	}

	const usedHoleIndices = new Set<number>();
	const nonCladTraceIds = new Set<string>();
	for (const { element: trace, index } of finalTraces) {
		if (matchedCladTraceFinalIndices.has(index)) continue;
		nonCladTraceIds.add(trace.pcb_trace_id);
		addReferencedHoleIndices({
			trace,
			portIdToHoleIndex,
			platedHoleIdToHoleIndex,
			usedHoleIndices,
		});

		const routePoints: Point[] = getTraceRoute(trace).flatMap(
			(point: PcbTrace["route"][number]) => getRoutePoints(point),
		);

		for (const matchedHole of matchedConductiveHoles) {
			const holePoint = getHolePoint(matchedHole.element);
			if (
				routePoints.some((point) =>
					pointsMatch(point, holePoint, tolerance),
				)
			) {
				usedHoleIndices.add(matchedHole.index);
			}
		}

		for (const point of getTraceRoute(trace)) {
			if (point.route_type !== "via") continue;
			for (const matchedHole of matchedConductiveHoles) {
				if (
					matchedHole.element.type === "pcb_via" &&
					pointsMatch(point, getHolePoint(matchedHole.element), tolerance)
				) {
					usedHoleIndices.add(matchedHole.index);
				}
			}
		}
	}

	for (const [index, hole] of matchedHolesByFinalIndex) {
		if (
			hole.type === "pcb_via" &&
			hole.pcb_trace_id &&
			nonCladTraceIds.has(hole.pcb_trace_id)
		) {
			usedHoleIndices.add(index);
		}
	}

	const countsByType = emptyCountsByType();
	const removedHoleIndices = new Set<number>();
	for (const [index, hole] of matchedHolesByFinalIndex) {
		const holeType = hole.type as HoleElementType;
		countsByType[holeType].matched += 1;
		if (usedHoleIndices.has(index)) {
			countsByType[holeType].preserved += 1;
		} else {
			countsByType[holeType].removed += 1;
			removedHoleIndices.add(index);
		}
	}

	const filteredCircuitJson = finalCircuitJson.filter(
			(_element, index) =>
				!removedHoleIndices.has(index) &&
				!matchedCladTraceFinalIndices.has(index),
		);
	const connectivityResult =
		ensurePcbTracesHaveSourceConnectivity(filteredCircuitJson);

	return {
		circuitJson: connectivityResult.circuitJson,
		matchedCladHoleCount: matchedHolesByFinalIndex.size,
		alreadyAbsentCladHoleCount: unmatchedCladHoles.length,
		removedUnusedCladHoleCount: removedHoleIndices.size,
		preservedUsedCladHoleCount: usedHoleIndices.size,
		matchedCladTraceCount: matchedCladTraceFinalIndices.size,
		removedCladTraceCount: matchedCladTraceFinalIndices.size,
		unmatchedCladTraceCount:
			cladTraces.length - matchedCladTraceFinalIndices.size,
		emittedSyntheticSourceTraceCount:
			connectivityResult.emittedSyntheticSourceTraceCount,
		countsByType,
	};
};
