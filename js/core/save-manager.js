
/* =====================================================
   WORLD AT WAR: MODERN ERA
   CORE SAVE MANAGER
   Version: 1.0.0

   Persistent campaign storage using IndexedDB.
===================================================== */

import { GAME_CONFIG } from "../config.js";

import {
    GAME_EVENTS,
    gameEventBus
} from "./event-bus.js";

import { validateGameState } from "./game-state.js";

/* =====================================================
   CONSTANTS
===================================================== */

const DEFAULT_CONFIG = Object.freeze({
    databaseName: "WORLD_AT_WAR_DATABASE",
    databaseVersion: 1,
    objectStoreName: "campaign_saves",
    maxSaveSlots: 5,
    autoSaveEnabled: true,
    autoSaveInterval: 30,
    formatVersion: 1
});

const SAVE_STATUS = Object.freeze({
    READY: "ready",
    SAVING: "saving",
    LOADING: "loading",
    ERROR: "error"
});

/* =====================================================
   UTILITIES
===================================================== */

function createId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return [
        Date.now().toString(36),
        Math.random().toString(36).slice(2, 12)
    ].join("-");
}

function deepClone(value) {
    if (typeof structuredClone === "function") {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
}

function createTimestamp() {
    return new Date().toISOString();
}

function calculateChecksum(value) {
    const text = JSON.stringify(value);

    let hash = 2166136261;

    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, "0");
}

function validateSlot(slot) {
    return (
        Number.isInteger(slot) &&
        slot >= 1
    );
}

function validateSaveData(data) {
    if (!data || typeof data !== "object") {
        throw new Error("Invalid save data.");
    }

    const validation = validateGameState(data);

    if (!validation.valid) {
        throw new Error(
            `Invalid campaign state: ${validation.errors.join("; ")}`
        );
    }

    const date = data.clock.date;
    const { day, month, year } = date;

    if (
        !Number.isInteger(year) ||
        year < 1 ||
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12 ||
        !Number.isInteger(day) ||
        day < 1
    ) {
        throw new Error("Save contains an invalid campaign date.");
    }

    const leapYear =
        year % 4 === 0 &&
        (year % 100 !== 0 || year % 400 === 0);

    const monthLengths = [
        31, leapYear ? 29 : 28, 31, 30, 31, 30,
        31, 31, 30, 31, 30, 31
    ];

    if (day > monthLengths[month - 1]) {
        throw new Error("Save contains an impossible calendar date.");
    }

    if (!GAME_CONFIG.time.availableSpeeds.includes(data.clock.speed)) {
        throw new Error("Save contains an unsupported game speed.");
    }

    if (
        !Number.isInteger(data.clock.currentHour) ||
        data.clock.currentHour < 0 ||
        data.clock.currentHour > 23
    ) {
        throw new Error("Save contains an invalid hour.");
    }

    return true;
}

/* =====================================================
   SAVE MANAGER
===================================================== */

export class SaveManager {

    constructor(state, eventBus = gameEventBus, options = {}) {

        if (!state) {
            throw new TypeError(
                "SaveManager requires a game state."
            );
        }

        this.state = state;
        this.eventBus = eventBus;

        this.config = {
            ...DEFAULT_CONFIG,
            saveName:
                GAME_CONFIG.storage?.saveName ??
                "world_at_war_save",
            maxSaveSlots:
                GAME_CONFIG.storage?.maxSaveSlots ??
                DEFAULT_CONFIG.maxSaveSlots,
            ...options
        };

        this.database = null;
        this.databasePromise = null;

        this.status = SAVE_STATUS.READY;

        this.initialized = false;
        this.destroyed = false;

        this.operationQueue = Promise.resolve();

        this.autoSaveTimer = null;

        this.lastSaveAt = null;
        this.lastSaveError = null;
    }

    /* ===============================================
       INITIALIZE DATABASE
    =============================================== */

