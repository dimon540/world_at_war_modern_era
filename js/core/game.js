/* =========================================================
   WORLD AT WAR: MODERN ERA
   CORE GAME ENGINE
   Version: 1.1.1

   Main controller connecting all core systems.
========================================================= */

import { GAME_CONFIG } from "../config.js";

import {
    createInitialGameState,
    GAME_PHASES
} from "./game-state.js";

import {
    gameEventBus,
    GAME_EVENTS
} from "./event-bus.js";

import { GameClock } from "./game-clock.js";
import { GameLoop } from "./game-loop.js";
import { DataLoader } from "./data-loader.js";
import { SaveManager } from "./save-manager.js";
import { DivisionManager } from "../military/divisions.js";
import { ArmyManager } from "../military/army-manager.js";
import { CommanderManager } from "../military/commanders.js";
import { MovementManager } from "../military/movement.js";
import { CombatManager } from "../military/combat.js";
import { FrontlineManager } from "../military/frontlines.js";
import { SupplyManager } from "../military/supply.js";
import { BattlePlanManager } from "../military/battle-plans.js";
import { WorldAIManager } from "../ai/world-ai-manager.js";
import { EconomyManager } from "../economy/economy-manager.js";
import { DiplomacyManager } from "../diplomacy/diplomacy-manager.js";
import { SIMULATION_INTERVALS, SIMULATION_PRIORITY } from "./game-loop.js";

/* =========================================================
   GAME STATUS
========================================================= */

export const GAME_STATUS = Object.freeze({
    CREATED: "created",
    INITIALIZING: "initializing",
    READY: "ready",
    RUNNING: "running",
    PAUSED: "paused",
    STOPPED: "stopped",
    ERROR: "error",
    DESTROYED: "destroyed"
});

/* =========================================================
   GAME ENGINE
========================================================= */

export class Game {

    constructor(options = {}) {

        this.options = {
            autoLoadWorld: true,
            autoSave: false,
            autoSaveSlot: 1,
            ...options
        };

        this.status = GAME_STATUS.CREATED;

        this.state = createInitialGameState();

        this.eventBus =
            this.options.eventBus ??
            gameEventBus;

        this.ownsEventBus =
            Boolean(this.options.ownsEventBus);

        this.clock = null;
        this.loop = null;
        this.dataLoader = null;
        this.saveManager = null;
        this.divisionManager = null;
        this.armyManager = null;
        this.commanderManager = null;
        this.movementManager = null;
        this.combatManager = null;
        this.frontlineManager = null;
        this.supplyManager = null;
        this.battlePlanManager = null;
        this.worldAIManager = null;
        this.economyManager = null;
        this.diplomacyManager = null;
        this.unregisterDiplomacyTask = null;
        this.unregisterEconomyTask = null;

        this.unregisterAITasks = [];
        this.unregisterMovementTask = null;
        this.unregisterSupplyTask = null;
        this.unregisterCombatTask = null;

        this.initialized = false;
        this.initializationPromise = null;

        this.destroyed = false;
        this.lastError = null;

        this.#createSystems();
    }

    /* =====================================================
       CREATE SYSTEMS
    ===================================================== */

    #createSystems() {

        this.clock = new GameClock(
            this.state,
            this.eventBus
        );

        this.loop = new GameLoop(
            this.state,
            this.clock,
            this.eventBus
        );

        this.dataLoader = new DataLoader(
            this.state,
            this.eventBus
        );

        this.saveManager = new SaveManager(
            this.state,
            this.eventBus
        );

        this.divisionManager = new DivisionManager(
            this.state,
            this.eventBus
        );

        this.armyManager = new ArmyManager(
            this.state,
            this.eventBus
        );

        this.frontlineManager = new FrontlineManager(
            this.state,
            this.eventBus
        );

        this.supplyManager = new SupplyManager(
            this.state,
            this.divisionManager,
            this.eventBus
        );

        this.commanderManager = new CommanderManager(
            this.state,
            this.eventBus
        );

        this.movementManager = new MovementManager(
            this.state,
            this.divisionManager,
            this.eventBus
        );

