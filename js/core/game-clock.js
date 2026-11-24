
/* =====================================================
   WORLD AT WAR: MODERN ERA
   CORE GAME CLOCK
   Version: 1.0.0

   Global simulation calendar and time controller.
===================================================== */

import { GAME_CONFIG } from "../config.js";

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

export const CLOCK_SPEEDS = Object.freeze(
    [...GAME_CONFIG.time.availableSpeeds]
);

export const HOURS_PER_DAY = 24;

export const DAYS_PER_WEEK = 7;

export const MONTH_NAMES = Object.freeze([
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
]);

const MONTH_LENGTHS = Object.freeze([
    31, 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31
]);

/* =====================================================
   CALENDAR UTILITIES
===================================================== */

export function isLeapYear(year) {

    return (
        year % 4 === 0 &&
        (
            year % 100 !== 0 ||
            year % 400 === 0
        )
    );
}

export function getDaysInMonth(month, year) {

    if (
        !Number.isInteger(month) ||
        month < 1 ||
        month > 12
    ) {
        throw new RangeError("Invalid month.");
    }

    if (!Number.isInteger(year) || year < 1) {
        throw new RangeError("Invalid year.");
    }

    if (month === 2 && isLeapYear(year)) {
        return 29;
    }

    return MONTH_LENGTHS[month - 1];
}

export function validateDate(date) {

    if (!date || typeof date !== "object") {
        return false;
    }

    const { day, month, year } = date;

    if (
        !Number.isInteger(day) ||
        !Number.isInteger(month) ||
        !Number.isInteger(year)
    ) {
        return false;
    }

    if (year < 1 || month < 1 || month > 12) {
        return false;
    }

    return (
        day >= 1 &&
        day <= getDaysInMonth(month, year)
    );
}

export function compareDates(first, second) {

    const a = toDateOrdinal(first);
    const b = toDateOrdinal(second);

    return Math.sign(a - b);
}

export function toDateOrdinal(date) {

    if (!validateDate(date)) {
        throw new RangeError("Invalid calendar date.");
    }

    const year = date.year - 1;

    let totalDays =
        365 * year +
        Math.floor(year / 4) -
        Math.floor(year / 100) +
        Math.floor(year / 400);

    for (let month = 1; month < date.month; month++) {
        totalDays += getDaysInMonth(month, date.year);
    }

    totalDays += date.day - 1;

    return totalDays;
}

export function getDayOfWeek(date) {

    const ordinal = toDateOrdinal(date);

    // January 1, year 1 is Monday.
    return ordinal % DAYS_PER_WEEK;
}

/* =====================================================
   GAME CLOCK CLASS
===================================================== */

export class GameClock {

    constructor(state, eventBus = gameEventBus, options = {}) {

        if (!state || !state.clock) {
            throw new TypeError(
                "GameClock requires a valid game state."
            );
        }

        this.state = state;

        this.eventBus = eventBus;

        this.config = {
            ticksPerDay: GAME_CONFIG.time.ticksPerDay,

            maxTicksPerUpdate: 100,

            realMillisecondsPerHour: 1000,

            ...options
        };

        this.accumulator = 0;

        this.lastFrameTimestamp = null;

        this.running = false;

        this.frameHandle = null;

        this.boundFrame = this.#frame.bind(this);

        this.callbacks = new Set();

        this.updateCount = 0;

        this.validateClock();
    }

    /* ===============================================
       GETTERS
    =============================================== */

    get date() {

        return {
            ...this.state.clock.date
        };
    }

    get speed() {

        return this.state.clock.speed;
    }

    get isPaused() {

        return this.state.clock.isPaused;
    }

    get currentHour() {

        return this.state.clock.currentHour;
    }

    get totalTicks() {

        return this.state.clock.totalTicks;
    }

    get totalDays() {

        return this.state.clock.totalDays;
    }

    get totalHours() {

        return this.state.clock.totalHours;
    }

    get formattedDate() {

        const date = this.state.clock.date;

        const day = String(date.day).padStart(2, "0");

        const month = MONTH_NAMES[date.month - 1];

        return `${day} ${month} ${date.year}`;
    }

    /* ===============================================
       VALIDATION
    =============================================== */

    validateClock() {

        const clock = this.state.clock;

        if (!validateDate(clock.date)) {
            throw new Error("Game clock contains an invalid date.");
        }

        if (
            !CLOCK_SPEEDS.includes(clock.speed)
        ) {
            throw new Error("Unsupported game speed.");
        }

        if (
            !Number.isInteger(clock.currentHour) ||
            clock.currentHour < 0 ||
            clock.currentHour >= HOURS_PER_DAY
        ) {
            throw new Error("Invalid current hour.");
        }
    }

    /* ===============================================
       START AND STOP
    =============================================== */

