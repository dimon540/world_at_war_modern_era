import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGameState } from "../js/core/game-state.js";
import { DataLoader } from "../js/core/data-loader.js";

function feature(id, countryCode) {
    return {
        type: "Feature",
        id,
        properties: { adm1_code: id, ADM0_A3: countryCode, NAME_1: id + " Province" },
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
    };
}

test("world loading assigns province owners and controllers from GeoJSON country codes", async () => {
    const state = createInitialGameState();
    const countries = [
        { id: "AAA", name: "Alpha", iso3: "AAA" },
        { id: "YUG", name: "Federal Republic of Yugoslavia", iso3: "YUG" },
        { id: "SDN", name: "Sudan", iso3: "SDN" }
    ];
    const geojson = {
        type: "FeatureCollection",
        features: [
            feature("AAA-1", "AAA"),
            feature("SRB-1", "SRB"),
            feature("MNE-1", "MNE"),
            feature("SSD-1", "SSD")
        ]
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async url => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => String(url).endsWith("countries")
            ? { countries }
            : geojson
    });
    const loader = new DataLoader(state);
    try {
        const report = await loader.loadWorldData({ paths: { countries: "countries", provinces: "provinces" } });
        assert.equal(report.success, true);
        assert.equal(state.world.ownership.provinceOwners["AAA-1"], "AAA");
        assert.equal(state.world.ownership.provinceControllers["AAA-1"], "AAA");
        assert.equal(state.world.ownership.provinceOwners["SRB-1"], "YUG");
        assert.equal(state.world.ownership.provinceOwners["MNE-1"], "YUG");
        assert.equal(state.world.ownership.provinceOwners["SSD-1"], "SDN");
    } finally {
        globalThis.fetch = originalFetch;
        loader.destroy();
    }
});
