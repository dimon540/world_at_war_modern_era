
/* =====================================================
   WORLD AT WAR: MODERN ERA
   CORE GAME LOOP
   Version: 1.0.0

   Central simulation scheduler.

   Coordinates:
   - Country AI
   - Economy
   - Military
   - Diplomacy
   - Politics
   - Technology
   - Historical events
   - World events

   Simulation frequencies:
   - Hourly
   - Daily
   - Weekly
   - Monthly
   - Yearly
===================================================== */

import {
    GAME_EVENTS,
    gameEventBus
} from "./event-bus.js";

import {
    GAME_PHASES
} from "./game-state.js";

/* =====================================================
   CONSTANTS
===================================================== */

export const SIMULATION_INTERVALS = Object.freeze({

    HOURLY: "hourly",

    DAILY: "daily",

    WEEKLY: "weekly",

    MONTHLY: "monthly",

    YEARLY: "yearly"

});

export const SIMULATION_PRIORITY = Object.freeze({

    CRITICAL: 100,

    HIGH: 75,

    NORMAL: 50,

    LOW: 25,

    BACKGROUND: 10

});

/* =====================================================
   DEFAULT CONFIGURATION
===================================================== */

const DEFAULT_CONFIG = Object.freeze({

    maxTasksPerUpdate: 1000,

    maxExecutionTimeMs: 12,

    stopOnTaskError: false,

    collectPerformance: true,

    enableTaskHistory: true,

    maxTaskHistory: 500,

    processBackgroundTasks: true

});

/* =====================================================
   GAME LOOP CLASS
===================================================== */

export class GameLoop {

    constructor(state, clock, eventBus = gameEventBus, options = {}) {

        if (!state) {
            throw new TypeError("GameLoop requires game state.");
        }

        if (!clock) {
            throw new TypeError("GameLoop requires a GameClock.");
        }

        this.state = state;

        this.clock = clock;

        this.eventBus = eventBus;

        this.config = {
            ...DEFAULT_CONFIG,
            ...options
        };

        this.tasks = new Map();

        this.taskCounter = 0;

        this.taskHistory = [];

        this.running = false;

        this.destroyed = false;

        this.pendingUnits = [];

        this.processing = false;

        this.metrics = {

            totalExecutions: 0,

            successfulExecutions: 0,

            failedExecutions: 0,

            skippedExecutions: 0,

            totalExecutionTime: 0,

            averageExecutionTime: 0,

            lastExecutionTime: 0,

            lastUpdateTimestamp: null

        };

        this.removeClockListener = null;

        this.#registerClockListener();
    }

    /* ===============================================
       CLOCK CONNECTION
    =============================================== */

    #registerClockListener() {

