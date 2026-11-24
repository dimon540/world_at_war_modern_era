/* =========================================================
   WORLD AT WAR: MODERN ERA
   COUNTRY POLITICS
   Version: 1.0.0

   Country governments, parties, ideology, stability,
   elections and political transitions.
========================================================= */

import { markGameStateDirty } from "../core/game-state.js";
import { GAME_EVENTS, gameEventBus } from "../core/event-bus.js";

const GOVERNMENT_TYPES = new Set([
    "democracy", "republic", "constitutional_monarchy", "absolute_monarchy",
    "one_party_state", "military_junta", "authoritarian", "theocracy",
    "transitional", "other"
]);

const IDEOLOGIES = new Set([
    "liberalism", "conservatism", "social_democracy", "socialism",
    "communism", "nationalism", "fascism", "monarchism",
    "islamism", "green_politics", "non_aligned", "other"
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

function requireId(value, label) {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
}

function normalizeDate(value) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(`${value}T00:00:00.000Z`);
        if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return value;
    }
    if (isRecord(value) && Number.isInteger(value.year) &&
        Number.isInteger(value.month) && Number.isInteger(value.day)) {
        const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
        if (date.getUTCFullYear() === value.year &&
            date.getUTCMonth() === value.month - 1 &&
            date.getUTCDate() === value.day) return date.toISOString().slice(0, 10);
    }
    throw new TypeError("A valid date is required.");
}

function ensureRegistry(parent, key) {
    if (!isRecord(parent[key])) parent[key] = Object.create(null);
    return parent[key];
}

