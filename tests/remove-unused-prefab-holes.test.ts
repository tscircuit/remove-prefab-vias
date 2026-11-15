import { describe, expect, test } from "bun:test";
import type { CircuitJson } from "circuit-json";
import {
	parseCircuitJson,
	removeUnusedPrefabHoles,
} from "../src/index";

const createCladCircuit = (): CircuitJson =>
	[
		{
			type: "pcb_plated_hole",
			pcb_plated_hole_id: "clad_hole_a",
			pcb_port_id: "clad_port_a",
			shape: "circle",
			x: 0,
			y: 0,
			hole_diameter: 1,
			outer_diameter: 1.6,
			layers: ["top", "bottom"],
		},
		{
			type: "pcb_plated_hole",
			pcb_plated_hole_id: "clad_hole_b",
			pcb_port_id: "clad_port_b",
			shape: "circle",
			x: 10,
			y: 0,
			hole_diameter: 1,
			outer_diameter: 1.6,
			layers: ["top", "bottom"],
		},
		{
			type: "pcb_via",
			pcb_via_id: "clad_via",
			x: 20,
			y: 0,
			hole_diameter: 0.3,
			outer_diameter: 0.6,
			layers: ["top", "bottom"],
		},
		{
			type: "pcb_hole",
			pcb_hole_id: "clad_mounting_hole",
			hole_shape: "circle",
			hole_diameter: 2,
			x: 30,
			y: 0,
		},
		{
			type: "pcb_trace",
			pcb_trace_id: "clad_buried_trace",
			route: [
				{
					route_type: "wire",
					x: 0,
					y: 0,
					width: 0.2,
					layer: "inner1",
					start_pcb_port_id: "clad_port_a",
				},
				{
					route_type: "wire",
					x: 10,
					y: 0,
					width: 0.2,
					layer: "inner1",
					end_pcb_port_id: "clad_port_b",
				},
			],
		},
	] as CircuitJson;

const createFinalCircuit = (): CircuitJson =>
	[
		{
			type: "pcb_plated_hole",
			pcb_plated_hole_id: "final_hole_a",
			pcb_port_id: "final_port_a",
			pcb_component_id: "final_prefab_component",
			shape: "circle",
			x: 0.0000001,
			y: 0,
			hole_diameter: 1,
			outer_diameter: 1.6,
			layers: ["bottom", "top"],
		},
		{
			type: "pcb_plated_hole",
			pcb_plated_hole_id: "final_hole_b",
			pcb_port_id: "final_port_b",
			pcb_component_id: "final_prefab_component",
			shape: "circle",
			x: 10,
			y: 0,
			hole_diameter: 1,
			outer_diameter: 1.6,
			layers: ["top", "bottom"],
		},
		{
			type: "pcb_via",
			pcb_via_id: "final_via",
			x: 20,
			y: 0,
			hole_diameter: 0.3,
			outer_diameter: 0.6,
			layers: ["top", "bottom"],
		},
		{
			type: "pcb_hole",
			pcb_hole_id: "final_mounting_hole",
			hole_shape: "circle",
			hole_diameter: 2,
			x: 30,
			y: 0,
		},
		{
			type: "pcb_plated_hole",
			pcb_plated_hole_id: "circuit_only_hole",
			shape: "circle",
			x: 40,
			y: 0,
			hole_diameter: 0.8,
			outer_diameter: 1.4,
			layers: ["top", "bottom"],
		},
		{
			type: "pcb_trace",
			pcb_trace_id: "renamed_clad_trace",
			route: [
				{
					route_type: "wire",
					x: 10.0000001,
					y: 0,
					width: 0.2,
					layer: "inner1",
					start_pcb_port_id: "final_port_b",
				},
				{
					route_type: "wire",
					x: 0,
					y: 0,
					width: 0.2,
					layer: "inner1",
					end_pcb_port_id: "final_port_a",
				},
			],
		},
		{
			type: "pcb_trace",
			pcb_trace_id: "circuit_trace_to_hole",
			route: [
				{
					route_type: "wire",
					x: -5,
					y: 0,
					width: 0.15,
					layer: "top",
				},
				{
					route_type: "wire",
					x: -1,
					y: 0,
					width: 0.15,
					layer: "top",
					end_pcb_port_id: "final_port_a",
				},
			],
		},
		{
			type: "pcb_trace",
			pcb_trace_id: "circuit_trace_through_via",
			route: [
				{
					route_type: "wire",
					x: 15,
					y: 0,
					width: 0.15,
					layer: "top",
				},
				{
					route_type: "via",
					x: 20.0000001,
					y: 0,
					from_layer: "top",
					to_layer: "bottom",
				},
				{
					route_type: "wire",
					x: 25,
					y: 0,
					width: 0.15,
					layer: "bottom",
				},
			],
		},
		{
			type: "pcb_silkscreen_text",
			pcb_silkscreen_text_id: "unchanged_marker",
			text: "keep me",
			anchor_position: { x: 0, y: 5 },
			anchor_alignment: "center",
			font: "tscircuit2024",
			font_size: 1,
			layer: "top",
		},
	] as CircuitJson;