        this.battlePlanManager = new BattlePlanManager(
            this.state,
            this.armyManager,
            this.frontlineManager,
            this.movementManager,
            this.eventBus
        );

        this.worldAIManager = new WorldAIManager(
            this.state,
            this.eventBus,
            { enabled: GAME_CONFIG.simulation?.aiEnabled !== false }
        );

        this.economyManager = new EconomyManager(
            this.state,
            this.eventBus
        );

        this.diplomacyManager = new DiplomacyManager(
            this.state,
            this.eventBus
        );

        this.unregisterDiplomacyTask = this.loop.registerTask({
            id: "diplomacy.daily",
            name: "Diplomatic sanctions and treaties",
            interval: SIMULATION_INTERVALS.DAILY,
            priority: SIMULATION_PRIORITY.NORMAL,
            description: "Processes diplomatic systems with date-aware expiry.",
            execute: () => this.diplomacyManager.processDaily(this.clock.getSnapshot().date)
        });

        this.unregisterEconomyTask = this.loop.registerTask({
            id: "economy.monthly",
            name: "National economic update",
            interval: SIMULATION_INTERVALS.MONTHLY,
            priority: SIMULATION_PRIORITY.NORMAL,
            description: "Processes sourced GDP baselines and national budget accounts.",
            execute: () => this.economyManager.processMonthly()
        });

        this.combatManager = new CombatManager(
            this.state,
            this.divisionManager,
            this.eventBus
        );

        this.unregisterMovementTask = this.loop.registerTask({
            id: "military.land_movement",
            name: "Land division movement",
            interval: SIMULATION_INTERVALS.HOURLY,
            priority: SIMULATION_PRIORITY.HIGH,
            description: "Advances active land movement orders by one simulation hour.",
            execute: () => this.movementManager.advance(1)
        });

        this.unregisterCombatTask = this.loop.registerTask({
            id: "military.land_combat",
            name: "Land battle resolution",
            interval: SIMULATION_INTERVALS.HOURLY,
            priority: SIMULATION_PRIORITY.HIGH,
            description: "Resolves active land battles once per simulation hour.",
            execute: () => this.combatManager.advanceBattles(1)
        });

        this.unregisterSupplyTask = this.loop.registerTask({
            id: "military.supply",
            name: "Daily military supply allocation",
            interval: SIMULATION_INTERVALS.DAILY,
            priority: SIMULATION_PRIORITY.NORMAL,
            description: "Allocates stockpiled supplies and fuel to assigned divisions.",
            execute: () => this.supplyManager.processDaily()
        });

