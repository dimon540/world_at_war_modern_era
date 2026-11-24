/* WORLD AT WAR: logistics and supply networks.
   Province coverage and stockpiles are explicit scenario/game data. */
import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";

const STATUS = Object.freeze({ ACTIVE: "active", INACTIVE: "inactive" });
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
function idOf(value, label) {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
}
function nonNegative(value, label) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a non-negative finite number.`);
    return value;
}
function cloneNetwork(network) {
    return { ...network, provinceIds: [...network.provinceIds], divisionIds: [...network.divisionIds],
        stockpiles: { ...network.stockpiles }, history: network.history.map(item => ({ ...item,
            date: item.date ? { ...item.date } : null, details: { ...item.details } })) };
}

export class SupplyManager {
    constructor(state, divisionManager, eventBus = gameEventBus, options = {}) {
        if (!state?.military || !state?.world?.countries || !state?.world?.provinces) {
            throw new TypeError("SupplyManager requires military, country and province registries.");
        }
        if (!divisionManager || !["getDivision", "setOrganization", "setMorale"]
            .every(method => typeof divisionManager[method] === "function")) {
            throw new TypeError("SupplyManager requires a compatible DivisionManager.");
        }
        if (!isRecord(state.military.supplyNetworks)) state.military.supplyNetworks = Object.create(null);
        this.state = state;
        this.divisionManager = divisionManager;
        this.eventBus = eventBus;
        this.dailyRecovery = Number.isFinite(options.dailyRecovery) ? Math.max(0, Math.min(0.05, options.dailyRecovery)) : 0.01;
        this.dailyAttrition = Number.isFinite(options.dailyAttrition) ? Math.max(0, Math.min(0.1, options.dailyAttrition)) : 0.025;
        this.destroyed = false;
    }
    #assertActive() {
        if (this.destroyed) throw new Error("SupplyManager has been destroyed.");
    }
    #country(value) {
        const id = idOf(value, "Country ID");
        if (!this.state.world.countries[id]) throw new RangeError(`Unknown country: ${id}`);
        return id;
    }
    #network(value) {
        const id = idOf(value, "Supply network ID");
        const network = this.state.military.supplyNetworks[id];
        if (!network) throw new RangeError(`Unknown supply network: ${id}`);
        return network;
    }
    #record(network, action, details = {}) {
        network.updatedAt = Date.now();
        network.history.push({ action, date: this.state.clock?.date ? { ...this.state.clock.date } : null, details: { ...details } });
        if (network.history.length > 100) network.history.splice(0, network.history.length - 100);
    }
    #emit(type, payload) {
        if (this.eventBus?.emit) this.eventBus.emit(GAME_EVENTS.WORLD_UPDATED, { type, ...payload });
    }
    createNetwork({ countryId, name, provinceIds, stockpiles = {}, dailyThroughput = 1000, id = null } = {}) {
        this.#assertActive();
        const owner = this.#country(countryId);
        const title = String(name ?? "").trim();
        if (!title) throw new TypeError("Supply network name is required.");
        if (!Array.isArray(provinceIds) || !provinceIds.length) throw new TypeError("Supply network requires at least one province.");
        if (!isRecord(stockpiles)) throw new TypeError("Supply stockpiles must be an object.");
        const provinces = [...new Set(provinceIds.map((value, index) => {
            const province = idOf(value, `Supply province ${index + 1}`);
            if (!this.state.world.provinces[province]) throw new RangeError(`Unknown province: ${province}`);
            return province;
        }))];
        const stocks = {
            supplies: nonNegative(stockpiles.supplies ?? 0, "Supply stockpile"),
            fuel: nonNegative(stockpiles.fuel ?? 0, "Fuel stockpile")
        };
        const throughput = nonNegative(dailyThroughput, "Daily supply throughput");
        const networkId = id ? idOf(id, "Supply network ID")
            : `supply_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        if (this.state.military.supplyNetworks[networkId]) throw new Error(`Supply network ID already exists: ${networkId}`);
        const now = Date.now();
        const network = {
            id: networkId, name: title, countryId: owner, status: STATUS.ACTIVE,
            provinceIds: provinces, divisionIds: [], stockpiles: stocks, dailyThroughput: throughput,
            lastProcessedAt: null, createdAt: now, updatedAt: now,
            history: [{ action: "created", date: this.state.clock?.date ? { ...this.state.clock.date } : null, details: {} }]
        };
        this.state.military.supplyNetworks[networkId] = network;
        this.#emit("supply_network_created", { network: cloneNetwork(network) });
        return { success: true, network: cloneNetwork(network) };
    }
    getNetwork(networkId) {
        this.#assertActive();
        return cloneNetwork(this.#network(networkId));
    }
    getNetworksForCountry(countryId) {
        this.#assertActive();
        const owner = this.#country(countryId);
        return Object.values(this.state.military.supplyNetworks)
            .filter(network => network.countryId === owner).map(cloneNetwork);
    }
    assignDivision(networkId, divisionId) {
        this.#assertActive();
        const network = this.#network(networkId);
        const id = idOf(divisionId, "Division ID");
        const division = this.divisionManager.getDivision(id);
        if (division.countryId !== network.countryId) throw new Error("Division and supply network must belong to the same country.");
        if (["disbanded", "destroyed"].includes(division.status)) throw new Error("Inactive divisions cannot be supplied.");
        if (division.location?.provinceId && !network.provinceIds.includes(division.location.provinceId)) {
            throw new Error("Division is outside the supply network's covered provinces.");
        }
        if (division.supplyNetworkId === network.id) return cloneNetwork(network);
        if (division.supplyNetworkId && this.state.military.supplyNetworks[division.supplyNetworkId]) {
            const previous = this.state.military.supplyNetworks[division.supplyNetworkId];
            previous.divisionIds = previous.divisionIds.filter(item => item !== id);
            this.#record(previous, "division_reassigned", { divisionId: id, toNetworkId: network.id });
        }
        if (!network.divisionIds.includes(id)) network.divisionIds.push(id);
        division.supplyNetworkId = network.id;
        this.#record(network, "division_assigned", { divisionId: id });
        this.#emit("supply_network_updated", { networkId: network.id, divisionId: id, countryId: network.countryId });
        return cloneNetwork(network);
    }
    removeDivision(networkId, divisionId) {
        this.#assertActive();
        const network = this.#network(networkId);
        const id = idOf(divisionId, "Division ID");
        network.divisionIds = network.divisionIds.filter(item => item !== id);
        const division = this.state.military.divisions?.[id];
        if (division?.supplyNetworkId === network.id) delete division.supplyNetworkId;
        this.#record(network, "division_removed", { divisionId: id });
        return cloneNetwork(network);
    }
    addStock(networkId, resource, amount) {
        this.#assertActive();
        if (!["supplies", "fuel"].includes(resource)) throw new RangeError("Supply resource must be supplies or fuel.");
        const quantity = nonNegative(amount, "Stockpile addition");
        const network = this.#network(networkId);
        network.stockpiles[resource] += quantity;
        this.#record(network, "stockpile_added", { resource, amount: quantity });
        this.#emit("supply_stockpile_changed", { networkId: network.id, resource, amount: quantity });
        return cloneNetwork(network);
    }
    setStatus(networkId, status) {
        this.#assertActive();
        if (!Object.values(STATUS).includes(status)) throw new RangeError(`Invalid supply network status: ${status}`);
        const network = this.#network(networkId);
        const previousStatus = network.status;
        network.status = status;
        this.#record(network, "status_changed", { previousStatus, status });
        this.#emit("supply_network_updated", { networkId: network.id, status });
        return cloneNetwork(network);
    }
    processDaily() {
        this.#assertActive();
        const reports = [];
        for (const network of Object.values(this.state.military.supplyNetworks)) {
            if (network.status !== STATUS.ACTIVE) continue;
            const divisions = network.divisionIds.map(id => this.state.military.divisions?.[id])
                .filter(d => d && !["disbanded", "destroyed"].includes(d.status));
            const eligible = divisions.filter(d => !d.location?.provinceId || network.provinceIds.includes(d.location.provinceId));
            const demands = eligible.map(division => ({
                division,
                supplies: Math.max(0, division.stats?.supplyUse ?? 0),
                fuel: Math.max(0, division.stats?.fuelUse ?? 0)
            }));
            const totalSupplies = demands.reduce((sum, item) => sum + item.supplies, 0);
            const totalFuel = demands.reduce((sum, item) => sum + item.fuel, 0);
            const totalDemand = totalSupplies + totalFuel;
            const throughputRatio = totalDemand > 0 ? Math.min(1, network.dailyThroughput / totalDemand) : 1;
            const suppliesRatio = totalSupplies > 0 ? Math.min(1, network.stockpiles.supplies / totalSupplies) : 1;
            const fuelRatio = totalFuel > 0 ? Math.min(1, network.stockpiles.fuel / totalFuel) : 1;
            const deliveryRatio = Math.min(throughputRatio, suppliesRatio, fuelRatio);
            const deliveredSupplies = totalSupplies * deliveryRatio;
            const deliveredFuel = totalFuel * deliveryRatio;
            network.stockpiles.supplies -= deliveredSupplies;
            network.stockpiles.fuel -= deliveredFuel;
            for (const item of demands) {
                const level = deliveryRatio;
                item.division.supplyLevel = level;
                if (level < 0.5) {
                    this.divisionManager.setOrganization(item.division.id,
                        Math.max(0, (item.division.organization ?? 1) - this.dailyAttrition * (0.5 - level) * 2));
                    this.divisionManager.setMorale(item.division.id,
                        Math.max(0, (item.division.morale ?? 0.7) - this.dailyAttrition * (0.5 - level)));
                } else if (level >= 0.95) {
                    this.divisionManager.setOrganization(item.division.id,
                        Math.min(1, (item.division.organization ?? 1) + this.dailyRecovery));
                }
            }
            const report = {
                networkId: network.id, countryId: network.countryId,
                divisionsSupplied: demands.length, divisionsOutsideCoverage: divisions.length - eligible.length,
                supplyLevel: deliveryRatio, suppliesDelivered: deliveredSupplies, fuelDelivered: deliveredFuel,
                remainingSupplies: network.stockpiles.supplies, remainingFuel: network.stockpiles.fuel
            };
            network.lastProcessedAt = Date.now();
            this.#record(network, "daily_supply_processed", report);
            reports.push(report);
            this.#emit("supply_allocation_processed", report);
        }
        return reports;
    }
    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.state = null;
        this.divisionManager = null;
        this.eventBus = null;
    }
}
export { STATUS as SUPPLY_NETWORK_STATUS };
export default SupplyManager;
