
/* =====================================================
   WORLD AT WAR: MODERN ERA
   CORE GAME STATE
   Version: 1.0.0

   Central state storage for the entire world simulation.

   Architecture:
   - Global world state
   - Countries and territories
   - Provinces and strategic regions
   - Independent country AI
   - Military forces
   - Economy and industry
   - Diplomacy and politics
   - Technology
   - Historical events
   - Player state
===================================================== */

import { GAME_CONFIG } from "../config.js";

/* =====================================================
   CONSTANTS
===================================================== */

export const GAME_STATE_VERSION = "1.0.0";

export const GAME_PHASES = {
    INITIALIZING: "initializing",
    READY: "ready",
    RUNNING: "running",
    PAUSED: "paused",
    GAME_OVER: "game_over"
};

export const GAME_STATUS = {
    ACTIVE: "active",
    INACTIVE: "inactive",
    ELIMINATED: "eliminated"
};

export const COUNTRY_STATUS = {
    ACTIVE: "active",
    OCCUPIED: "occupied",
    ANNEXED: "annexed",
    INDEPENDENT: "independent",
    EXILE: "exile"
};

export const PROVINCE_STATUS = {
    OWNED: "owned",
    OCCUPIED: "occupied",
    CONTESTED: "contested",
    UNCONTROLLED: "uncontrolled"
};

/* =====================================================
   INTERNAL UTILITIES
===================================================== */

function createEmptyRegistry() {
    return Object.create(null);
}

function createEmptyList() {
    return [];
}

function createScenarioDate() {
    const date = GAME_CONFIG.scenario.startDate;

    return {
        day: date.day,
        month: date.month,
        year: date.year
    };
}

function createInitialClock() {
    return {
        date: createScenarioDate(),

        speed: GAME_CONFIG.time.initialSpeed,

        isPaused: true,

        totalTicks: 0,
        totalHours: 0,
        totalDays: 0,

        currentHour: 0,

        lastTickTimestamp: null
    };
}

/* =====================================================
   WORLD STATE
===================================================== */

function createWorldState() {
    return {
        countries: createEmptyRegistry(),

        territories: createEmptyRegistry(),

        provinces: createEmptyRegistry(),

        states: createEmptyRegistry(),

        strategicRegions: createEmptyRegistry(),

        continents: createEmptyRegistry(),

        geographicFeatures: {
            rivers: createEmptyRegistry(),
            mountains: createEmptyRegistry(),
            seas: createEmptyRegistry(),
            lakes: createEmptyRegistry()
        },

        ownership: {
            provinceOwners: createEmptyRegistry(),
            provinceControllers: createEmptyRegistry()
        },

        statistics: {
            totalCountries: 0,
            totalTerritories: 0,
            totalProvinces: 0,
            totalStates: 0,
            totalStrategicRegions: 0,

            totalPopulation: 0,
            totalGDP: 0,

            activeWars: 0,
            activeAlliances: 0
        }
    };
}

/* =====================================================
   PLAYER STATE
===================================================== */

function createPlayerState() {
    return {
        countryId: null,

        isCountrySelected: false,

        difficulty: "normal",

        controlMode: "country",

        permissions: {
            controlEconomy: true,
            controlMilitary: true,
            controlPolitics: true,
            controlDiplomacy: true,
            controlResearch: true
        },

        statistics: {
            playTimeSeconds: 0,
            campaignsStarted: 0
        }
    };
}

/* =====================================================
   COUNTRY AI STATE
===================================================== */

function createCountryAIState() {
    return {
        enabled: true,

        countries: createEmptyRegistry(),

        globalSettings: {
            decisionMaking: true,

            economicPlanning: true,
            militaryPlanning: true,
            diplomaticPlanning: true,
            politicalPlanning: true,
            technologicalPlanning: true,

            strategicAwareness: true,
            threatAssessment: true,
            allianceEvaluation: true,

            autonomousDevelopment: true
        },

        updateCounters: {
            daily: 0,
            weekly: 0,
            monthly: 0,
            yearly: 0
        }
    };
}