        this.unregisterAITasks = [
            this.loop.registerTask({
                id: "ai.country_daily",
                name: "Autonomous country AI decisions",
                interval: SIMULATION_INTERVALS.DAILY,
                priority: SIMULATION_PRIORITY.NORMAL,
                description: "Evaluates independent national priorities for every active country.",
                execute: () => this.worldAIManager.runDailyCycle()
            }),
            this.loop.registerTask({
                id: "ai.country_weekly",
                name: "Country AI strategic review",
                interval: SIMULATION_INTERVALS.WEEKLY,
                priority: SIMULATION_PRIORITY.LOW,
                description: "Reviews and adjusts each country's strategic priorities.",
                execute: () => this.worldAIManager.runWeeklyReview()
            }),
            this.loop.registerTask({
                id: "ai.country_monthly",
                name: "Country AI national planning",
                interval: SIMULATION_INTERVALS.MONTHLY,
                priority: SIMULATION_PRIORITY.LOW,
                description: "Refreshes long-term plans for all country AI agents.",
                execute: () => this.worldAIManager.runMonthlyReview()
            })
        ];
    }

    /* =====================================================
       INITIALIZE GAME
    ===================================================== */

    async initialize(options = {}) {

        this.#ensureActive();

        if (this.initialized) {
            return this.getStatus();
        }

        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise =
            this.#initializeInternal(options);

        try {
            return await this.initializationPromise;
        } finally {
            this.initializationPromise = null;
        }
    }

    async #initializeInternal(options) {

        this.status = GAME_STATUS.INITIALIZING;

        this.state.status.phase =
            GAME_PHASES.INITIALIZING;

        this.state.status.isInitialized = false;
        this.state.status.isRunning = false;
        this.state.status.isPaused = true;

        this.#emit(
            GAME_EVENTS.GAME_INITIALIZING,
            {
                scenarioId: GAME_CONFIG.scenario?.id ?? null
            }
        );

        try {

            const shouldLoadWorld =
                options.loadWorld ??
                this.options.autoLoadWorld;

            let worldLoaded = false;

            if (shouldLoadWorld) {

                const report =
                    await this.dataLoader.loadWorldData();

                if (!report || !report.success) {
                    throw new Error(
                        "World data initialization failed."
                    );
                }

                worldLoaded = true;
                this.worldAIManager.initializeAgents();
            }

            await this.saveManager.initialize();

            this.initialized = true;

            this.status = GAME_STATUS.READY;

            this.state.status.phase =
                GAME_PHASES.READY;

            this.state.status.isRunning = false;
            this.state.status.isPaused = true;

            this.#emit(
                GAME_EVENTS.GAME_INITIALIZED,
                {
                    scenarioId:
                        this.state.metadata.scenarioId,

                    worldLoaded
                }
            );

            if (
                this.options.autoSave &&
                this.state.status.isInitialized
            ) {
                this.saveManager.startAutoSave(
                    this.options.autoSaveSlot
                );
            }

            return this.getStatus();

        } catch (error) {

            this.status = GAME_STATUS.ERROR;

            this.lastError = error.message;

            this.state.status.phase = "error";

            this.state.status.isRunning = false;
            this.state.status.isPaused = true;

            this.#emit(
                GAME_EVENTS.SYSTEM_ERROR,
                {
                    source: "Game",
                    operation: "initialize",
                    message: error.message
                }
            );

            throw error;
        }
    }

    /* =====================================================
       START GAME
    ===================================================== */

    async start(options = {}) {

        this.#ensureActive();

        if (!this.initialized) {
            await this.initialize(options);
        }

        if (this.status === GAME_STATUS.RUNNING) {
            return false;
        }

        if (!this.state.status.isInitialized) {
            throw new Error(
                "World data must be loaded before starting the game."
            );
        }

        if (options.speed !== undefined) {
            this.setSpeed(options.speed);
        }

        this.loop.start();

        this.clock.start();

        this.status = GAME_STATUS.RUNNING;

        this.state.status.phase =
            GAME_PHASES.RUNNING;

        this.state.status.isRunning = true;
        this.state.status.isPaused = false;

        this.#emit(
            GAME_EVENTS.GAME_STARTED,
            {
                date: this.clock.date,
                speed: this.clock.speed
            }
        );

        return true;
    }

    /* =====================================================
       PAUSE GAME
    ===================================================== */

    pause() {

        this.#ensureActive();

        if (this.status !== GAME_STATUS.RUNNING) {
            return false;
        }

        this.loop.stop();

        this.clock.pause();

        this.status = GAME_STATUS.PAUSED;

        this.state.status.phase =
            GAME_PHASES.PAUSED;

        this.state.status.isRunning = false;
        this.state.status.isPaused = true;

        this.#emit(
            GAME_EVENTS.GAME_PAUSED,
            {
                date: this.clock.date,
                totalTicks: this.clock.totalTicks
            }
        );

        return true;
    }

    /* =====================================================
       RESUME GAME
    ===================================================== */

    resume() {

        this.#ensureActive();

        if (this.status !== GAME_STATUS.PAUSED) {
            return false;
        }

        if (!this.state.status.isInitialized) {
            throw new Error(
                "Cannot resume without loaded world data."
            );
        }

        this.loop.start();

        this.clock.start();

        this.status = GAME_STATUS.RUNNING;

        this.state.status.phase =
            GAME_PHASES.RUNNING;

        this.state.status.isRunning = true;
        this.state.status.isPaused = false;

        this.#emit(
            GAME_EVENTS.GAME_RESUMED,
            {
                date: this.clock.date,
                speed: this.clock.speed
            }
        );

        return true;
    }

    /* =====================================================
       STOP GAME
    ===================================================== */

    stop() {

        this.#ensureActive();

        if (
            this.status !== GAME_STATUS.RUNNING &&
            this.status !== GAME_STATUS.PAUSED
        ) {
            return false;
        }

        this.loop.stop();

        this.clock.pause();

        this.status = GAME_STATUS.STOPPED;

        this.state.status.phase =
            GAME_PHASES.PAUSED;

        this.state.status.isRunning = false;
        this.state.status.isPaused = true;

        this.#emit(
            GAME_EVENTS.GAME_PAUSED,
            {
                date: this.clock.date,
                totalTicks: this.clock.totalTicks,
                stopped: true
            }
        );

        return true;
    }

    /* =====================================================
       TIME CONTROL
    ===================================================== */

    setSpeed(speed) {

        this.#ensureActive();

        const availableSpeeds =
            GAME_CONFIG.time?.availableSpeeds ??
            [1, 2, 4, 8];

        if (!availableSpeeds.includes(speed)) {
            throw new RangeError(
                `Unsupported game speed: ${speed}`
            );
        }

        this.clock.setSpeed(speed);

        return this.clock.speed;
    }

    getSpeed() {

        this.#ensureActive();

        return this.clock.speed;
    }

    getDate() {

        this.#ensureActive();

        return this.clock.date;
    }

    getClockSnapshot() {

        this.#ensureActive();

        return this.clock.getSnapshot();
    }

    /* =====================================================
       MANUAL SIMULATION
    ===================================================== */

    executeSimulationStep(interval) {

        this.#ensureActive();

        if (!this.initialized) {
            throw new Error(
                "Game engine is not initialized."
            );
        }

        return this.loop.executeManualStep(interval);
    }

    getSimulationStatus() {

        this.#ensureActive();

        return this.loop.getMetrics();
    }

    getSimulationTasks() {

        this.#ensureActive();

        return this.loop.getRegisteredTasks();
    }

    /* =====================================================
       SAVE CAMPAIGN
    ===================================================== */

    async save(slot = 1, name = null) {

        this.#ensureInitialized();

        return this.saveManager.saveGame(
            slot,
            name
        );
    }

    /* =====================================================
       LOAD CAMPAIGN
    ===================================================== */

    async load(slot = 1) {

        this.#ensureActive();

        if (!this.initialized) {
            await this.initialize({
                loadWorld: false
            });
        }

        const wasRunning =
            this.status === GAME_STATUS.RUNNING;

        if (wasRunning) {
            this.pause();
        }

        try {

            const result =
                await this.saveManager.loadGame(slot);

            this.clock.validateClock();

            this.status = GAME_STATUS.PAUSED;

            this.state.status.phase =
                GAME_PHASES.PAUSED;

            this.state.status.isRunning = false;
            this.state.status.isPaused = true;

            this.#emit(
                GAME_EVENTS.WORLD_UPDATED,
                {
                    type: "campaign_restored",
                    slot,
                    date: this.clock.date
                }
            );

            return result;

        } catch (error) {

            this.lastError = error.message;

            throw error;
        }
    }

    /* =====================================================
       SAVE MANAGEMENT
    ===================================================== */

    async getSaveList() {

        this.#ensureActive();

        return this.saveManager.getSaveList();
    }

    async deleteSave(slot) {

        this.#ensureActive();

        return this.saveManager.deleteSave(slot);
    }

    async renameSave(slot, name) {

        this.#ensureActive();

        return this.saveManager.renameSave(
            slot,
            name
        );
    }

    /* =====================================================
       EVENT MANAGEMENT
    ===================================================== */

    on(eventName, callback, options = {}) {

        this.#ensureActive();

        return this.eventBus.on(
            eventName,
            callback,
            options
        );
    }

    once(eventName, callback, options = {}) {

        this.#ensureActive();

        return this.eventBus.once(
            eventName,
            callback,
            options
        );
    }

    off(eventName, listenerId) {

        this.#ensureActive();

        return this.eventBus.off(
            eventName,
            listenerId
        );
    }

    #emit(eventName, payload = {}) {

        if (!eventName) {
            return;
        }

        this.eventBus.emit(
            eventName,
            {
                ...payload,
                timestamp: Date.now()
            }
        );
    }

    /* =====================================================
       GET SYSTEMS
    ===================================================== */

    getSystems() {

        this.#ensureActive();

        return {
            state: this.state,
            eventBus: this.eventBus,
            clock: this.clock,
            loop: this.loop,
            dataLoader: this.dataLoader,
            saveManager: this.saveManager,
            divisionManager: this.divisionManager,
            armyManager: this.armyManager,
            commanderManager: this.commanderManager,
            movementManager: this.movementManager,
            combatManager: this.combatManager,
            frontlineManager: this.frontlineManager,
            supplyManager: this.supplyManager,
            battlePlanManager: this.battlePlanManager,
            worldAIManager: this.worldAIManager,
            economyManager: this.economyManager
        };
    }

    /* =====================================================
       GET GAME STATUS
    ===================================================== */

    getStatus() {

        return {
            status: this.status,

            initialized: this.initialized,

            worldLoaded:
                Boolean(this.state.status.isInitialized),

            destroyed: this.destroyed,

            date: this.clock
                ? this.clock.date
                : null,

            speed: this.clock
                ? this.clock.speed
                : null,

            lastError: this.lastError
        };
    }

    /* =====================================================
       INITIALIZATION CHECKS
    ===================================================== */

    #ensureActive() {

        if (this.destroyed) {
            throw new Error(
                "Game engine has been destroyed."
            );
        }
    }

    #ensureInitialized() {

        this.#ensureActive();

        if (!this.initialized) {
            throw new Error(
                "Game engine is not initialized."
            );
        }
    }

    /* =====================================================
       DESTROY
    ===================================================== */

    destroy() {

        if (this.destroyed) {
            return;
        }

        if (this.loop) {
            this.loop.stop();
        }

        if (this.clock) {
            this.clock.pause();
        }

        if (this.unregisterMovementTask) {
            this.unregisterMovementTask();
            this.unregisterMovementTask = null;
        }
        if (this.unregisterCombatTask) {
            this.unregisterCombatTask();
            this.unregisterCombatTask = null;
        }
        if (this.unregisterSupplyTask) {
            this.unregisterSupplyTask();
            this.unregisterSupplyTask = null;
        }
        for (const unregister of this.unregisterAITasks) unregister();
        this.unregisterAITasks = [];
        if (this.unregisterEconomyTask) {
            this.unregisterEconomyTask();
            this.unregisterEconomyTask = null;
        }

        if (this.worldAIManager) this.worldAIManager.destroy();
        if (this.economyManager) this.economyManager.destroy();
        if (this.supplyManager) this.supplyManager.destroy();
        if (this.battlePlanManager) this.battlePlanManager.destroy();
        if (this.combatManager) this.combatManager.destroy();
        if (this.frontlineManager) this.frontlineManager.destroy();
        if (this.movementManager) this.movementManager.destroy();
        if (this.commanderManager) this.commanderManager.destroy();
        if (this.armyManager) this.armyManager.destroy();
        if (this.divisionManager) this.divisionManager.destroy();

        if (this.saveManager) {
            this.saveManager.destroy();
        }

        if (this.dataLoader) {
            this.dataLoader.destroy();
        }

        if (this.clock) {
            this.clock.destroy();
        }

        if (this.loop) {
            this.loop.destroy();
        }

        if (
            this.ownsEventBus &&
            this.eventBus?.destroy
        ) {
            this.eventBus.destroy();
        }

        this.status = GAME_STATUS.DESTROYED;

        this.destroyed = true;
    }
}

/* =========================================================
   FACTORY
========================================================= */

export function createGame(options = {}) {

    return new Game(options);
}

/* =========================================================
   MODULE INITIALIZATION
========================================================= */

console.log(
    "WORLD AT WAR: Game Engine module loaded."
);
