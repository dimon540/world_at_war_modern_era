/* =========================================================
   WORLD AT WAR: MODERN ERA
   CORE GAME ENGINE
   Version: 1.1.0

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

            this.state.status.phase =
                GAME_PHASES.INITIALIZING;

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

        return this.loop.getStatus();
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
            saveManager: this.saveManager
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
