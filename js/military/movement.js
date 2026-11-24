/* WORLD AT WAR: land division movement orders.
   Routes are explicit province sequences; no adjacency or travel-time data is invented. */
import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";

function requiredId(value, label) {
    const id = String(value ?? "").trim();
    if (!id) throw new TypeError(`${label} is required.`);
    return id;
}
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function cloneOrder(order) {
    return { ...order, route: [...order.route], options: { ...order.options } };
}

export class MovementManager {
    constructor(state, divisionManager, eventBus = gameEventBus, options = {}) {
        if (!state?.military || !state?.world?.provinces) throw new TypeError("MovementManager requires military and province registries.");
        if (!divisionManager || typeof divisionManager.moveDivision !== "function" || typeof divisionManager.getDivision !== "function") {
            throw new TypeError("MovementManager requires a compatible DivisionManager.");
        }
        this.state = state;
        this.divisionManager = divisionManager;
        this.eventBus = eventBus;
        this.defaultHoursPerProvince = Number.isFinite(options.hoursPerProvince) && options.hoursPerProvince > 0
            ? options.hoursPerProvince : 24;
        this.orders = new Map();
        this.destroyed = false;
    }
    #assertActive() {
        if (this.destroyed) throw new Error("MovementManager has been destroyed.");
    }
    #province(value) {
        const id = requiredId(value, "Province ID");
        if (!this.state.world.provinces[id]) throw new RangeError(`Unknown province: ${id}`);
        return id;
    }
    #emit(type, payload) {
        if (this.eventBus?.emit) this.eventBus.emit(GAME_EVENTS.WORLD_UPDATED, { type, ...payload });
    }
    issueMoveOrder(divisionId, route, options = {}) {
        this.#assertActive();
        const id = requiredId(divisionId, "Division ID");
        if (!Array.isArray(route) || route.length < 1) throw new TypeError("Movement route must contain at least one province ID.");
        if (!isRecord(options)) throw new TypeError("Movement options must be an object.");
        const division = this.divisionManager.getDivision(id);
        if (["disbanded", "destroyed"].includes(division.status)) throw new Error("Inactive divisions cannot receive movement orders.");
        const normalizedRoute = route.map((value, index) => this.#province(requiredId(value, `Route province ${index + 1}`)));
        const currentProvinceId = division.location?.provinceId ?? null;
        if (currentProvinceId && normalizedRoute[0] !== currentProvinceId) normalizedRoute.unshift(currentProvinceId);
        for (let i = 1; i < normalizedRoute.length; i += 1) {
            if (normalizedRoute[i] === normalizedRoute[i - 1]) throw new Error("Movement route cannot contain consecutive duplicate provinces.");
        }
        const hoursPerProvince = options.hoursPerProvince ?? this.defaultHoursPerProvince;
        if (!Number.isFinite(hoursPerProvince) || hoursPerProvince <= 0) throw new RangeError("hoursPerProvince must be a positive finite number.");
        const initialIndex = currentProvinceId ? 0 : -1;
        const order = {
            id: `move_${id}_${Date.now().toString(36)}`,
            divisionId: id,
            countryId: division.countryId,
            route: normalizedRoute,
            currentIndex: initialIndex,
            hoursPerProvince,
            hoursRemaining: hoursPerProvince,
            status: normalizedRoute.length - 1 <= initialIndex ? "completed" : "active",
            issuedAt: Date.now(),
            options: { allowForeignTerritory: options.allowForeignTerritory === true, source: options.source ?? "manual" }
        };
        if (order.status === "active") this.orders.set(id, order);
        else this.orders.delete(id);
        this.#emit("movement_order_issued", { order: cloneOrder(order), divisionId: id, countryId: division.countryId });
        return cloneOrder(order);
    }
    advance(hours = 1) {
        this.#assertActive();
        if (!Number.isFinite(hours) || hours < 0) throw new RangeError("Movement time advance must be a non-negative finite number.");
        const results = [];
        for (const [divisionId, order] of this.orders) {
            let remainingHours = hours;
            const traversed = [];
            while (remainingHours > 0 && order.status === "active") {
                const used = Math.min(remainingHours, order.hoursRemaining);
                order.hoursRemaining -= used;
                remainingHours -= used;
                if (order.hoursRemaining > 1e-9) break;
                const nextIndex = order.currentIndex + 1;
                const nextProvinceId = order.route[nextIndex];
                if (!nextProvinceId) { order.status = "completed"; break; }
                const nextProvince = this.state.world.provinces[nextProvinceId];
                const ownerId = this.state.world.ownership?.provinceOwners?.[nextProvinceId]
                    ?? nextProvince?.ownerId
                    ?? nextProvince?.ownerCountryId
                    ?? null;
                if (ownerId && ownerId !== order.countryId && !order.options.allowForeignTerritory) {
                    order.status = "blocked";
                    order.blockedReason = "foreign_territory";
                    break;
                }
                this.divisionManager.moveDivision(divisionId, nextProvinceId);
                order.currentIndex = nextIndex;
                order.hoursRemaining = order.hoursPerProvince;
                traversed.push(nextProvinceId);
                if (order.currentIndex >= order.route.length - 1) order.status = "completed";
            }
            if (order.status !== "active") this.orders.delete(divisionId);
            const result = {
                divisionId, orderId: order.id, status: order.status,
                currentProvinceId: order.route[order.currentIndex] ?? null,
                traversed, blockedReason: order.blockedReason ?? null,
                hoursRemaining: order.hoursRemaining
            };
            results.push(result);
            if (traversed.length || order.status !== "active") this.#emit("movement_progress", { ...result, countryId: order.countryId });
        }
        return results;
    }
    cancelMoveOrder(divisionId) {
        this.#assertActive();
        const id = requiredId(divisionId, "Division ID");
        const order = this.orders.get(id);
        if (!order) return { success: false, reason: "no_active_order" };
        this.orders.delete(id);
        order.status = "cancelled";
        this.#emit("movement_order_cancelled", { divisionId: id, countryId: order.countryId, orderId: order.id });
        return { success: true, order: cloneOrder(order) };
    }
    getMoveOrder(divisionId) {
        this.#assertActive();
        const order = this.orders.get(requiredId(divisionId, "Division ID"));
        return order ? cloneOrder(order) : null;
    }
    getOrdersForCountry(countryId) {
        this.#assertActive();
        const id = requiredId(countryId, "Country ID");
        return [...this.orders.values()].filter(order => order.countryId === id).map(cloneOrder);
    }
    getActiveOrders() {
        this.#assertActive();
        return [...this.orders.values()].map(cloneOrder);
    }
    destroy() {
        if (this.destroyed) return;
        this.orders.clear();
        this.destroyed = true;
        this.state = null;
        this.divisionManager = null;
        this.eventBus = null;
    }
}
export default MovementManager;