    start() {

        if (this.running) {
            return;
        }

        if (this.state.status.phase === GAME_PHASES.GAME_OVER) {
            throw new Error("Cannot start a finished campaign.");
        }

        this.running = true;

        this.state.clock.isPaused = false;

        this.state.status.isPaused = false;

        this.state.status.isRunning = true;

        this.state.status.phase = GAME_PHASES.RUNNING;

        this.lastFrameTimestamp = null;

        this.#requestFrame();

        this.eventBus.emit(GAME_EVENTS.GAME_RESUMED, {
            date: this.date,
            speed: this.speed
        });
    }

    pause() {

        if (!this.running && this.isPaused) {
            return;
        }

        this.running = false;

        this.state.clock.isPaused = true;

        this.state.status.isPaused = true;

        this.state.status.isRunning = false;

        if (this.state.status.phase !== GAME_PHASES.GAME_OVER) {
            this.state.status.phase = GAME_PHASES.PAUSED;
        }

        this.lastFrameTimestamp = null;

        this.accumulator = 0;

        this.#cancelFrame();

        this.eventBus.emit(GAME_EVENTS.GAME_PAUSED, {
            date: this.date,
            totalTicks: this.totalTicks
        });
    }

    togglePause() {

        if (this.isPaused) {
            this.start();
        } else {
            this.pause();
        }
    }

    /* ===============================================
       GAME SPEED
    =============================================== */

    setSpeed(speed) {

        if (!CLOCK_SPEEDS.includes(speed)) {
            throw new RangeError(
                `Unsupported game speed: ${speed}`
            );
        }

        const previousSpeed = this.speed;

        this.state.clock.speed = speed;

        this.eventBus.emit(GAME_EVENTS.CLOCK_TICK, {
            type: "speed_changed",

            previousSpeed,

            speed,

            date: this.date
        });

        return speed;
    }

    increaseSpeed() {

        const index = CLOCK_SPEEDS.indexOf(this.speed);

        const nextIndex = Math.min(
            index + 1,
            CLOCK_SPEEDS.length - 1
        );

        return this.setSpeed(CLOCK_SPEEDS[nextIndex]);
    }

    decreaseSpeed() {

        const index = CLOCK_SPEEDS.indexOf(this.speed);

        const nextIndex = Math.max(index - 1, 0);

        return this.setSpeed(CLOCK_SPEEDS[nextIndex]);
    }

    /* ===============================================
       ADVANCE TIME
    =============================================== */

    /**
     * Advances simulation by one hour.
     */

