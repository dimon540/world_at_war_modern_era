import { EventManager } from "./event-manager.js";
import { markGameStateDirty } from "../core/game-state.js";

export class HistoricalEventManager {
    constructor(state, eventBus, options = {}) {
        this.state = state;
        this.events = new EventManager(state, eventBus);
        this.definitions = options.definitions ?? [];
        this.loaded = false;
        this.destroyed = false;
    }

    load(definitions = this.definitions) {
        if (this.destroyed) throw new Error("HistoricalEventManager destroyed.");
        if (!Array.isArray(definitions)) throw new TypeError("Historical event definitions must be an array.");
        let count = 0;
        for (const item of definitions) {
            if (!item?.id || !item.date) continue;
            if (this.state.events.historicalEvents[item.id]) continue;
            const definition = { ...item, historical: true, verificationStatus: item.verificationStatus ?? item.status ?? "unverified" };
            this.state.events.historicalEvents[item.id] = definition;
            this.events.schedule(definition);
            count += 1;
        }
        this.loaded = true;
        return count;
    }

    #registerCountry(record, defaultStatus = "sovereign_state") {
        if (!record || typeof record.id !== "string" || !record.id.trim()) return null;
        const id = record.id.trim();
        const existing = this.state.world.countries[id];
        if (existing) return existing;
        const country = {
            ...record,
            id,
            status: record.status ?? defaultStatus,
            historicalCreatedAt: this.state.clock?.date ? { ...this.state.clock.date } : null
        };
        this.state.world.countries[id] = country;
        return country;
    }

    #applyVerifiedChange(event) {
        const changes = event.changes ?? {};
        let changed = false;

        const verificationStatus = event.verificationStatus ?? "unverified";
        if (verificationStatus === "verified") {
            const created = this.#registerCountry(changes.createdCountryData);
            const successor = this.#registerCountry(changes.successorCountryData);
            if (created) {
                created.status = "independent";
                created.activeFrom = event.date;
                changed = true;
            }
            if (successor) {
                successor.status = "independent";
                successor.activeFrom = event.date;
                changed = true;
            }

            const targetId = changes.entity ?? changes.createdCountry ?? event.countries?.[0];
            const country = targetId ? this.state.world.countries[targetId] : null;
            if (country) {
                const nextName = changes.newName ?? changes.newCountryName;
                if (nextName) {
                    country.name = nextName;
                    changed = true;
                }
                if (changes.newOfficialName) {
                    country.officialName = changes.newOfficialName;
                    changed = true;
                }
                if (changes.internationalStatus) {
                    country.internationalStatus = changes.internationalStatus;
                    changed = true;
                }
                if (changes.unMembership !== undefined) {
                    country.unMember = Boolean(changes.unMembership);
                    changed = true;
                }
                if (changes.createdCountry) {
                    country.status = "independent";
                    country.activeFrom = event.date;
                    changed = true;
                }
            }
        } else if (verificationStatus === "disputed" && changes.entityData) {
            const entity = this.#registerCountry(changes.entityData, "disputed_entity");
            if (entity) {
                entity.status = "disputed_entity";
                entity.activeFrom = event.date;
                entity.internationalStatus = "disputed";
                changed = true;
            }
        }

        if (changed) {
            this.state.world.statistics.totalCountries = Object.keys(this.state.world.countries).length;
            markGameStateDirty(this.state);
        }
    }

    processDaily(date) {
        if (this.destroyed) throw new Error("HistoricalEventManager destroyed.");
        const fired = this.events.processDaily(date).filter(event => event.historical);
        for (const event of fired) this.#applyVerifiedChange(event);
        return fired;
    }

    destroy() {
        if (this.destroyed) return;
        this.events.destroy();
        this.state = null;
        this.destroyed = true;
    }
}

export default HistoricalEventManager;