    async initialize() {

        this.#ensureActive();

        if (this.initialized) {
            return true;
        }

        if (!("indexedDB" in globalThis)) {
            throw new Error(
                "IndexedDB is not supported by this browser."
            );
        }

        if (this.databasePromise) {
            return this.databasePromise;
        }

        this.databasePromise = new Promise((resolve, reject) => {

            const request = indexedDB.open(
                this.config.databaseName,
                this.config.databaseVersion
            );

            request.onupgradeneeded = event => {

                const database = event.target.result;

                if (
                    !database.objectStoreNames.contains(
                        this.config.objectStoreName
                    )
                ) {

                    const store = database.createObjectStore(
                        this.config.objectStoreName,
                        {
                            keyPath: "id"
                        }
                    );

                    store.createIndex(
                        "slot",
                        "slot",
                        { unique: true }
                    );

                    store.createIndex(
                        "updatedAt",
                        "updatedAt",
                        { unique: false }
                    );

                    store.createIndex(
                        "scenarioId",
                        "scenarioId",
                        { unique: false }
                    );
                }
            };

            request.onsuccess = () => {

                this.database = request.result;

                this.database.onversionchange = () => {
                    this.database.close();
                    this.database = null;
                    this.initialized = false;
                };

                this.initialized = true;

                resolve(true);
            };

            request.onerror = () => {
                reject(
                    request.error ??
                    new Error("Could not open save database.")
                );
            };

            request.onblocked = () => {
                reject(
                    new Error(
                        "Database upgrade is blocked by another open connection."
                    )
                );
            };
        });

        try {
            return await this.databasePromise;
        } catch (error) {
            this.databasePromise = null;
            this.initialized = false;
            throw error;
        }
    }

    /* ===============================================
       DATABASE TRANSACTION
    =============================================== */

    async #transaction(mode, callback) {

        await this.initialize();

        this.#ensureActive();