export class CountryPolitics {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state?.world?.countries || !state.politics) {
            throw new TypeError("CountryPolitics requires initialized country and politics state.");
        }
        this.state = state;
        this.eventBus = eventBus;
        this.options = { defaultStability: 50, ...options };
        this.governments = ensureRegistry(state.politics, "governments");
        this.parties = ensureRegistry(state.politics, "parties");
        this.ideologies = ensureRegistry(state.politics, "ideologies");
        this.elections = ensureRegistry(state.politics, "elections");
        this.movements = ensureRegistry(state.politics, "politicalMovements");
        this.destroyed = false;
    }

    #active() {
        if (this.destroyed) throw new Error("CountryPolitics has been destroyed.");
    }

    #country(countryId) {
        const id = requireId(countryId, "Country ID");
        const country = this.state.world.countries[id];
        if (!country) throw new RangeError(`Unknown country: ${id}`);
        return { id, country };
    }

    #changed(eventName, payload) {
        markGameStateDirty(this.state);
        this.eventBus?.emit?.(eventName, payload);
        this.eventBus?.emit?.(GAME_EVENTS.COUNTRY_UPDATED, {
            countryId: payload.countryId,
            reason: "politics_updated"
        });
    }

    getGovernment(countryId) {
        this.#active();
        const { id } = this.#country(countryId);
        return this.governments[id] ?? null;
    }

    setGovernment(countryId, details = {}, options = {}) {
        this.#active();
        const { id } = this.#country(countryId);
        if (!isRecord(details)) throw new TypeError("Government details must be an object.");
        const previous = this.governments[id] ?? null;
        const type = details.type ?? previous?.type ?? "other";
        if (!GOVERNMENT_TYPES.has(type)) throw new RangeError(`Unsupported government type: ${type}`);

        const ideology = details.ideology ?? previous?.ideology ?? "other";
        if (!IDEOLOGIES.has(ideology)) throw new RangeError(`Unsupported ideology: ${ideology}`);
        const stability = details.stability ?? previous?.stability ?? this.options.defaultStability;
        if (!Number.isFinite(stability)) throw new TypeError("Government stability must be numeric.");

        const government = {
            ...(previous ?? {}),
            ...details,
            countryId: id,
            type,
            ideology,
            headOfState: details.headOfState ?? previous?.headOfState ?? null,
            headOfGovernment: details.headOfGovernment ?? previous?.headOfGovernment ?? null,
            rulingPartyId: details.rulingPartyId ?? previous?.rulingPartyId ?? null,
            since: details.since ? normalizeDate(details.since) : previous?.since ?? null,
            stability: clamp(stability, 0, 100),
            updatedAt: new Date().toISOString()
        };
        this.governments[id] = government;
        this.#changed(GAME_EVENTS.GOVERNMENT_CHANGED, {
            countryId: id, previous, government, reason: options.reason ?? "government_updated"
        });
        return government;
    }

    setStability(countryId, value, options = {}) {
        this.#active();
        if (!Number.isFinite(value)) throw new TypeError("Stability must be a finite number.");
        const { id } = this.#country(countryId);
        const current = this.governments[id] ?? this.setGovernment(id, {});
        const previous = current.stability;
        current.stability = clamp(value, 0, 100);
        current.updatedAt = new Date().toISOString();
        this.#changed(GAME_EVENTS.COUNTRY_UPDATED, {
            countryId: id, reason: "stability_changed", previous, stability: current.stability,
            source: options.source ?? "system"
        });
        return current.stability;
    }

    addParty(countryId, party) {
        this.#active();
        const { id } = this.#country(countryId);
        if (!isRecord(party)) throw new TypeError("Party must be an object.");
        const partyId = requireId(party.id, "Party ID");
        const ideology = party.ideology ?? "other";
        if (!IDEOLOGIES.has(ideology)) throw new RangeError(`Unsupported party ideology: ${ideology}`);
        const countryParties = ensureRegistry(this.parties, id);
        if (countryParties[partyId]) throw new Error(`Party already exists: ${partyId}`);
        const record = {
            ...party,
            id: partyId,
            countryId: id,
            name: String(party.name ?? partyId),
            ideology,
            support: Number.isFinite(party.support) ? clamp(party.support, 0, 100) : 0,
            founded: party.founded ? normalizeDate(party.founded) : null
        };
        countryParties[partyId] = record;
        this.#changed(GAME_EVENTS.COUNTRY_UPDATED, {
            countryId: id, reason: "party_created", party: record
        });
        return record;
    }

    updateParty(countryId, partyId, changes = {}) {
        this.#active();
        const { id } = this.#country(countryId);
        const key = requireId(partyId, "Party ID");
        const party = this.parties[id]?.[key];
        if (!party) throw new RangeError(`Unknown party ${key} in country ${id}.`);
        if (!isRecord(changes)) throw new TypeError("Party changes must be an object.");
        if (changes.ideology && !IDEOLOGIES.has(changes.ideology)) {
            throw new RangeError(`Unsupported party ideology: ${changes.ideology}`);
        }
        Object.assign(party, changes);
        if (changes.support !== undefined) {
            if (!Number.isFinite(changes.support)) throw new TypeError("Party support must be numeric.");
            party.support = clamp(changes.support, 0, 100);
        }
        if (changes.founded) party.founded = normalizeDate(changes.founded);
        this.#changed(GAME_EVENTS.COUNTRY_UPDATED, {
            countryId: id, reason: "party_updated", party
        });
        return party;
    }

    removeParty(countryId, partyId) {
        this.#active();
        const { id } = this.#country(countryId);
        const key = requireId(partyId, "Party ID");
        const registry = this.parties[id];
        if (!registry?.[key]) return false;
        if (this.governments[id]?.rulingPartyId === key) {
            throw new Error("Cannot remove the currently ruling party.");
        }
        delete registry[key];
        this.#changed(GAME_EVENTS.COUNTRY_UPDATED, {
            countryId: id, reason: "party_removed", partyId: key
        });
        return true;
    }

    getParties(countryId) {
        this.#active();
        const { id } = this.#country(countryId);
        return Object.values(this.parties[id] ?? {});
    }

    setIdeology(countryId, ideology, options = {}) {
        this.#active();
        if (!IDEOLOGIES.has(ideology)) throw new RangeError(`Unsupported ideology: ${ideology}`);
        const { id } = this.#country(countryId);
        const previous = this.ideologies[id] ?? null;
        const record = {
            countryId: id,
            ideology,
            since: options.since ? normalizeDate(options.since) : null,
            source: options.source ?? "system",
            updatedAt: new Date().toISOString()
        };
        this.ideologies[id] = record;
        if (this.governments[id]) this.governments[id].ideology = ideology;
        this.#changed(GAME_EVENTS.COUNTRY_UPDATED, {
            countryId: id, reason: "ideology_changed", previous, ideology: record
        });
        return record;
    }

    scheduleElection(countryId, election) {
        this.#active();
        const { id } = this.#country(countryId);
        if (!isRecord(election)) throw new TypeError("Election must be an object.");
        const electionId = requireId(election.id, "Election ID");
        const date = normalizeDate(election.date);
        const registry = ensureRegistry(this.elections, id);
        if (registry[electionId]) throw new Error(`Election already exists: ${electionId}`);
        const record = {
            ...election,
            id: electionId,
            countryId: id,
            date,
            status: election.status ?? "scheduled",
            results: null
        };
        registry[electionId] = record;
        this.eventBus?.emit?.(GAME_EVENTS.ELECTION_STARTED, {
            countryId: id, election: record, scheduled: true
        });
        markGameStateDirty(this.state);
        return record;
    }

    resolveElection(countryId, electionId, results = {}) {
        this.#active();
        const { id } = this.#country(countryId);
        const key = requireId(electionId, "Election ID");
        const election = this.elections[id]?.[key];
        if (!election) throw new RangeError(`Unknown election: ${key}`);
        if (election.status === "completed") return false;
        if (!isRecord(results)) throw new TypeError("Election results must be an object.");

        const normalizedResults = {};
        let total = 0;
        for (const [partyId, votes] of Object.entries(results.partyVotes ?? {})) {
            if (!this.parties[id]?.[partyId]) throw new RangeError(`Unknown election party: ${partyId}`);
            if (!Number.isFinite(votes) || votes < 0) throw new TypeError("Party votes must be non-negative numbers.");
            normalizedResults[partyId] = votes;
            total += votes;
        }
        if (total <= 0) throw new RangeError("Election results must contain positive votes.");
        const winnerId = Object.entries(normalizedResults).sort((a, b) => b[1] - a[1])[0][0];
        const previousGovernment = this.governments[id] ?? null;
        election.status = "completed";
        election.results = {
            partyVotes: normalizedResults,
            totalVotes: total,
            winnerId,
            resolvedAt: new Date().toISOString()
        };
        if (election.formGovernment !== false) {
            const party = this.parties[id][winnerId];
            this.setGovernment(id, {
                ...(previousGovernment ?? {}),
                rulingPartyId: winnerId,
                ideology: party.ideology,
                type: election.governmentType ?? previousGovernment?.type ?? "democracy"
            }, { reason: "election_result" });
        }
        this.eventBus?.emit?.(GAME_EVENTS.ELECTION_ENDED, {
            countryId: id, election, previousGovernment, winnerId
        });
        markGameStateDirty(this.state);
        return election.results;
    }

    changeGovernment(countryId, details, options = {}) {
        this.#active();
        const { id } = this.#country(countryId);
        const previous = this.governments[id] ?? null;
        const government = this.setGovernment(id, details, {
            reason: options.reason ?? "political_transition"
        });
        if (options.coup === true) {
            this.eventBus?.emit?.(GAME_EVENTS.COUP_OCCURRED, {
                countryId: id, previousGovernment: previous, government
            });
        } else if (options.revolution === true) {
            this.eventBus?.emit?.(GAME_EVENTS.REVOLUTION_STARTED, {
                countryId: id, previousGovernment: previous, government
            });
        }
        return government;
    }

    getCountryPolitics(countryId) {
        this.#active();
        const { id } = this.#country(countryId);
        return {
            countryId: id,
            government: this.governments[id] ?? null,
            ideology: this.ideologies[id] ?? null,
            parties: this.getParties(id),
            elections: Object.values(this.elections[id] ?? {}),
            movements: Object.values(this.movements[id] ?? {})
        };
    }

    getWorldStatistics() {
        this.#active();
        const governments = Object.values(this.governments);
        return {
            countriesWithGovernment: governments.length,
            democracies: governments.filter(item => item.type === "democracy").length,
            republics: governments.filter(item => item.type === "republic").length,
            monarchies: governments.filter(item =>
                item.type === "constitutional_monarchy" || item.type === "absolute_monarchy"
            ).length,
            authoritarianGovernments: governments.filter(item =>
                ["one_party_state", "military_junta", "authoritarian"].includes(item.type)
            ).length,
            averageStability: governments.length
                ? governments.reduce((sum, item) => sum + item.stability, 0) / governments.length
                : null
        };
    }

    getSnapshot() {
        this.#active();
        return {
            countriesWithGovernment: Object.keys(this.governments).length,
            countriesWithParties: Object.keys(this.parties).length,
            totalParties: Object.values(this.parties).reduce((sum, items) => sum + Object.keys(items).length, 0),
            scheduledElections: Object.values(this.elections).reduce((sum, items) =>
                sum + Object.values(items).filter(item => item.status === "scheduled").length, 0)
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.state = null;
        this.eventBus = null;
        this.governments = null;
        this.parties = null;
        this.ideologies = null;
        this.elections = null;
        this.movements = null;
        this.destroyed = true;
    }
}

export default CountryPolitics;

console.log("WORLD AT WAR: Country Politics module loaded.");