    tick() {

        if (this.state.status.phase === GAME_PHASES.GAME_OVER) {
            return false;
        }

        const clock = this.state.clock;

        const previousDate = this.date;

        clock.totalTicks++;

        clock.totalHours++;

        clock.currentHour++;

        this.state.statistics.campaignHours++;

        this.eventBus.emit(GAME_EVENTS.CLOCK_TICK, {
            date: this.date,

            hour: clock.currentHour,

            totalTicks: clock.totalTicks
        });

        this.#notifyCallbacks("hour", {
            date: this.date,
            hour: clock.currentHour
        });

        if (clock.currentHour >= HOURS_PER_DAY) {

            clock.currentHour = 0;

            this.#advanceDay(previousDate);
        }

        return true;
    }

    /* ===============================================
       ADVANCE DAY
    =============================================== */

    #advanceDay(previousDate) {

        const clock = this.state.clock;

        const date = clock.date;

        const previousMonth = date.month;

        const previousYear = date.year;

        date.day++;

        clock.totalDays++;

        this.state.statistics.campaignDays++;

        if (date.day > getDaysInMonth(date.month, date.year)) {

            date.day = 1;

            date.month++;

            if (date.month > 12) {

                date.month = 1;

                date.year++;
            }
        }

        const dayPayload = {
            date: this.date,

            previousDate,

            totalDays: clock.totalDays
        };

        this.eventBus.emit(
            GAME_EVENTS.DAY_CHANGED,
            dayPayload
        );

        this.#notifyCallbacks("day", dayPayload);

        const previousOrdinal = toDateOrdinal(previousDate);

        const currentOrdinal = toDateOrdinal(date);

        if (
            Math.floor(previousOrdinal / DAYS_PER_WEEK) !==
            Math.floor(currentOrdinal / DAYS_PER_WEEK)
        ) {

            const payload = {
                date: this.date,
                totalDays: clock.totalDays
            };

            this.eventBus.emit(
                GAME_EVENTS.WEEK_CHANGED,
                payload
            );

            this.#notifyCallbacks("week", payload);
        }

        if (date.month !== previousMonth) {

            const payload = {
                date: this.date,

                previousMonth,

                month: date.month,

                monthName: MONTH_NAMES[date.month - 1]
            };

            this.eventBus.emit(
                GAME_EVENTS.MONTH_CHANGED,
                payload
            );

            this.#notifyCallbacks("month", payload);
        }

        if (date.year !== previousYear) {

            const payload = {
                date: this.date,

                previousYear,

                year: date.year
            };

            this.eventBus.emit(
                GAME_EVENTS.YEAR_CHANGED,
                payload
            );

            this.#notifyCallbacks("year", payload);
        }

        if (date.day === 1) {

            this.eventBus.emit(
                GAME_EVENTS.MONTH_CHANGED,
                {
                    date: this.date,
                    isFirstDay: true
                }
            );
        }
    }

    /* ===============================================
       MANUAL DATE CONTROL
    =============================================== */

    setDate(newDate) {

        if (!validateDate(newDate)) {
            throw new RangeError("Cannot set an invalid date.");
        }

        const previousDate = this.date;

        this.state.clock.date = {
            day: newDate.day,
            month: newDate.month,
            year: newDate.year
        };

        this.state.clock.currentHour = 0;

        this.accumulator = 0;

        this.eventBus.emit(GAME_EVENTS.DAY_CHANGED, {
            date: this.date,

            previousDate,

            manualChange: true
        });

        return this.date;
    }

    advanceHours(hours = 1) {

        if (
            !Number.isInteger(hours) ||
            hours < 0
        ) {
            throw new RangeError(
                "Hours must be a non-negative integer."
            );
        }

        for (let i = 0; i < hours; i++) {
            if (!this.tick()) {
                break;
            }
        }

        return this.date;
    }

    advanceDays(days = 1) {

        if (
            !Number.isInteger(days) ||
            days < 0
        ) {
            throw new RangeError(
                "Days must be a non-negative integer."
            );
        }

        return this.advanceHours(days * HOURS_PER_DAY);
    }

    /* ===============================================
       CALLBACKS
    =============================================== */

    onTimeUnit(callback) {

        if (typeof callback !== "function") {
            throw new TypeError(
                "Time callback must be a function."
            );
        }

        this.callbacks.add(callback);

        return () => {
            this.callbacks.delete(callback);
        };
    }

    #notifyCallbacks(unit, payload) {

        for (const callback of this.callbacks) {

            try {

                callback(unit, payload);

            } catch (error) {

                this.eventBus.emit(
                    GAME_EVENTS.SYSTEM_ERROR,
                    {
                        source: "GameClock",

                        message: error.message,

                        timestamp: Date.now()
                    }
                );
            }
        }
    }

    /* ===============================================
       REAL-TIME LOOP
    =============================================== */

    #requestFrame() {

        if (!this.running) {
            return;
        }

        if (typeof requestAnimationFrame === "function") {

            this.frameHandle = requestAnimationFrame(
                this.boundFrame
            );

        } else {

            throw new Error(
                "requestAnimationFrame is unavailable in this environment."
            );
        }
    }

    #cancelFrame() {

        if (
            this.frameHandle !== null &&
            typeof cancelAnimationFrame === "function"
        ) {

            cancelAnimationFrame(this.frameHandle);
        }

        this.frameHandle = null;
    }

    #frame(timestamp) {

        if (!this.running) {
            return;
        }

        if (this.lastFrameTimestamp === null) {
            this.lastFrameTimestamp = timestamp;
        }

        const delta = Math.max(
            0,
            timestamp - this.lastFrameTimestamp
        );

        this.lastFrameTimestamp = timestamp;

        this.accumulator += delta;

        const interval =
            this.config.realMillisecondsPerHour /
            this.speed;

        let processed = 0;

        while (
            this.accumulator >= interval &&
            processed < this.config.maxTicksPerUpdate &&
            this.running
        ) {

            this.tick();

            this.accumulator -= interval;

            processed++;
        }

        if (
            processed >= this.config.maxTicksPerUpdate &&
            this.accumulator >= interval
        ) {
            this.accumulator = 0;
        }

        this.updateCount++;

        this.#requestFrame();
    }

    /* ===============================================
       EXPORT CLOCK DATA
    =============================================== */

    getSnapshot() {

        return {

            date: this.date,

            speed: this.speed,

            isPaused: this.isPaused,

            currentHour: this.currentHour,

            totalTicks: this.totalTicks,

            totalHours: this.totalHours,

            totalDays: this.totalDays,

            formattedDate: this.formattedDate
        };
    }

    /* ===============================================
       DESTROY
    =============================================== */

    destroy() {

        this.pause();

        this.callbacks.clear();

        this.accumulator = 0;

        this.lastFrameTimestamp = null;
    }
}

/* =====================================================
   MODULE INITIALIZATION
===================================================== */

console.log(
    "WORLD AT WAR: Game Clock module loaded."
);
