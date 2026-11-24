import { markGameStateDirty } from "../core/game-state.js";
import { gameEventBus } from "../core/event-bus.js";
import { equipmentCatalog } from "./equipment.js";

const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

export class EquipmentProductionManager {
    constructor(state, equipmentManager, factoryManager, resourceManager, eventBus = gameEventBus) {
        if (!state?.military || !equipmentManager || !factoryManager || !resourceManager) {
            throw new TypeError("EquipmentProductionManager requires military, equipment, factory and resource systems.");
        }
        this.state = state;
        this.equipmentManager = equipmentManager;
        this.factoryManager = factoryManager;
        this.resourceManager = resourceManager;
        this.eventBus = eventBus;
        this.lines = state.military.equipmentProductionLines ??= Object.create(null);
        this.destroyed = false;
    }

    #assertActive() {
        if (this.destroyed) throw new Error("EquipmentProductionManager has been destroyed.");
    }

    createLine({ id, countryId, factoryId, equipmentId, resourceInputs, unitsPerFactory = 1, efficiency = 1, status = "active" } = {}) {
        this.#assertActive();
        const key = String(id ?? "").trim();
        const owner = String(countryId ?? "").trim();
        if (!key || !owner || !this.state.world.countries[owner]) throw new TypeError("A valid production line and country ID are required.");
        if (this.lines[key]) throw new Error("Production line already exists: " + key);
        if (!equipmentCatalog.has(equipmentId)) throw new RangeError("Unknown equipment type: " + equipmentId);
        const factory = this.factoryManager.get(factoryId);
        if (!factory || factory.status !== "active" || factory.countryId !== owner || !["military", "naval"].includes(factory.type)) {
            throw new RangeError("Equipment production requires an active national military or naval factory.");
        }
        if (!["active", "paused"].includes(status)) throw new RangeError("Production status must be active or paused.");
        if (!Number.isSafeInteger(unitsPerFactory) || unitsPerFactory < 1) throw new RangeError("unitsPerFactory must be a positive integer.");
        if (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 2) throw new RangeError("Efficiency must be greater than zero and at most two.");
        if (!isRecord(resourceInputs) || !Object.keys(resourceInputs).length ||
            Object.values(resourceInputs).some(value => !Number.isFinite(value) || value <= 0)) {
            throw new TypeError("Production requires positive resource inputs per equipment unit.");
        }
        const line = {
            id: key,
            countryId: owner,
            factoryId: factory.id,
            equipmentId,
            resourceInputs: { ...resourceInputs },
            unitsPerFactory,
            efficiency,
            status,
            totalProduced: 0,
            lastOutput: 0,
            createdAt: this.state.clock?.date ?? null
        };
        this.lines[key] = line;
        markGameStateDirty(this.state);
        return { ...line, resourceInputs: { ...line.resourceInputs } };
    }

    processMonthly() {
        this.#assertActive();
        const reports = [];
        for (const line of Object.values(this.lines)) {
            if (line.status !== "active") continue;
            const factory = this.factoryManager.get(line.factoryId);
            if (!factory || factory.status !== "active") {
                reports.push({ lineId: line.id, success: false, reason: "factory_unavailable", produced: 0 });
                continue;
            }
            const quantity = Math.floor(factory.level * line.unitsPerFactory * line.efficiency);
            if (quantity < 1) {
                reports.push({ lineId: line.id, success: false, reason: "output_below_one_unit", produced: 0 });
                continue;
            }
            const required = Object.entries(line.resourceInputs)
                .map(([resource, perUnit]) => ({ resource, quantity: perUnit * quantity }));
            const stockpiles = this.resourceManager.getStockpiles(line.countryId);
            const shortage = required.find(item => (stockpiles[item.resource] ?? 0) + 1e-9 < item.quantity);
            if (shortage) {
                reports.push({
                    lineId: line.id,
                    success: false,
                    reason: "insufficient_resources",
                    resource: shortage.resource,
                    required: shortage.quantity,
                    available: stockpiles[shortage.resource] ?? 0,
                    produced: 0
                });
                continue;
            }
            for (const item of required) {
                const consumed = this.resourceManager.consume(line.countryId, item.resource, item.quantity);
                if (!consumed.success) throw new Error("Resource stock changed during equipment production.");
            }
            this.equipmentManager.addStock(line.countryId, line.equipmentId, quantity, { source: "production" });
            line.totalProduced += quantity;
            line.lastOutput = quantity;
            reports.push({
                lineId: line.id,
                success: true,
                countryId: line.countryId,
                equipmentId: line.equipmentId,
                produced: quantity,
                totalProduced: line.totalProduced,
                consumed: required
            });
        }
        markGameStateDirty(this.state);
        return reports;
    }

    setStatus(id, status) {
        this.#assertActive();
        if (!["active", "paused"].includes(status)) throw new RangeError("Production status must be active or paused.");
        const line = this.lines[String(id)];
        if (!line) throw new RangeError("Unknown equipment production line.");
        line.status = status;
        markGameStateDirty(this.state);
        return { ...line, resourceInputs: { ...line.resourceInputs } };
    }

    list({ countryId = null, status = null, factoryId = null } = {}) {
        this.#assertActive();
        return Object.values(this.lines)
            .filter(line => (!countryId || line.countryId === countryId)
                && (!status || line.status === status)
                && (!factoryId || line.factoryId === factoryId))
            .map(line => ({ ...line, resourceInputs: { ...line.resourceInputs } }));
    }

    destroy() {
        this.destroyed = true;
        this.state = null;
        this.equipmentManager = null;
        this.factoryManager = null;
        this.resourceManager = null;
        this.eventBus = null;
        this.lines = null;
    }
}

export default EquipmentProductionManager;