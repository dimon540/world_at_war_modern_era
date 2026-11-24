
/* =====================================================
   WORLD AT WAR: MODERN ERA
   CORE EVENT BUS
   Version: 1.0.1

   Central event communication system.

   Features:
   - Event subscription
   - Event publishing
   - One-time listeners
   - Listener priorities
   - Event history
   - Wildcard listeners
   - Safe listener execution
   - Event filtering
   - Listener management
===================================================== */

/* =====================================================
   EVENT CONSTANTS
===================================================== */

export const GAME_EVENTS = Object.freeze({

    // Game lifecycle
    GAME_INITIALIZING: "game:initializing",
    GAME_INITIALIZED: "game:initialized",
    GAME_STARTED: "game:started",
    GAME_PAUSED: "game:paused",
    GAME_RESUMED: "game:resumed",
    GAME_OVER: "game:over",

    // Time
    CLOCK_TICK: "clock:tick",
    HOUR_CHANGED: "clock:hour_changed",
    DAY_CHANGED: "clock:day_changed",
    WEEK_CHANGED: "clock:week_changed",
    MONTH_CHANGED: "clock:month_changed",
    YEAR_CHANGED: "clock:year_changed",

    // World
    WORLD_LOADING: "world:loading",
    WORLD_LOADED: "world:loaded",
    WORLD_UPDATED: "world:updated",

    // Countries
    COUNTRY_CREATED: "country:created",
    COUNTRY_UPDATED: "country:updated",
    COUNTRY_SELECTED: "country:selected",
    COUNTRY_ELIMINATED: "country:eliminated",
    COUNTRY_INDEPENDENCE: "country:independence",

    // Provinces
    PROVINCE_CREATED: "province:created",
    PROVINCE_UPDATED: "province:updated",
    PROVINCE_OWNER_CHANGED: "province:owner_changed",
    PROVINCE_CONTROLLER_CHANGED: "province:controller_changed",

    // Economy
    ECONOMY_UPDATED: "economy:updated",
    BUDGET_UPDATED: "economy:budget_updated",
    FACTORY_COMPLETED: "economy:factory_completed",
    CONSTRUCTION_STARTED: "economy:construction_started",
    PRODUCTION_UPDATED: "economy:production_updated",
    TRADE_ROUTE_CREATED: "economy:trade_route_created",

    // Military
    ARMY_CREATED: "military:army_created",
    DIVISION_CREATED: "military:division_created",
    DIVISION_MOVED: "military:division_moved",
    DIVISION_DESTROYED: "military:division_destroyed",
    MOBILIZATION_STARTED: "military:mobilization_started",
    BATTLE_STARTED: "military:battle_started",
    BATTLE_ENDED: "military:battle_ended",
    FRONT_CREATED: "military:front_created",
    EQUIPMENT_PRODUCED: "military:equipment_produced",

    // Diplomacy
    RELATIONS_CHANGED: "diplomacy:relations_changed",
    ALLIANCE_CREATED: "diplomacy:alliance_created",
    ALLIANCE_DISSOLVED: "diplomacy:alliance_dissolved",
    WAR_DECLARED: "diplomacy:war_declared",
    WAR_ENDED: "diplomacy:war_ended",
    PEACE_SIGNED: "diplomacy:peace_signed",
    SANCTIONS_IMPOSED: "diplomacy:sanctions_imposed",

    // Politics
    GOVERNMENT_CHANGED: "politics:government_changed",
    ELECTION_STARTED: "politics:election_started",
    ELECTION_ENDED: "politics:election_ended",
    REVOLUTION_STARTED: "politics:revolution_started",
    COUP_OCCURRED: "politics:coup_occurred",

    // Technology
    RESEARCH_STARTED: "technology:research_started",
    RESEARCH_COMPLETED: "technology:research_completed",
    TECHNOLOGY_UNLOCKED: "technology:unlocked",

    // AI
    AI_DECISION_MADE: "ai:decision_made",
    AI_COUNTRY_UPDATED: "ai:country_updated",
    AI_STRATEGY_CHANGED: "ai:strategy_changed",

    // Events
    HISTORICAL_EVENT: "event:historical",
    WORLD_EVENT: "event:world",
    CRISIS_STARTED: "event:crisis_started",
    CRISIS_ENDED: "event:crisis_ended",

    // UI
    NOTIFICATION_CREATED: "ui:notification_created",
    PANEL_UPDATED: "ui:panel_updated",
    MAP_UPDATED: "ui:map_updated",

    // Saves
    SAVE_STARTED: "save:started",
    SAVE_COMPLETED: "save:completed",
    SAVE_FAILED: "save:failed",
    LOAD_STARTED: "load:started",
    LOAD_COMPLETED: "load:completed",
    LOAD_FAILED: "load:failed",
    GAME_SAVED: "save:game_saved",
    GAME_LOADED: "load:game_loaded",
    SAVE_DELETED: "save:deleted",

    // Errors
    SYSTEM_ERROR: "system:error"
});

