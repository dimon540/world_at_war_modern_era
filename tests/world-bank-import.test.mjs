import test from "node:test";
import assert from "node:assert/strict";
import { buildWorldBankDatasets } from "../scripts/import-world-bank-data.mjs";

const codes = [
    "NY.GDP.MKTP.CD",
    "NY.GDP.MKTP.KD",
    "SP.POP.TOTL",
    "NY.GDP.MKTP.KD.ZG",
    "FP.CPI.TOTL.ZG",
    "SL.UEM.TOTL.ZS",
    "MS.MIL.TOTL.P1",
    "MS.MIL.XPND.CD",
    "MS.MIL.XPND.GD.ZS"
];

test("World Bank importer maps sourced 2000 indicators without filling missing values", () => {
    const countryDataset = {
        countries: [
            { id: "AAA", iso3: "AAA", name: "Alpha" },
            { id: "BBB", iso3: "BBB", name: "Bravo" }
        ]
    };
    const values = {
        "NY.GDP.MKTP.CD": 1000,
        "NY.GDP.MKTP.KD": 900,
        "SP.POP.TOTL": 100,
        "NY.GDP.MKTP.KD.ZG": 2.5,
        "FP.CPI.TOTL.ZG": 4,
        "SL.UEM.TOTL.ZS": 8,
        "MS.MIL.TOTL.P1": 20,
        "MS.MIL.XPND.CD": 50,
        "MS.MIL.XPND.GD.ZS": 5
    };
    const rows = Object.fromEntries(codes.map(code => [
        code,
        [
            { countryiso3code: "AAA", value: values[code] },
            { countryiso3code: "BBB", value: null }
        ]
    ]));

    const result = buildWorldBankDatasets(countryDataset, rows, "2000-01-01T00:00:00.000Z");

    assert.equal(result.economy.countries.AAA.nominalGDP, 1000);
    assert.equal(result.economy.countries.AAA.realGDP, 900);
    assert.equal(result.economy.countries.AAA.annualGrowthRate, 0.025);
    assert.equal(result.economy.countries.AAA.inflationRate, 0.04);
    assert.equal(result.economy.countries.BBB, undefined);
    assert.equal(result.military.countries.AAA.activePersonnel, 20);
    assert.equal(result.military.countries.AAA.militaryExpenditurePercentGDP, 0.05);
    assert.equal(result.military.countries.BBB, undefined);
    assert.equal(result.economy.metadata.license, "CC BY 4.0");
});