/* =====================================================
   MILITARY STATE
===================================================== */

function createMilitaryState() {
    return {
        armies: createEmptyRegistry(),

        divisions: createEmptyRegistry(),

        units: createEmptyRegistry(),

        equipment: createEmptyRegistry(),

        equipmentProductionLines: createEmptyRegistry(),

        nationalPersonnel: createEmptyRegistry(),

        pendingPersonnelBaselines: createEmptyRegistry(),

        commanders: createEmptyRegistry(),

        airWings: createEmptyRegistry(),

        airBases: createEmptyRegistry(),

        fleets: createEmptyRegistry(),

        ships: createEmptyRegistry(),

        navalBases: createEmptyRegistry(),

        fronts: createEmptyRegistry(),

        battles: createEmptyRegistry(),

        battlePlans: createEmptyRegistry(),

        supplyNetworks: createEmptyRegistry(),

        militaryFactories: createEmptyRegistry(),

        statistics: {
            totalPersonnel: 0,
            nationalActivePersonnel: 0,
            totalDivisions: 0,
            totalAircraft: 0,
            totalShips: 0,

            activeBattles: 0,
            activeFronts: 0
        }
    };
}

/* =====================================================
   ECONOMY STATE
===================================================== */

function createEconomyState() {
    return {
        countries: createEmptyRegistry(),

        pendingCountryBaselines: createEmptyRegistry(),

        factories: createEmptyRegistry(),

        constructionProjects: createEmptyRegistry(),

        productionLines: createEmptyRegistry(),

        resources: createEmptyRegistry(),

        stockpiles: createEmptyRegistry(),

        tradeRoutes: createEmptyRegistry(),

        markets: createEmptyRegistry(),

        budgets: createEmptyRegistry(),

        statistics: {
            worldGDP: 0,

            totalCivilianFactories: 0,
            totalMilitaryFactories: 0,
            totalNavalFactories: 0,

            activeConstructionProjects: 0,

            totalTradeVolume: 0
        }
    };
}

/* =====================================================
   DIPLOMACY STATE
===================================================== */

function createDiplomacyState() {
    return {
        relations: createEmptyRegistry(),

        alliances: createEmptyRegistry(),

        organizations: createEmptyRegistry(),

        wars: createEmptyRegistry(),

        treaties: createEmptyRegistry(),

        sanctions: createEmptyRegistry(),

        diplomaticAgreements: createEmptyRegistry(),

        negotiations: createEmptyRegistry(),

        statistics: {
            activeWars: 0,
            activeAlliances: 0,
            activeSanctions: 0,
            activeTreaties: 0
        }
    };
}

/* =====================================================
   POLITICS STATE
===================================================== */

function createPoliticsState() {
    return {
        governments: createEmptyRegistry(),

        parties: createEmptyRegistry(),

        ideologies: createEmptyRegistry(),

        elections: createEmptyRegistry(),

        politicalMovements: createEmptyRegistry(),

        nationalDecisions: createEmptyRegistry(),

        revolutions: createEmptyRegistry(),

        coups: createEmptyRegistry(),

        statistics: {
            totalDemocracies: 0,
            totalRepublics: 0,
            totalMonarchies: 0,
            totalAuthoritarianGovernments: 0
        }
    };
}

/* =====================================================
   TECHNOLOGY STATE
===================================================== */

function createTechnologyState() {
    return {
        technologies: createEmptyRegistry(),

        researchProjects: createEmptyRegistry(),

        researchTeams: createEmptyRegistry(),

        doctrines: createEmptyRegistry(),

        countryResearch: createEmptyRegistry(),

        statistics: {
            completedTechnologies: 0,
            activeResearchProjects: 0
        }
    };
}