/* =====================================================
   EVENT BUS CONFIGURATION
===================================================== */

const DEFAULT_CONFIG = Object.freeze({
    maxHistory: 1000,
    maxListenersPerEvent: 500,
    allowWildcardListeners: true,
    captureErrors: true,
    asyncListeners: false
});

/* =====================================================
   EVENT BUS CLASS
===================================================== */

export class EventBus {

    constructor(config = {}) {

        this.config = {
            ...DEFAULT_CONFIG,
            ...config
        };

        this.listeners = new Map();

        this.history = [];

        this.listenerCounter = 0;

        this.eventCounter = 0;

        this.destroyed = false;
    }

    /* ===============================================
       SUBSCRIBE
    =============================================== */

    /**
     * Registers an event listener.
     *
     * @param {string} eventName
     * @param {Function} callback
     * @param {Object} options
     * @returns {Function} Unsubscribe function
     */

    on(eventName, callback, options = {}) {

        this.#validateEvent(eventName);

        if (typeof callback !== "function") {
            throw new TypeError("Event listener must be a function.");
        }

        this.#ensureActive();

        const {
            priority = 0,
            once = false,
            context = null
        } = options;

        if (
            !Number.isFinite(priority)
        ) {
            throw new TypeError("Listener priority must be a finite number.");
        }

        const listeners = this.listeners.get(eventName) ?? [];

        if (
            listeners.length >= this.config.maxListenersPerEvent
        ) {
            throw new Error(
                `Maximum listeners reached for event: ${eventName}`
            );
        }

        const listener = {
            id: ++this.listenerCounter,
            eventName,
            callback,
            priority,
            once,
            context,
            active: true
        };

        listeners.push(listener);

        listeners.sort((a, b) => b.priority - a.priority);

        this.listeners.set(eventName, listeners);

        return () => this.off(eventName, listener.id);
    }

    /* ===============================================
       SUBSCRIBE ONCE
    =============================================== */

    once(eventName, callback, options = {}) {

        return this.on(eventName, callback, {
            ...options,
            once: true
        });
    }

    /* ===============================================
       UNSUBSCRIBE
    =============================================== */

    /**
     * Removes a listener.
     *
     * @param {string} eventName
     * @param {number|Function} listenerIdentifier
     * @returns {boolean}
     */

    off(eventName, listenerIdentifier) {

        this.#ensureActive();

        const listeners = this.listeners.get(eventName);

        if (!listeners) {
            return false;
        }

        const index = listeners.findIndex(listener => {

            return (
                listener.id === listenerIdentifier ||
                listener.callback === listenerIdentifier
            );

        });

        if (index === -1) {
            return false;
        }

        listeners[index].active = false;

        listeners.splice(index, 1);

        if (listeners.length === 0) {
            this.listeners.delete(eventName);
        }

        return true;
    }

    /* ===============================================
       REMOVE ALL LISTENERS
    =============================================== */

    removeAllListeners(eventName = null) {

        this.#ensureActive();

        if (eventName === null) {

            for (const listeners of this.listeners.values()) {

                for (const listener of listeners) {
                    listener.active = false;
                }

            }

            this.listeners.clear();

            return;
        }

        const listeners = this.listeners.get(eventName);

        if (!listeners) {
            return;
        }

        for (const listener of listeners) {
            listener.active = false;
        }

        this.listeners.delete(eventName);
    }

    /* ===============================================
       PUBLISH EVENT
    =============================================== */

    /**
     * Publishes an event to all registered listeners.
     *
     * @param {string} eventName
     * @param {*} payload
     * @returns {Object} Event record
     */

    emit(eventName, payload = null) {

        this.#validateEvent(eventName);

        this.#ensureActive();

        const event = {

            id: ++this.eventCounter,

            name: eventName,

            payload,

            timestamp: Date.now(),

            errors: [],

            listenerCount: 0
        };

        this.#recordEvent(event);

        const listeners = [
            ...(this.listeners.get(eventName) ?? [])
        ];

        if (this.config.allowWildcardListeners) {

            const wildcardListeners =
                this.listeners.get("*") ?? [];

            listeners.push(...wildcardListeners);
        }

        listeners.sort((a, b) => b.priority - a.priority);

        for (const listener of listeners) {

            if (!listener.active) {
                continue;
            }

            if (listener.once) {
                this.off(listener.eventName, listener.id);
            }

            try {

                listener.callback.call(
                    listener.context,
                    payload,
                    event
                );

                event.listenerCount++;

            } catch (error) {

                event.errors.push({
                    listenerId: listener.id,
                    message: error.message,
                    timestamp: Date.now()
                });

                if (this.config.captureErrors) {

                    this.#handleListenerError(
                        eventName,
                        error,
                        listener
                    );

                }

            }
        }