        return new Promise((resolve, reject) => {

            const transaction = this.database.transaction(
                this.config.objectStoreName,
                mode
            );

            const store = transaction.objectStore(
                this.config.objectStoreName
            );

            let result;

            try {
                result = callback(store);
            } catch (error) {
                try {
                    transaction.abort();
                } catch {
                    // Transaction may already be inactive.
                }

                reject(error);
                return;
            }

            transaction.oncomplete = () => {
                resolve(result);
            };

            transaction.onerror = () => {
                reject(
                    transaction.error ??
                    new Error("Database transaction failed.")
                );
            };

            transaction.onabort = () => {
                reject(
                    transaction.error ??
                    new Error("Database transaction was aborted.")
                );
            };
        });
    }

    /* ===============================================
       SERIALIZE GAME STATE
    =============================================== */

    #serializeState() {

        const snapshot = deepClone(this.state);

        validateSaveData(snapshot);

        return snapshot;
    }

    /* ===============================================
       CREATE SAVE RECORD
    =============================================== */

    #createSaveRecord(slot, name, snapshot) {

        const now = createTimestamp();

        const payload = {
            state: snapshot
        };

        return {
            id: `${this.config.saveName}_${slot}`,

            slot,

            name:
                name ||
                `Campaign ${slot}`,

            scenarioId:
                snapshot.metadata?.scenarioId ??
                GAME_CONFIG.scenario?.id ??
                "unknown",

            scenarioName:
                snapshot.metadata?.scenarioName ??
                GAME_CONFIG.scenario?.name ??
                "Unknown scenario",

            date: snapshot.clock?.date
                ? deepClone(snapshot.clock.date)
                : null,

            formatVersion: this.config.formatVersion,

            gameVersion: GAME_CONFIG.version ?? "unknown",

            createdAt: now,

            updatedAt: now,

            checksum: calculateChecksum(payload),

            payload
        };
    }

    /* ===============================================
       SAVE CAMPAIGN
    =============================================== */

    async saveGame(slot = 1, name = null) {

        this.#ensureActive();

        if (!validateSlot(slot)) {
            throw new Error("Save slot must be a positive integer.");
        }

        if (slot > this.config.maxSaveSlots) {
            throw new Error(
                `Maximum save slots: ${this.config.maxSaveSlots}.`
            );
        }

        return this.#enqueue(async () => {

            this.status = SAVE_STATUS.SAVING;

            this.eventBus.emit(
                GAME_EVENTS.SAVE_STARTED,
                { slot }
            );

            try {

                const snapshot = this.#serializeState();

                const record = this.#createSaveRecord(
                    slot,
                    name,
                    snapshot
                );

                await this.#transaction(
                    "readwrite",
                    store => {
                        store.put(record);
                    }
                );

                this.lastSaveAt = record.updatedAt;
                this.lastSaveError = null;

                this.status = SAVE_STATUS.READY;

                this.eventBus.emit(
                    GAME_EVENTS.GAME_SAVED,
                    {
                        slot,
                        name: record.name,
                        date: record.date,
                        updatedAt: record.updatedAt
                    }
                );

                return {
                    success: true,
                    slot,
                    name: record.name,
                    savedAt: record.updatedAt
                };

            } catch (error) {

                this.status = SAVE_STATUS.ERROR;
                this.lastSaveError = error.message;

                this.eventBus.emit(
                    GAME_EVENTS.SYSTEM_ERROR,
                    {
                        source: "SaveManager",
                        operation: "save",
                        message: error.message
                    }
                );

                throw error;

            } finally {

                if (!this.destroyed) {
                    this.status = SAVE_STATUS.READY;
                }
            }
        });
    }

    /* ===============================================
       LOAD CAMPAIGN
    =============================================== */

    async loadGame(slot = 1) {

        this.#ensureActive();

        if (!validateSlot(slot)) {
            throw new Error("Invalid save slot.");
        }

        if (slot > this.config.maxSaveSlots) {
            throw new Error("Save slot does not exist.");
        }

        return this.#enqueue(async () => {

            this.status = SAVE_STATUS.LOADING;

            this.eventBus.emit(
                GAME_EVENTS.LOAD_STARTED,
                { slot }
            );

            try {

                const record = await this.#getRecord(slot);

                if (!record) {
                    throw new Error(
                        `No saved campaign in slot ${slot}.`
                    );
                }

                this.#validateRecord(record);

                const restoredState = deepClone(
                    record.payload.state
                );

                validateSaveData(restoredState);

                this.#restoreState(restoredState);

                this.eventBus.emit(
                    GAME_EVENTS.GAME_LOADED,
                    {
                        slot,
                        name: record.name,
                        date: record.date,
                        updatedAt: record.updatedAt
                    }
                );

                this.status = SAVE_STATUS.READY;

                return {
                    success: true,
                    slot,
                    name: record.name,
                    date: record.date,
                    updatedAt: record.updatedAt
                };

            } catch (error) {

                this.status = SAVE_STATUS.ERROR;

                this.eventBus.emit(
                    GAME_EVENTS.SYSTEM_ERROR,
                    {
                        source: "SaveManager",
                        operation: "load",
                        message: error.message
                    }
                );

                throw error;

            } finally {

                if (!this.destroyed) {
                    this.status = SAVE_STATUS.READY;
                }
            }
        });
    }

    /* ===============================================
       RESTORE GAME STATE
    =============================================== */

    #restoreState(restoredState) {

        for (const key of Object.keys(this.state)) {
            delete this.state[key];
        }

        Object.assign(
            this.state,
            restoredState
        );
    }

    /* ===============================================
       GET SAVE RECORD
    =============================================== */

    async #getRecord(slot) {

        const id = `${this.config.saveName}_${slot}`;

        await this.initialize();

        return new Promise((resolve, reject) => {

            const transaction = this.database.transaction(
                this.config.objectStoreName,
                "readonly"
            );

            const request = transaction
                .objectStore(this.config.objectStoreName)
                .get(id);

            request.onsuccess = () => {
                resolve(request.result ?? null);
            };

            request.onerror = () => {
                reject(
                    request.error ??
                    new Error("Could not read save record.")
                );
            };
        });
    }

    /* ===============================================
       VALIDATE SAVE RECORD
    =============================================== */

    #validateRecord(record) {

        if (!record || typeof record !== "object") {
            throw new Error("Invalid save record.");
        }

        if (record.formatVersion !== this.config.formatVersion) {
            throw new Error(
                `Unsupported save format version: ${record.formatVersion}.`
            );
        }

        if (!record.payload || !record.payload.state) {
            throw new Error("Save payload is missing.");
        }

        const expectedChecksum = calculateChecksum(
            record.payload
        );

        if (expectedChecksum !== record.checksum) {
            throw new Error(
                "Save integrity check failed. The save may be corrupted."
            );
        }
    }

    /* ===============================================
       LIST SAVES
    =============================================== */

    async getSaveList() {

        this.#ensureActive();

        await this.initialize();

        return new Promise((resolve, reject) => {

            const transaction = this.database.transaction(
                this.config.objectStoreName,
                "readonly"
            );

            const request = transaction
                .objectStore(this.config.objectStoreName)
                .getAll();

            request.onsuccess = () => {

                const records = request.result
                    .filter(record =>
                        record.id.startsWith(
                            `${this.config.saveName}_`
                        )
                    )
                    .sort((a, b) => a.slot - b.slot)
                    .map(record => ({
                        id: record.id,
                        slot: record.slot,
                        name: record.name,
                        scenarioId: record.scenarioId,
                        scenarioName: record.scenarioName,
                        date: record.date,
                        createdAt: record.createdAt,
                        updatedAt: record.updatedAt,
                        gameVersion: record.gameVersion
                    }));

                resolve(records);
            };

            request.onerror = () => {
                reject(
                    request.error ??
                    new Error("Could not retrieve save list.")
                );
            };
        });
    }

    /* ===============================================
       DELETE SAVE
    =============================================== */

    async deleteSave(slot) {

        this.#ensureActive();

        if (
            !validateSlot(slot) ||
            slot > this.config.maxSaveSlots
        ) {
            throw new Error("Invalid save slot.");
        }

        return this.#enqueue(async () => {

            const id = `${this.config.saveName}_${slot}`;

            await this.#transaction(
                "readwrite",
                store => {
                    store.delete(id);
                }
            );

            this.eventBus.emit(
                GAME_EVENTS.SAVE_DELETED,
                { slot }
            );

            return {
                success: true,
                slot
            };
        });
    }

    /* ===============================================
       RENAME SAVE
    =============================================== */

    async renameSave(slot, newName) {

        this.#ensureActive();

        if (
            !validateSlot(slot) ||
            slot > this.config.maxSaveSlots
        ) {
            throw new Error("Invalid save slot.");
        }

        if (
            typeof newName !== "string" ||
            !newName.trim()
        ) {
            throw new Error("Save name cannot be empty.");
        }

        return this.#enqueue(async () => {

            const record = await this.#getRecord(slot);

            if (!record) {
                throw new Error("Save slot is empty.");
            }

            record.name = newName.trim().slice(0, 80);
            record.updatedAt = createTimestamp();

            await this.#transaction(
                "readwrite",
                store => {
                    store.put(record);
                }
            );

            return {
                success: true,
                slot,
                name: record.name
            };
        });
    }

    /* ===============================================
       AUTOSAVE
    =============================================== */

    startAutoSave(slot = 1) {

        this.#ensureActive();

        if (!this.config.autoSaveEnabled) {
            return false;
        }

        this.stopAutoSave();

        const interval = Math.max(
            1,
            this.config.autoSaveInterval
        ) * 60 * 1000;

        this.autoSaveTimer = setInterval(() => {

            if (
                this.destroyed ||
                this.status !== SAVE_STATUS.READY
            ) {
                return;
            }

            this.saveGame(
                slot,
                "Autosave"
            ).catch(error => {
                this.lastSaveError = error.message;
            });

        }, interval);

        return true;
    }

    stopAutoSave() {

        if (this.autoSaveTimer !== null) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }

    /* ===============================================
       OPERATION QUEUE
    =============================================== */

    #enqueue(operation) {

        const result = this.operationQueue.then(
            operation,
            operation
        );

        this.operationQueue = result.catch(() => {});

        return result;
    }

    /* ===============================================
       STATUS
    =============================================== */

    getStatus() {

        return {
            status: this.status,
            initialized: this.initialized,
            lastSaveAt: this.lastSaveAt,
            lastSaveError: this.lastSaveError,
            autoSaveActive: this.autoSaveTimer !== null
        };
    }

    /* ===============================================
       VALIDATION
    =============================================== */

    #ensureActive() {

        if (this.destroyed) {
            throw new Error(
                "SaveManager has been destroyed."
            );
        }
    }

    /* ===============================================
       DESTROY
    =============================================== */

    destroy() {

        if (this.destroyed) {
            return;
        }

        this.stopAutoSave();

        if (this.database) {
            this.database.close();
            this.database = null;
        }

        this.initialized = false;
        this.databasePromise = null;
        this.destroyed = true;
        this.status = SAVE_STATUS.READY;
    }
}

/* =====================================================
   MODULE INITIALIZATION
===================================================== */

console.log(
    "WORLD AT WAR: Save Manager module loaded."
);
