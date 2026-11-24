/* =========================================================
   WORLD AT WAR: MODERN ERA
   COUNTRY SELECTION
   Version: 1.0.0

   Country browser, filtering, search and campaign selection.
   This module does not modify historical country definitions.
========================================================= */

import {
    COUNTRY_STATUS,
    selectPlayerCountry,
    markGameStateDirty
} from "../core/game-state.js";
import {
    GAME_EVENTS,
    gameEventBus
} from "../core/event-bus.js";

function normalizeText(value) {
    return String(value ?? "").trim().toLocaleLowerCase();
}

function isCountryRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareCountries(a, b) {
    return String(a.name ?? a.officialName ?? a.id ?? "")
        .localeCompare(
            String(b.name ?? b.officialName ?? b.id ?? ""),
            undefined,
            { sensitivity: "base" }
        );
}

export class CountrySelection {
    constructor(state, countryManager = null, eventBus = gameEventBus, options = {}) {
        if (!state?.world || !state.world.countries || !state.player || !state.map) {
            throw new TypeError("CountrySelection requires a fully initialized game state.");
        }

        this.state = state;
        this.countryManager = countryManager;
        this.eventBus = eventBus;
        this.options = {
            allowAnnexed: false,
            defaultSort: "name",
            ...options
        };
        this.filters = {
            query: "",
            region: null,
            status: null,
            includeAnnexed: this.options.allowAnnexed
        };
        this.destroyed = false;
    }

    #ensureActive() {
        if (this.destroyed) {
            throw new Error("CountrySelection has been destroyed.");
        }
    }

    #allCountries() {
        const registry = this.state.world.countries;
        return Object.values(registry).filter(country =>
            isCountryRecord(country) && typeof country.id === "string"
        );
    }

    #isSelectable(country) {
        if (!country) return false;
        if (!this.filters.includeAnnexed &&
            country.gameStatus === COUNTRY_STATUS.ANNEXED) return false;
        return true;
    }

    getCountries(options = {}) {
        this.#ensureActive();

        const query = normalizeText(options.query ?? this.filters.query);
        const region = options.region ?? this.filters.region;
        const status = options.status ?? this.filters.status;
        const includeAnnexed = options.includeAnnexed ?? this.filters.includeAnnexed;
        const sort = options.sort ?? this.options.defaultSort;

        let countries = this.#allCountries().filter(country => {
            if (!includeAnnexed && country.gameStatus === COUNTRY_STATUS.ANNEXED) {
                return false;
            }
            if (region && country.region !== region) return false;
            if (status && country.gameStatus !== status) return false;

            if (query) {
                const searchable = [
                    country.id,
                    country.name,
                    country.officialName,
                    country.capital,
                    country.iso2,
                    country.iso3,
                    country.tag,
                    country.region
                ].filter(Boolean).join(" ").toLocaleLowerCase();

                if (!searchable.includes(query)) return false;
            }
            return true;
        });

        if (sort === "name") {
            countries.sort(compareCountries);
        } else if (sort === "region") {
            countries.sort((a, b) =>
                String(a.region ?? "").localeCompare(String(b.region ?? "")) ||
                compareCountries(a, b)
            );
        } else if (sort === "id") {
            countries.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        } else if (sort !== "source") {
            throw new RangeError(`Unsupported country sort mode: ${sort}`);
        }

        return countries;
    }

    search(query, options = {}) {
        this.#ensureActive();
        return this.getCountries({ ...options, query });
    }

    setFilters(filters = {}) {
        this.#ensureActive();
        if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
            throw new TypeError("Country filters must be an object.");
        }

        if (Object.hasOwn(filters, "query")) {
            this.filters.query = String(filters.query ?? "").trim();
        }
        if (Object.hasOwn(filters, "region")) {
            this.filters.region = filters.region || null;
        }
        if (Object.hasOwn(filters, "status")) {
            this.filters.status = filters.status || null;
        }
        if (Object.hasOwn(filters, "includeAnnexed")) {
            this.filters.includeAnnexed = Boolean(filters.includeAnnexed);
        }

        return this.getCountries();
    }

    resetFilters() {
        this.#ensureActive();
        this.filters = {
            query: "",
            region: null,
            status: null,
            includeAnnexed: this.options.allowAnnexed
        };
        return this.getCountries();
    }

    getRegions() {
        this.#ensureActive();
        return [...new Set(
            this.#allCountries().map(country => country.region).filter(Boolean)
        )].sort((a, b) => a.localeCompare(b));
    }

    getSelectedCountry() {
        this.#ensureActive();
        const id = this.state.player.countryId;
        if (!id) return null;
        return this.state.world.countries[id] ?? null;
    }

    selectCountry(countryId) {
        this.#ensureActive();

        const id = String(countryId ?? "").trim();
        if (!id) throw new TypeError("A country ID is required.");

        const country = this.state.world.countries[id];
        if (!country) {
            throw new RangeError(`Country does not exist in the loaded world: ${id}`);
        }
        if (!this.#isSelectable(country)) {
            throw new Error(`Country is not available for selection: ${country.name}`);
        }

        const previousCountryId = this.state.player.countryId ?? null;
        let selected;

        if (this.countryManager &&
            typeof this.countryManager.selectCountry === "function") {
            selected = this.countryManager.selectCountry(id);
        } else {
            selected = selectPlayerCountry(this.state, id);
            if (selected) {
                markGameStateDirty(this.state);
                this.eventBus?.emit?.(GAME_EVENTS.COUNTRY_SELECTED, {
                    countryId: id,
                    country,
                    previousCountryId,
                    source: "country_selection"
                });
            }
        }

        return Boolean(selected);
    }

    clearSelection() {
        this.#ensureActive();
        const previousCountryId = this.state.player.countryId ?? null;
        if (!previousCountryId) return false;

        this.state.player.countryId = null;
        this.state.player.isCountrySelected = false;
        this.state.map.selectedCountryId = null;
        markGameStateDirty(this.state);

        return true;
    }

    getSnapshot() {
        this.#ensureActive();
        const countries = this.#allCountries();
        const selected = this.getSelectedCountry();

        return {
            totalCountries: countries.length,
            selectableCountries: countries.filter(country =>
                country.gameStatus !== COUNTRY_STATUS.ANNEXED
            ).length,
            selectedCountryId: selected?.id ?? null,
            selectedCountryName: selected?.name ?? null,
            regions: this.getRegions(),
            filters: { ...this.filters }
        };
    }

    destroy() {
        if (this.destroyed) return;
        this.state = null;
        this.countryManager = null;
        this.eventBus = null;
        this.destroyed = true;
    }
}

export default CountrySelection;

console.log("WORLD AT WAR: Country Selection module loaded.");