        return event;
    }

    /* ===============================================
       ASYNC PUBLISH
    =============================================== */

    /**
     * Executes listeners sequentially and awaits promises.
     *
     * @param {string} eventName
     * @param {*} payload
     * @returns {Promise<Object>}
     */

    async emitAsync(eventName, payload = null) {

        this.#validateEvent(eventName);

        this.#ensureActive();

        const event = {

            id: ++this.eventCounter,

            name: eventName,

            payload,

            timestamp: Date.now(),

            errors: [],

            listenerCount: 0
        };

        this.#recordEvent(event);

        const listeners = [
            ...(this.listeners.get(eventName) ?? [])
        ];

        if (this.config.allowWildcardListeners) {

            listeners.push(
                ...(this.listeners.get("*") ?? [])
            );
        }

        listeners.sort((a, b) => b.priority - a.priority);

        for (const listener of listeners) {

            if (!listener.active) {
                continue;
            }

            if (listener.once) {
                this.off(listener.eventName, listener.id);
            }

            try {

                await listener.callback.call(
                    listener.context,
                    payload,
                    event
                );

                event.listenerCount++;

            } catch (error) {

                event.errors.push({
                    listenerId: listener.id,
                    message: error.message,
                    timestamp: Date.now()
                });

                if (this.config.captureErrors) {

                    this.#handleListenerError(
                        eventName,
                        error,
                        listener
                    );

                }

            }
        }

        return event;
    }

    /* ===============================================
       EVENT HISTORY
    =============================================== */

    #recordEvent(event) {

        this.history.push(event);

        const excess =
            this.history.length - this.config.maxHistory;

        if (excess > 0) {
            this.history.splice(0, excess);
        }
    }

    getHistory(options = {}) {

        const {
            eventName = null,
            limit = this.config.maxHistory
        } = options;

        let result = this.history;

        if (eventName !== null) {

            result = result.filter(
                event => event.name === eventName
            );
        }

        return result.slice(-limit);
    }

    clearHistory() {

        this.#ensureActive();

        this.history.length = 0;
    }

    /* ===============================================
       LISTENER INFORMATION
    =============================================== */

    listenerCount(eventName = null) {

        if (eventName !== null) {

            return (
                this.listeners.get(eventName)?.length ?? 0
            );
        }

        let count = 0;

        for (const listeners of this.listeners.values()) {
            count += listeners.length;
        }

        return count;
    }

    eventNames() {

        return Array.from(this.listeners.keys());
    }

    hasListeners(eventName) {

        return this.listenerCount(eventName) > 0;
    }

    /* ===============================================
       ERROR HANDLING
    =============================================== */

    #handleListenerError(eventName, error, listener) {

        if (eventName === GAME_EVENTS.SYSTEM_ERROR) {
            return;
        }

        const errorEvent = {

            source: "EventBus",

            eventName,

            listenerId: listener.id,

            message: error.message,

            stack: error.stack ?? null,

            timestamp: Date.now()
        };

        const errorListeners = [
            ...(this.listeners.get(
                GAME_EVENTS.SYSTEM_ERROR
            ) ?? [])
        ];

        for (const errorListener of errorListeners) {

            if (!errorListener.active) {
                continue;
            }

            try {

                errorListener.callback(errorEvent);

            } catch (nestedError) {

                // Prevent recursive error handling.
            }
        }
    }

    /* ===============================================
       VALIDATION
    =============================================== */

    #validateEvent(eventName) {

        if (
            typeof eventName !== "string" ||
            eventName.trim().length === 0
        ) {
            throw new TypeError(
                "Event name must be a non-empty string."
            );
        }
    }

    #ensureActive() {

        if (this.destroyed) {
            throw new Error(
                "EventBus has been destroyed."
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

        this.removeAllListeners();

        this.history.length = 0;

        this.destroyed = true;
    }
}

/* =====================================================
   GLOBAL GAME EVENT BUS
===================================================== */

export const gameEventBus = new EventBus();

/* =====================================================
   CONVENIENCE FUNCTIONS
===================================================== */

export function emitGameEvent(eventName, payload = null) {

    return gameEventBus.emit(eventName, payload);
}

export function onGameEvent(
    eventName,
    callback,
    options = {}
) {

    return gameEventBus.on(
        eventName,
        callback,
        options
    );
}

export function onceGameEvent(
    eventName,
    callback,
    options = {}
) {

    return gameEventBus.once(
        eventName,
        callback,
        options
    );
}

export function offGameEvent(
    eventName,
    listenerIdentifier
) {

    return gameEventBus.off(
        eventName,
        listenerIdentifier
    );
}

/* =====================================================
   MODULE INITIALIZATION
===================================================== */

console.log(
    "WORLD AT WAR: Event Bus module loaded."
);