        this.removeClockListener = this.clock.onTimeUnit(
            (unit, payload) => {

                this.#handleTimeUnit(unit, payload);

            }
        );
    }

    #handleTimeUnit(unit, payload) {

        if (!this.running || this.destroyed) {
            return;
        }

        if (unit === "hour") {

            this.pendingUnits.push(
                SIMULATION_INTERVALS.HOURLY
            );

        }

        if (unit === "day") {

            this.pendingUnits.push(
                SIMULATION_INTERVALS.DAILY
            );

        }

        if (unit === "week") {

            this.pendingUnits.push(
                SIMULATION_INTERVALS.WEEKLY
            );

        }

        if (unit === "month") {

            this.pendingUnits.push(
                SIMULATION_INTERVALS.MONTHLY
            );

        }

        if (unit === "year") {

            this.pendingUnits.push(
                SIMULATION_INTERVALS.YEARLY
            );

        }

        this.#processPendingUnits(payload);
    }

    /* ===============================================
       TASK REGISTRATION
    =============================================== */

    /**
     * Registers a simulation task.
     *
     * @param {Object} options
     * @returns {Function} Unregister function
     */

    registerTask(options = {}) {

        this.#ensureActive();

        const {

            id = null,

            name,

            interval,

            execute,

            priority = SIMULATION_PRIORITY.NORMAL,

            enabled = true,

            countrySpecific = false,

            description = "",

            runWhenPaused = false

        } = options;

        if (
            typeof name !== "string" ||
            name.trim().length === 0
        ) {
            throw new TypeError("Task name is required.");
        }

        if (
            !Object.values(SIMULATION_INTERVALS).includes(interval)
        ) {
            throw new RangeError("Invalid simulation interval.");
        }

        if (typeof execute !== "function") {
            throw new TypeError("Task execute must be a function.");
        }

        const taskId = id ?? `simulation_task_${++this.taskCounter}`;

        if (this.tasks.has(taskId)) {
            throw new Error(`Task already exists: ${taskId}`);
        }

        const task = {

            id: taskId,

            name,

            interval,

            execute,

            priority,

            enabled,

            countrySpecific,

            description,

            runWhenPaused,

            executions: 0,

            failures: 0,

            lastExecution: null,

            averageExecutionTime: 0,

            totalExecutionTime: 0

        };

        this.tasks.set(taskId, task);

        this.#sortTasks();

        return () => this.unregisterTask(taskId);
    }

    /* ===============================================
       REMOVE TASK
    =============================================== */

    unregisterTask(taskId) {

        this.#ensureActive();

        return this.tasks.delete(taskId);
    }

    /* ===============================================
       TASK CONTROL
    =============================================== */

    enableTask(taskId) {

        const task = this.tasks.get(taskId);

        if (!task) {
            return false;
        }

        task.enabled = true;

        return true;
    }

    disableTask(taskId) {

        const task = this.tasks.get(taskId);

        if (!task) {
            return false;
        }

        task.enabled = false;

        return true;
    }

    enableAllTasks() {

        for (const task of this.tasks.values()) {
            task.enabled = true;
        }
    }

    disableAllTasks() {

        for (const task of this.tasks.values()) {
            task.enabled = false;
        }
    }

    /* ===============================================
       TASK PRIORITY
    =============================================== */

    #sortTasks() {

        const sorted = [...this.tasks.entries()];

        sorted.sort((a, b) => {

            return b[1].priority - a[1].priority;

        });

        this.tasks = new Map(sorted);
    }

    /* ===============================================
       START AND STOP
    =============================================== */

    start() {

        this.#ensureActive();

        if (this.running) {
            return;
        }

        this.running = true;

        this.state.simulation.enabled = true;

        this.state.simulation.enabled = true;
    }

    stop() {

        if (!this.running) {
            return;
        }

        this.running = false;

        this.pendingUnits.length = 0;

        this.state.simulation.enabled = false;
    }

    /* ===============================================
       PROCESS PENDING TIME UNITS
    =============================================== */

    #processPendingUnits(payload) {

        if (this.processing || !this.running) {
            return;
        }

        this.processing = true;

        try {

            while (this.pendingUnits.length > 0) {

                const interval = this.pendingUnits.shift();

                this.#executeInterval(interval, payload);

            }

        } finally {

            this.processing = false;

        }
    }

    /* ===============================================
       EXECUTE INTERVAL
    =============================================== */

    #executeInterval(interval, payload = null) {

        const startedAt = performance.now();

        let processed = 0;

        const errors = [];

        for (const task of this.tasks.values()) {

            if (!task.enabled) {
                continue;
            }

            if (task.interval !== interval) {
                continue;
            }

            if (
                processed >= this.config.maxTasksPerUpdate
            ) {
                break;
            }

            const elapsed =
                performance.now() - startedAt;

            if (
                elapsed >= this.config.maxExecutionTimeMs
            ) {
                break;
            }

            try {

                this.#executeTask(task, {
                    interval,
                    payload,
                    state: this.state,
                    clock: this.clock,
                    eventBus: this.eventBus
                });

                processed++;

            } catch (error) {

                errors.push({
                    taskId: task.id,
                    taskName: task.name,
                    message: error.message
                });

                if (this.config.stopOnTaskError) {
                    break;
                }

            }
        }

        const executionTime =
            performance.now() - startedAt;

        this.#updateMetrics(executionTime);

        this.state.simulation.performance.lastUpdateDuration =
            executionTime;

        this.state.simulation.performance.ticksProcessed++;

        this.eventBus.emit(
            GAME_EVENTS.WORLD_UPDATED,
            {
                interval,

                processedTasks: processed,

                executionTime,

                errors,

                date: this.clock.date
            }
        );

        return {
            interval,
            processedTasks: processed,
            executionTime,
            errors
        };
    }

    /* ===============================================
       EXECUTE SINGLE TASK
    =============================================== */

    #executeTask(task, context) {

        const startedAt = performance.now();

        task.executions++;

        try {

            const result = task.execute(context);

            if (
                result &&
                typeof result.then === "function"
            ) {
                throw new Error(
                    "Simulation tasks must be synchronous. " +
                    "Use bounded background processing for asynchronous work."
                );
            }

            const executionTime =
                performance.now() - startedAt;

            task.lastExecution = Date.now();

            task.totalExecutionTime += executionTime;

            task.averageExecutionTime =
                task.totalExecutionTime / task.executions;

            this.metrics.totalExecutions++;

            this.metrics.successfulExecutions++;

            this.#recordTaskHistory({
                taskId: task.id,
                taskName: task.name,
                success: true,
                executionTime
            });

            return result;

        } catch (error) {

            task.failures++;

            this.metrics.totalExecutions++;

            this.metrics.failedExecutions++;

            this.#recordTaskHistory({
                taskId: task.id,
                taskName: task.name,
                success: false,
                error: error.message
            });

            this.eventBus.emit(
                GAME_EVENTS.SYSTEM_ERROR,
                {
                    source: "GameLoop",
                    taskId: task.id,
                    taskName: task.name,
                    message: error.message,
                    timestamp: Date.now()
                }
            );

            throw error;
        }
    }

    /* ===============================================
       METRICS
    =============================================== */

    #updateMetrics(executionTime) {

        this.metrics.lastExecutionTime = executionTime;

        this.metrics.totalExecutionTime += executionTime;

        this.metrics.averageExecutionTime =
            this.metrics.totalExecutionTime /
            Math.max(this.metrics.totalExecutions, 1);

        this.metrics.lastUpdateTimestamp = Date.now();
    }

    #recordTaskHistory(record) {

        if (!this.config.enableTaskHistory) {
            return;
        }

        this.taskHistory.push({
            ...record,
            timestamp: Date.now()
        });

        const excess =
            this.taskHistory.length -
            this.config.maxTaskHistory;

        if (excess > 0) {
            this.taskHistory.splice(0, excess);
        }
    }

    getMetrics() {

        return {
            ...this.metrics,
            registeredTasks: this.tasks.size,
            enabledTasks: [...this.tasks.values()]
                .filter(task => task.enabled).length
        };
    }

    getTaskHistory(limit = 100) {

        return this.taskHistory.slice(-limit);
    }

    getRegisteredTasks() {

        return [...this.tasks.values()].map(task => ({
            id: task.id,
            name: task.name,
            interval: task.interval,
            priority: task.priority,
            enabled: task.enabled,
            executions: task.executions,
            failures: task.failures,
            averageExecutionTime: task.averageExecutionTime
        }));
    }

    /* ===============================================
       MANUAL SIMULATION STEP
    =============================================== */

    executeManualStep(interval) {

        this.#ensureActive();

        if (
            !Object.values(SIMULATION_INTERVALS).includes(interval)
        ) {
            throw new RangeError("Invalid simulation interval.");
        }

        return this.#executeInterval(interval, {
            manual: true,
            date: this.clock.date
        });
    }

    /* ===============================================
       RESET METRICS
    =============================================== */

    resetMetrics() {

        this.metrics = {

            totalExecutions: 0,

            successfulExecutions: 0,

            failedExecutions: 0,

            skippedExecutions: 0,

            totalExecutionTime: 0,

            averageExecutionTime: 0,

            lastExecutionTime: 0,

            lastUpdateTimestamp: null

        };

        this.taskHistory.length = 0;
    }

    /* ===============================================
       VALIDATION
    =============================================== */

    #ensureActive() {

        if (this.destroyed) {
            throw new Error(
                "GameLoop has been destroyed."
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

        this.stop();

        if (this.removeClockListener) {
            this.removeClockListener();
        }

        this.tasks.clear();

        this.taskHistory.length = 0;

        this.pendingUnits.length = 0;

        this.destroyed = true;
    }
}

/* =====================================================
   MODULE INITIALIZATION
===================================================== */

console.log(
    "WORLD AT WAR: Game Loop module loaded."
);