/* =====================================================
   EVENTS STATE
===================================================== */

function createEventsState() {
    return {
        historicalEvents: createEmptyRegistry(),

        worldEvents: createEmptyRegistry(),

        crises: createEmptyRegistry(),

        scheduledEvents: [],

        triggeredEvents: [],

        eventHistory: [],

        statistics: {
            totalTriggeredEvents: 0,
            activeCrises: 0
        }
    };
}

/* =====================================================
   SIMULATION STATE
===================================================== */

function createSimulationState() {
    return {
        enabled: true,

        phase: GAME_PHASES.INITIALIZING,

        systems: {
            ...GAME_CONFIG.systems
        },

        worldAI: createCountryAIState(),

        performance: {
            lastUpdateDuration: 0,

            ticksProcessed: 0,

            countriesUpdated: 0,

            provincesUpdated: 0,

            lastPerformanceCheck: null
        },

        updateSchedule: {
            hourly: 0,
            daily: 0,
            weekly: 0,
            monthly: 0,
            yearly: 0
        }
    };
}

/* =====================================================
   MAP STATE
===================================================== */

function createMapState() {
    return {
        initialized: false,

        currentMode: GAME_CONFIG.map.defaultMode,

        selectedCountryId: null,

        selectedProvinceId: null,

        selectedStateId: null,

        camera: {
            x: 0,
            y: 0,
            zoom: 1,

            minZoom: 0.5,
            maxZoom: 20
        },

        layers: {
            political: true,
            provinces: true,
            terrain: false,
            rivers: false,
            supply: false,
            resources: false,
            infrastructure: false,
            military: false,
            airZones: false,
            navalRegions: false
        }
    };
}

/* =====================================================
   USER INTERFACE STATE
===================================================== */

function createUIState() {
    return {
        activePanel: "country",

        activeTab: "overview",

        notifications: [],

        selectedUnitIds: [],

        selectedDivisionIds: [],

        dialogs: {
            countrySelection: false,
            diplomacy: false,
            construction: false,
            research: false,
            military: false
        }
    };
}

/* =====================================================
   SAVE STATE
===================================================== */

function createSaveState() {
    return {
        isDirty: false,

        lastSavedAt: null,

        lastLoadedAt: null,

        saveVersion: GAME_STATE_VERSION,

        autosaveEnabled: true,

        autosaveIntervalMinutes: 10
    };
}

/* =====================================================
   CREATE INITIAL GAME STATE
===================================================== */

/**
 * Creates the complete initial state of a WORLD AT WAR campaign.
 *
 * The function creates data containers only.
 * Actual historical world data is loaded by DataLoader.
 *
 * @returns {Object} Initial game state
 */

export function createInitialGameState() {
    return {
        metadata: {
            gameTitle: GAME_CONFIG.title,

            subtitle: GAME_CONFIG.subtitle,

            version: GAME_CONFIG.version,

            stateVersion: GAME_STATE_VERSION,

            scenarioId: GAME_CONFIG.scenario.id,

            scenarioName: GAME_CONFIG.scenario.name,

            createdAt: new Date().toISOString(),

            lastUpdatedAt: null
        },

        status: {
            phase: GAME_PHASES.INITIALIZING,

            gameStatus: GAME_STATUS.ACTIVE,

            isInitialized: false,

            isRunning: false,

            isPaused: true
        },

        clock: createInitialClock(),

        player: createPlayerState(),

        world: createWorldState(),

        map: createMapState(),

        military: createMilitaryState(),

        economy: createEconomyState(),

        diplomacy: createDiplomacyState(),

        politics: createPoliticsState(),

        technology: createTechnologyState(),

        events: createEventsState(),

        simulation: createSimulationState(),

        ui: createUIState(),

        save: createSaveState(),

        statistics: {
            campaignDays: 0,

            campaignHours: 0,

            worldPopulation: 0,

            worldGDP: 0,

            totalCountries: 0,

            totalProvinces: 0,

            totalWars: 0,

            totalBattles: 0
        }
    };
}

