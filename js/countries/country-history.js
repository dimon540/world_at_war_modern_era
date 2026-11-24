/* =========================================================
   WORLD AT WAR: MODERN ERA
   COUNTRY HISTORY
   Version: 1.0.0

   Historical country timeline and date-aware event processing.
   Events are data-driven. Missing successor-country records or
   territorial datasets are never fabricated by this module.
========================================================= */

import { markGameStateDirty } from "../core/game-state.js";
import { GAME_EVENTS, gameEventBus } from "../core/event-bus.js";

const EVENT_TYPES = new Set([
    "independence",
    "dissolution",
    "renaming",
    "succession",
    "international_recognition",
    "membership"
]);

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toISODate(value) {
    if (typeof value === "string" && isValidDate(value)) return value;
    if (isRecord(value) &&
        Number.isInteger(value.year) &&
        Number.isInteger(value.month) &&
        Number.isInteger(value.day)) {
        const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
        if (date.getUTCFullYear() === value.year &&
            date.getUTCMonth() === value.month - 1 &&
            date.getUTCDate() === value.day) {
            return date.toISOString().slice(0, 10);
        }
    }
    throw new TypeError("A valid YYYY-MM-DD date or {day, month, year} object is required.");
}

function normalizeEvent(source, index) {
    if (!isRecord(source)) throw new TypeError(`Historical event at index ${index} must be an object.`);
    const id = String(source.id ?? "").trim();
    if (!id) throw new TypeError(`Historical event at index ${index} has no ID.`);
    if (!isValidDate(source.date)) throw new TypeError(`Historical event ${id} has an invalid date.`);
    if (!EVENT_TYPES.has(source.type)) throw new TypeError(`Historical event ${id} has an unsupported type.`);
    if (!Array.isArray(source.countries) ||
        source.countries.some(countryId => typeof countryId !== "string" || !countryId.trim())) {
        throw new TypeError(`Historical event ${id} must list affected country IDs.`);
    }

    return {
        ...source,
        id,
        date: source.date,
        countries: [...new Set(source.countries.map(value => value.trim()))],
        description: String(source.description ?? ""),
        status: source.status ?? "unverified",
        changes: isRecord(source.changes) ? { ...source.changes } : {},
        sources: Array.isArray(source.sources) ? source.sources.map(sourceRef => ({ ...sourceRef })) : []
    };
}