describe("removeUnusedPrefabHoles", () => {
	test("removes unused clad holes and all matched clad traces", () => {
		const finalCircuit = createFinalCircuit();
		const remainingTraceIds = finalCircuit.flatMap(
			(element) =>
				element.type === "pcb_trace" &&
				element.pcb_trace_id !== "renamed_clad_trace"
					? [element.pcb_trace_id]
					: [],
		);
		const marker = finalCircuit.at(-1);

		const result = removeUnusedPrefabHoles(
			createCladCircuit(),
			finalCircuit,
		);

		expect(result.matchedCladHoleCount).toBe(4);
		expect(result.alreadyAbsentCladHoleCount).toBe(0);
		expect(result.removedUnusedCladHoleCount).toBe(2);
		expect(result.preservedUsedCladHoleCount).toBe(2);
		expect(result.matchedCladTraceCount).toBe(1);
		expect(result.removedCladTraceCount).toBe(1);
		expect(result.unmatchedCladTraceCount).toBe(0);
		expect(result.emittedSyntheticSourceTraceCount).toBe(2);
		expect(result.countsByType).toEqual({
			pcb_hole: { matched: 1, removed: 1, preserved: 0 },
			pcb_plated_hole: { matched: 2, removed: 1, preserved: 1 },
			pcb_via: { matched: 1, removed: 0, preserved: 1 },
		});

		const remainingHoleIds = result.circuitJson.flatMap((element) => {
			if (element.type === "pcb_plated_hole") {
				return [element.pcb_plated_hole_id];
			}
			if (element.type === "pcb_via") return [element.pcb_via_id];
			if (element.type === "pcb_hole") return [element.pcb_hole_id];
			return [];
		});
		expect(remainingHoleIds).toEqual([
			"final_hole_a",
			"final_via",
			"circuit_only_hole",
		]);
		const remainingTraces = result.circuitJson.filter(
			(element) => element.type === "pcb_trace",
		)
		expect(remainingTraces.map((trace) => trace.pcb_trace_id)).toEqual(
			remainingTraceIds,
		)
		expect(remainingTraces.every((trace) => Boolean(trace.source_trace_id))).toBe(
			true,
		)
		expect(
			result.circuitJson.filter((element) => element.type === "source_trace"),
		).toHaveLength(2)
		expect(
			result.circuitJson.some(
				(element) =>
					element.type === "pcb_trace" &&
					element.pcb_trace_id === "renamed_clad_trace",
			),
		).toBe(false);
		expect(result.circuitJson).toContain(marker);
	});

	test("uses endpoint geometry when port identifiers are absent", () => {
		const clad = createCladCircuit().filter(
			(element) =>
				element.type === "pcb_plated_hole" && element.x === 0,
		) as CircuitJson;
		const final = createFinalCircuit().filter(
			(element) =>
				element.type === "pcb_plated_hole" && element.x < 1,
		) as CircuitJson;
		final.push({
			type: "pcb_trace",
			pcb_trace_id: "geometry_only_trace",
			route: [
				{ route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
				{ route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
			],
		});

		const result = removeUnusedPrefabHoles(clad, final);

		expect(result.removedUnusedCladHoleCount).toBe(0);
		expect(result.preservedUsedCladHoleCount).toBe(1);
	});

	test("preserves a via connected at an interior wire route point", () => {
		const clad = [
			{
				type: "pcb_via",
				pcb_via_id: "clad_via",
				x: 5,
				y: 0,
				hole_diameter: 0.3,
				outer_diameter: 0.6,
				layers: ["top", "bottom"],
			},
		] as CircuitJson;
		const final = [
			{
				...clad[0],
				pcb_via_id: "final_via",
			},
			{
				type: "pcb_trace",
				pcb_trace_id: "trace_through_via",
				route: [
					{ route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
					{ route_type: "wire", x: 5, y: 0, width: 0.1, layer: "top" },
					{ route_type: "wire", x: 10, y: 0, width: 0.1, layer: "top" },
				],
			},
		] as CircuitJson;

		const result = removeUnusedPrefabHoles(clad, final);

		expect(result.preservedUsedCladHoleCount).toBe(1);
		expect(
			result.circuitJson.some(
				(element) =>
					element.type === "pcb_via" &&
					element.pcb_via_id === "final_via",
			),
		).toBe(true);
	});

	test("matches duplicate geometry one-to-one", () => {
		const clad = [
			{
				type: "pcb_hole",
				pcb_hole_id: "clad_hole",
				hole_shape: "circle",
				hole_diameter: 2,
				x: 0,
				y: 0,
			},
		] as CircuitJson;
		const final = [
			{ ...clad[0], pcb_hole_id: "first" },
			{ ...clad[0], pcb_hole_id: "second" },
		] as CircuitJson;

		const result = removeUnusedPrefabHoles(clad, final);

		expect(result.removedUnusedCladHoleCount).toBe(1);
		expect(result.circuitJson).toHaveLength(1);
		expect(result.circuitJson[0]).toEqual(
			expect.objectContaining({ pcb_hole_id: "second" }),
		);
	});

	test("treats clad holes missing from the final circuit as already absent", () => {
		const clad = createCladCircuit();
		const final = createFinalCircuit().filter(
			(element) =>
				!(element.type === "pcb_via" && element.x === 20),
		) as CircuitJson;

		const result = removeUnusedPrefabHoles(clad, final);

		expect(result.matchedCladHoleCount).toBe(3);
		expect(result.alreadyAbsentCladHoleCount).toBe(1);
		expect(result.countsByType.pcb_via).toEqual({
			matched: 0,
			removed: 0,
			preserved: 0,
		});
	});

	test("normalizes KiCad-roundtripped via layer metadata", () => {
		const clad = [
			{
				type: "pcb_via",
				pcb_via_id: "clad_via",
				x: 1,
				y: 2,
				hole_diameter: 0.2,
				outer_diameter: 0.4,
				layers: ["bottom", "top"],
				from_layer: "top",
				to_layer: "bottom",
			},
		] as CircuitJson;
		const final = [
			{
				type: "pcb_via",
				pcb_via_id: "kicad_via",
				x: 1,
				y: 2,
				hole_diameter: 0.2,
				outer_diameter: 0.4,
				layers: ["top", "bottom"],
			},
		] as CircuitJson;

		const result = removeUnusedPrefabHoles(clad, final);

		expect(result.matchedCladHoleCount).toBe(1);
		expect(result.removedUnusedCladHoleCount).toBe(1);
		expect(result.circuitJson).toHaveLength(0);
	});

	test("falls back to deprecated via layer fields when layers is absent", () => {
		const clad = [
			{
				type: "pcb_via",
				pcb_via_id: "legacy_via",
				x: 1,
				y: 2,
				hole_diameter: 0.2,
				outer_diameter: 0.4,
				from_layer: "top",
				to_layer: "bottom",
			},
		] as CircuitJson;
		const final = [
			{
				type: "pcb_via",
				pcb_via_id: "modern_via",
				x: 1,
				y: 2,
				hole_diameter: 0.2,
				outer_diameter: 0.4,
				layers: ["bottom", "top"],
			},
		] as CircuitJson;

		expect(removeUnusedPrefabHoles(clad, final).matchedCladHoleCount).toBe(1);
	});

	test("rejects vias with different effective layer spans", () => {
		const clad = [
			{
				type: "pcb_via",
				pcb_via_id: "through_via",
				x: 1,
				y: 2,
				hole_diameter: 0.2,
				outer_diameter: 0.4,
				layers: ["top", "bottom"],
				from_layer: "top",
				to_layer: "bottom",
			},
		] as CircuitJson;
		const final = [
			{
				type: "pcb_via",
				pcb_via_id: "blind_via",
				x: 1,
				y: 2,
				hole_diameter: 0.2,
				outer_diameter: 0.4,
				layers: ["top", "inner1"],
			},
		] as CircuitJson;

		expect(() => removeUnusedPrefabHoles(clad, final)).toThrow(
			"Could not match 1 of 1 clad holes",
		);
	});

	test("rejects missing clad geometry and invalid tolerance", () => {
		expect(() => removeUnusedPrefabHoles([] as CircuitJson, [])).toThrow(
			"does not contain any",
		);
		expect(() =>
			removeUnusedPrefabHoles(createCladCircuit(), [] as CircuitJson),
		).toThrow("Could not match 4 of 4 clad holes");
		expect(() =>
			removeUnusedPrefabHoles(createCladCircuit(), createFinalCircuit(), {
				coordinateTolerance: 0,
			}),
		).toThrow("coordinateTolerance must be a positive finite number");
	});

	test("skips pcb_trace entries that omit route instead of throwing", () => {
		const clad = [
			{
				type: "pcb_plated_hole",
				pcb_plated_hole_id: "clad_hole",
				pcb_port_id: "clad_port",
				shape: "circle",
				x: 0,
				y: 0,
				hole_diameter: 1,
				outer_diameter: 1.6,
				layers: ["top", "bottom"],
			},
			{
				type: "pcb_trace",
				pcb_trace_id: "clad_unrouted",
			},
		] as CircuitJson;
		const final = [
			{
				type: "pcb_plated_hole",
				pcb_plated_hole_id: "final_hole",
				pcb_port_id: "final_port",
				shape: "circle",
				x: 0,
				y: 0,
				hole_diameter: 1,
				outer_diameter: 1.6,
				layers: ["top", "bottom"],
			},
			{
				type: "pcb_trace",
				pcb_trace_id: "final_unrouted",
			},
			{
				type: "pcb_trace",
				pcb_trace_id: "circuit_trace_to_hole",
				route: [
					{ route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
					{
						route_type: "wire",
						x: 0,
						y: 0,
						width: 0.1,
						layer: "top",
						end_pcb_port_id: "final_port",
					},
				],
			},
		] as CircuitJson;

		const result = removeUnusedPrefabHoles(clad, final);

		expect(result.matchedCladHoleCount).toBe(1);
		expect(result.preservedUsedCladHoleCount).toBe(1);
		expect(result.removedUnusedCladHoleCount).toBe(0);
		expect(result.matchedCladTraceCount).toBe(0);
		expect(result.unmatchedCladTraceCount).toBe(1);
		expect(
			result.circuitJson
				.filter((element) => element.type === "pcb_trace")
				.map((trace) => trace.pcb_trace_id),
		).toEqual(["final_unrouted", "circuit_trace_to_hole"]);
	});
});

describe("parseCircuitJson", () => {
	test("validates the top-level Circuit JSON shape", () => {
		expect(() => parseCircuitJson("{")).toThrow();
		expect(() => parseCircuitJson("{}")).toThrow(
			"Circuit JSON must be an array",
		);
		expect(() => parseCircuitJson('[{"x":1}]')).toThrow(
			"must be an object with a type",
		);
		expect(parseCircuitJson('[{"type":"pcb_board"}]')).toEqual([
			{ type: "pcb_board" },
		]);
	});
});
