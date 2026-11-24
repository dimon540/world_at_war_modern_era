
/* ==========================================
   WORLD AT WAR: MODERN ERA
   GLOBAL STRATEGY ENGINE
========================================== */

export const GAME_CONFIG = {
    title: "WORLD AT WAR",
    subtitle: "MODERN ERA",
    version: "0.1.0",

    scenario: {
        id: "modern_2000",
        name: "World in 2000",
        startDate: {
            day: 1,
            month: 1,
            year: 2000
        }
    },

    simulation: {
        mode: "full_world_simulation",

        aiEnabled: true,
        allCountriesActive: true,
        independentCountryDecisions: true,

        economySimulation: true,
        militarySimulation: true,
        diplomacySimulation: true,
        politicalSimulation: true,
        technologySimulation: true,

        historicalEvents: true,
        dynamicWorldEvents: true
    },

    time: {
        initialSpeed: 1,
        availableSpeeds: [1, 2, 4, 8, 16],
        ticksPerDay: 1
    },

    world: {
        allCountries: true,
        dependentTerritories: true,
        historicalBorders: false,
        historicalCountryData: true
    },

    map: {
        projection: "naturalEarth",
        defaultMode: "political",

        provinceSelection: true,
        countrySelection: true,

        showProvinceBorders: true,
        showCountryBorders: true,
        showTerrain: true,
        showRivers: true
    },

    systems: {
        economy: true,
        industry: true,
        resources: true,
        trade: true,

        military: true,
        divisions: true,
        aviation: true,
        navy: true,
        supply: true,
        combat: true,

        diplomacy: true,
        alliances: true,
        wars: true,
        sanctions: true,

        politics: true,
        elections: true,
        governments: true,

        technology: true,
        historicalEvents: true,

        multiplayer: false
    },

    storage: {
        type: "indexedDB",
        saveName: "world_at_war_save",
        maxSaveSlots: 10
    }
};

export const DATA_PATHS = {
    countries: "./data/countries/countries.json",

    provinces: "./data/map/provinces.geojson",
    provinceDefinitions: "./data/map/province-definitions.json",
    states: "./data/map/states.json",
    strategicRegions: "./data/map/strategic-regions.json",

    scenario: "./data/scenarios/2000/scenario.json",
    ownership: "./data/scenarios/2000/ownership.json",

    countryHistory: "./data/history/country-changes.json",
    economyBaselines: "./data/economy/country-baselines-2000.json",
    militaryPersonnel: "./data/military/personnel-2000.json",
    borderHistory: "./data/history/border-changes.json"
};

export const MAP_CONFIG = {
    background: "#172b3a",
    countryBorder: "#243849",
    provinceBorder: "#34495a",
    selectedCountry: "#c49b52",
    selectedProvince: "#e4c477"
};

console.log("WORLD AT WAR: configuration loaded.");