export class CountryHistory {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.world?.countries || !state.events) {
            throw new TypeError("CountryHistory requires initialized world and event state.");
        }
        this.state = state;
        this.eventBus = eventBus;
        this.options = {
            applyDisputedEvents: false,
            applyRenamings: true,
            ...options
        };
        this.events = [];
        this.eventIndex = new Map();
        this.appliedEvents = new Set(
            Array.isArray(state.events.triggeredEvents)
                ? state.events.triggeredEvents.map(item =>
                    typeof item === "string" ? item : item?.id
                ).filter(Boolean)
                : []
        );
        this.destroyed = false;
    }

    #ensureActive() {
        if (this.destroyed) throw new Error("CountryHistory has been destroyed.");
    }

    loadDataset(dataset) {
        this.#ensureActive();
        const records = Array.isArray(dataset) ? dataset : dataset?.events;
        if (!Array.isArray(records)) {
            throw new TypeError("Country history dataset must contain an events array.");
        }

        const normalized = records.map(normalizeEvent);
        const nextIndex = new Map();
        for (const event of normalized) {
            if (nextIndex.has(event.id)) throw new Error(`Duplicate historical event ID: ${event.id}`);
            nextIndex.set(event.id, event);
        }

        this.events = normalized.sort((a, b) =>
            a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
        );
        this.eventIndex = nextIndex;
        this.state.events.historicalEvents = Object.fromEntries(
            this.events.map(event => [event.id, event])
        );

        return this.getSnapshot();
    }

    getEvent(eventId) {
        this.#ensureActive();
        return this.eventIndex.get(String(eventId ?? "")) ?? null;
    }

    getEvents(options = {}) {
        this.#ensureActive();
        const {
            from = null,
            to = null,
            type = null,
            status = null,
            countryId = null,
            includeApplied = true
        } = options;
        const fromDate = from === null ? null : toISODate(from);
        const toDate = to === null ? null : toISODate(to);
        if (fromDate && toDate && fromDate > toDate) {
            throw new RangeError("Historical event range start must not exceed its end.");
        }

        return this.events.filter(event => {
            if (fromDate && event.date < fromDate) return false;
            if (toDate && event.date > toDate) return false;
            if (type && event.type !== type) return false;
            if (status && event.status !== status) return false;
            if (countryId && !event.countries.includes(String(countryId))) return false;
            if (!includeApplied && this.appliedEvents.has(event.id)) return false;
            return true;
        });
    }

    getEventsForCountry(countryId, options = {}) {
        this.#ensureActive();
        const id = String(countryId ?? "").trim();
        if (!id) return [];
        return this.getEvents({ ...options, countryId: id });
    }

    getTimeline(countryId, options = {}) {
        this.#ensureActive();
        const events = countryId
            ? this.getEventsForCountry(countryId, options)
            : this.getEvents(options);
        return events.map(event => ({
            ...event,
            applied: this.appliedEvents.has(event.id)
        }));
    }

    getDueEvents(date, options = {}) {
        this.#ensureActive();
        const targetDate = toISODate(date);
        return this.getEvents({
            to: targetDate,
            includeApplied: false,
            ...options
        });
    }

    applyEvent(eventId, options = {}) {
        this.#ensureActive();
        const event = this.getEvent(eventId);
        if (!event) throw new RangeError(`Unknown historical event: ${eventId}`);
        if (this.appliedEvents.has(event.id)) return false;

        const allowDisputed = options.applyDisputedEvents ?? this.options.applyDisputedEvents;
        if (event.status === "disputed" && !allowDisputed) {
            return { applied: false, reason: "disputed_event_requires_explicit_permission" };
        }

        const changes = [];
        const renameAllowed = options.applyRenamings ?? this.options.applyRenamings;

        // Only rename a country if the referenced entity already exists.
        // This prevents future-state records from being invented.
        if (renameAllowed && event.type === "renaming") {
            const targetId = event.changes.countryId ?? event.countries[0];
            const country = this.state.world.countries[targetId];
            if (country) {
                const previousName = country.name;
                const previousOfficialName = country.officialName;
                const nextName = event.changes.newName;
                const nextOfficialName = event.changes.newOfficialName;

                if (typeof nextName === "string" && nextName.trim()) {
                    country.name = nextName.trim();
                }
                if (typeof nextOfficialName === "string" && nextOfficialName.trim()) {
                    country.officialName = nextOfficialName.trim();
                }
                if (country.name !== previousName || country.officialName !== previousOfficialName) {
                    changes.push({
                        countryId: targetId,
                        previousName,
                        name: country.name,
                        previousOfficialName,
                        officialName: country.officialName
                    });
                }
            }
        }

        this.appliedEvents.add(event.id);
        const historyRecord = {
            id: event.id,
            date: event.date,
            type: event.type,
            status: event.status,
            description: event.description,
            appliedAt: new Date().toISOString(),
            changes
        };

        if (!Array.isArray(this.state.events.triggeredEvents)) {
            this.state.events.triggeredEvents = [];
        }
        this.state.events.triggeredEvents.push(event.id);
        if (!Array.isArray(this.state.events.eventHistory)) {
            this.state.events.eventHistory = [];
        }
        this.state.events.eventHistory.push(historyRecord);

        markGameStateDirty(this.state);
        this.eventBus?.emit?.(GAME_EVENTS.HISTORICAL_EVENT, {
            event,
            historyRecord,
            appliedCountryChanges: changes
        });
        this.eventBus?.emit?.(GAME_EVENTS.WORLD_UPDATED, {
            reason: "historical_country_event",
            eventId: event.id
        });

        return { applied: true, event, changes };
    }

    applyDueEvents(date, options = {}) {
        this.#ensureActive();
        const dueEvents = this.getDueEvents(date, options);
        const results = [];

        for (const event of dueEvents) {
            const result = this.applyEvent(event.id, options);
            results.push({ eventId: event.id, result });
        }

        return results;
    }

    getSnapshot() {
        this.#ensureActive();
        const applied = this.events.filter(event => this.appliedEvents.has(event.id)).length;
        return {
            totalEvents: this.events.length,
            appliedEvents: applied,
            pendingEvents: this.events.length - applied,
            disputedEvents: this.events.filter(event => event.status === "disputed").length,
            dateRange: this.events.length
                ? { first: this.events[0].date, last: this.events[this.events.length - 1].date }
                : null
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.events = [];
        this.eventIndex.clear();
        this.appliedEvents.clear();
        this.state = null;
        this.eventBus = null;
        this.destroyed = true;
    }
}

export default CountryHistory;

console.log("WORLD AT WAR: Country History module loaded.");