/* =====================================================
   GAME STATE VALIDATION
===================================================== */

/**
 * Checks whether an object has the required game-state structure.
 *
 * @param {Object} state
 * @returns {{valid: boolean, errors: string[]}}
 */

export function validateGameState(state) {
    const errors = [];

    if (!state || typeof state !== "object") {
        return {
            valid: false,
            errors: ["Game state must be an object."]
        };
    }

    const requiredSections = [
        "metadata",
        "status",
        "clock",
        "player",
        "world",
        "map",
        "military",
        "economy",
        "diplomacy",
        "politics",
        "technology",
        "events",
        "simulation",
        "ui",
        "save",
        "statistics"
    ];

    for (const section of requiredSections) {
        if (
            !Object.prototype.hasOwnProperty.call(state, section) ||
            !state[section] ||
            typeof state[section] !== "object"
        ) {
            errors.push(`Missing or invalid section: ${section}`);
        }
    }

    if (state.clock) {
        const date = state.clock.date;

        if (!date || typeof date !== "object") {
            errors.push("Invalid campaign date.");
        } else {
            if (
                !Number.isInteger(date.day) ||
                !Number.isInteger(date.month) ||
                !Number.isInteger(date.year)
            ) {
                errors.push("Campaign date must contain integer values.");
            }

            if (
                date.month < 1 ||
                date.month > 12 ||
                date.day < 1 ||
                date.day > 31
            ) {
                errors.push("Campaign date is outside valid calendar ranges.");
            }
        }
    }

    if (
        state.world &&
        (
            !state.world.countries ||
            !state.world.provinces ||
            !state.world.territories
        )
    ) {
        errors.push("World registries are missing.");
    }

    if (
        state.simulation &&
        !state.simulation.worldAI
    ) {
        errors.push("World AI state is missing.");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/* =====================================================
   GAME STATE UTILITIES
===================================================== */

/**
 * Returns a country by its unique ID.
 *
 * @param {Object} state
 * @param {string} countryId
 * @returns {Object|null}
 */

export function getCountry(state, countryId) {
    if (!state?.world?.countries || !countryId) {
        return null;
    }

    return state.world.countries[countryId] ?? null;
}

/**
 * Returns a province by its unique ID.
 *
 * @param {Object} state
 * @param {string} provinceId
 * @returns {Object|null}
 */

export function getProvince(state, provinceId) {
    if (!state?.world?.provinces || !provinceId) {
        return null;
    }

    return state.world.provinces[provinceId] ?? null;
}

/**
 * Returns a country's AI profile.
 *
 * @param {Object} state
 * @param {string} countryId
 * @returns {Object|null}
 */

export function getCountryAI(state, countryId) {
    if (!state?.simulation?.worldAI?.countries || !countryId) {
        return null;
    }

    return state.simulation.worldAI.countries[countryId] ?? null;
}

/**
 * Selects the player country.
 *
 * @param {Object} state
 * @param {string} countryId
 * @returns {boolean}
 */

export function selectPlayerCountry(state, countryId) {
    const country = getCountry(state, countryId);

    if (!country) {
        return false;
    }

    state.player.countryId = countryId;

    state.player.isCountrySelected = true;

    state.map.selectedCountryId = countryId;

    state.save.isDirty = true;

    return true;
}

/**
 * Updates the game state's last modification timestamp.
 *
 * @param {Object} state
 */

export function markGameStateDirty(state) {
    if (!state || typeof state !== "object") {
        return;
    }

    state.save.isDirty = true;

    state.metadata.lastUpdatedAt = new Date().toISOString();
}

/* =====================================================
   MODULE INITIALIZATION
===================================================== */

console.log(
    "WORLD AT WAR: Game State module loaded.",
    `State version: ${GAME_STATE_VERSION}`
);
