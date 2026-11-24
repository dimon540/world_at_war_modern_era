/* =========================================================
   WORLD AT WAR: MODERN ERA
   MILITARY EQUIPMENT CATALOGUE AND STOCKPILE MANAGER
   Equipment values are abstract balancing parameters, not
   claims about exact national inventories on 2000-01-01.
========================================================= */

import { gameEventBus, GAME_EVENTS } from "../core/event-bus.js";

export const EQUIPMENT_CATEGORIES = Object.freeze({
    SMALL_ARMS: "small_arms",
    INFANTRY: "infantry",
    VEHICLES: "vehicles",
    ARMORED: "armored",
    ARTILLERY: "artillery",
    AIRCRAFT: "aircraft",
    NAVAL: "naval",
    MISSILES: "missiles",
    SUPPORT: "support",
    ELECTRONICS: "electronics"
});

const DEFINITIONS = [
    // Infantry weapons and support
    ["small_arms", "Small Arms", "small_arms", "equipment", 1, 1, 1, 1, ["infantry"]],
    ["support_equipment", "General Support Equipment", "support", "equipment", 2, 2, 1, 1, ["support"]],
    ["airdrop_equipment", "Airborne Assault Equipment", "infantry", "equipment", 3, 3, 1, 1, ["airborne"]],
    ["mountain_equipment", "Mountain Warfare Equipment", "infantry", "equipment", 2, 2, 0.8, 1, ["mountain"]],
    ["amphibious_equipment", "Amphibious Assault Equipment", "support", "equipment", 3, 3, 1, 1, ["amphibious"]],
    ["precision_weapons", "Airborne Precision Weapons", "missiles", "consumable", 6, 7, 0.5, 1, ["precision"]],
    ["bombs", "Aerial Bombs", "support", "consumable", 2, 2, 0.8, 1, ["aircraft"]],
    ["infantry_support_weapons", "Infantry Support Weapons", "infantry", "equipment", 2, 2, 1.2, 1, ["infantry"]],
    ["man_portable_at", "Man-Portable Anti-Armor Weapons", "infantry", "equipment", 2, 2, 0.8, 1, ["infantry", "anti_armor"]],
    ["manpads", "Man-Portable Air-Defense Systems", "missiles", "equipment", 3, 3, 0.8, 1, ["infantry", "air_defense"]],
    ["engineering_equipment", "Engineering Equipment", "support", "equipment", 2, 2, 1.5, 1, ["engineering"]],
    ["communications_equipment", "Military Communications Equipment", "electronics", "equipment", 3, 2, 0.4, 1, ["communications"]],
    ["night_vision", "Night-Vision Equipment", "electronics", "equipment", 3, 2, 0.2, 1, ["sensors"]],
    ["sensors", "Surveillance and Sensor Systems", "electronics", "equipment", 4, 3, 0.5, 1, ["recon"]],
    ["medical_equipment", "Military Medical Equipment", "support", "equipment", 1, 1, 0.5, 1, ["medical"]],
    ["supply_equipment", "Field Supply Equipment", "support", "equipment", 1, 1, 1, 1, ["logistics"]],

    // Ground vehicles
    ["trucks", "Military Trucks", "vehicles", "vehicle", 3, 2, 5, 1, ["logistics", "motorized"]],
    ["recon_vehicles", "Reconnaissance Vehicles", "vehicles", "vehicle", 4, 3, 4, 1, ["recon"]],
    ["light_tanks", "Light Tanks", "armored", "vehicle", 5, 4, 8, 1, ["armor"]],
    ["main_battle_tanks", "Main Battle Tanks", "armored", "vehicle", 8, 7, 12, 1, ["armor", "breakthrough"]],
    ["ifv_apc", "Infantry Fighting Vehicles / APCs", "armored", "vehicle", 7, 5, 9, 1, ["mechanized"]],
    ["self_propelled_artillery", "Self-Propelled Artillery", "artillery", "vehicle", 7, 6, 10, 1, ["fire_support"]],
    ["self_propelled_aa", "Self-Propelled Air Defense", "vehicles", "vehicle", 7, 6, 8, 1, ["air_defense"]],

    // Artillery and ammunition
    ["field_artillery", "Towed Field Artillery", "artillery", "equipment", 4, 3, 5, 1, ["fire_support"]],
    ["rocket_artillery", "Multiple-Launch Rocket Systems", "artillery", "equipment", 6, 5, 6, 1, ["fire_support"]],
    ["anti_tank_weapons", "Anti-Tank Weapons", "artillery", "equipment", 3, 3, 2, 1, ["anti_armor"]],
    ["anti_air_guns", "Anti-Aircraft Guns", "artillery", "equipment", 4, 3, 4, 1, ["air_defense"]],
    ["ammunition", "Conventional Ammunition", "support", "consumable", 1, 1, 1, 1, ["consumable"]],
    ["precision_munitions", "Precision-Guided Munitions", "missiles", "consumable", 5, 6, 0.5, 1, ["precision"]],
    ["air_munitions", "Aircraft Munitions", "support", "consumable", 2, 2, 0.5, 1, ["aircraft"]],

    // Aircraft
    ["fighter_aircraft", "Fighter Aircraft", "aircraft", "vehicle", 10, 9, 8, 1, ["fighter"]],
    ["multirole_aircraft", "Multirole Combat Aircraft", "aircraft", "vehicle", 12, 11, 9, 1, ["fighter", "strike"]],
    ["interceptor_aircraft", "Interceptor Aircraft", "aircraft", "vehicle", 9, 8, 7, 1, ["air_defense"]],
    ["ground_attack_aircraft", "Ground-Attack Aircraft", "aircraft", "vehicle", 9, 8, 8, 1, ["close_air_support"]],
    ["bomber_aircraft", "Bomber Aircraft", "aircraft", "vehicle", 14, 13, 15, 1, ["strategic_strike"]],
    ["transport_aircraft", "Military Transport Aircraft", "aircraft", "vehicle", 9, 8, 12, 1, ["transport"]],
    ["recon_aircraft", "Reconnaissance Aircraft", "aircraft", "vehicle", 8, 8, 6, 1, ["recon"]],
    ["military_helicopters", "Military Helicopters", "aircraft", "vehicle", 8, 7, 6, 1, ["rotary_wing"]],

    // Naval vessels and weapons
    ["carrier_hull", "Aircraft Carrier", "naval", "ship", 40, 35, 80, 1, ["capital_ship", "carrier"]],
    ["cruiser_hull", "Cruiser", "naval", "ship", 25, 22, 35, 1, ["surface_combat"]],
    ["destroyer_hull", "Destroyer", "naval", "ship", 16, 14, 18, 1, ["escort"]],
    ["frigate_hull", "Frigate", "naval", "ship", 12, 10, 12, 1, ["escort"]],
    ["corvette_hull", "Corvette", "naval", "ship", 7, 6, 7, 1, ["patrol"]],
    ["submarine_hull", "Submarine", "naval", "ship", 15, 13, 10, 1, ["undersea"]],
    ["amphibious_ship", "Amphibious Assault Ship", "naval", "ship", 25, 22, 35, 1, ["amphibious"]],
    ["replenishment_ship", "Fleet Replenishment Vessel", "naval", "ship", 10, 9, 15, 1, ["logistics"]],
    ["naval_guns", "Naval Gun Systems", "naval", "equipment", 5, 4, 4, 1, ["naval_weapon"]],
    ["torpedoes", "Torpedoes", "naval", "consumable", 4, 4, 1, 1, ["naval_weapon"]],
    ["sonar", "Sonar Systems", "electronics", "equipment", 4, 3, 1, 1, ["anti_submarine"]],
    ["missiles", "Naval and Tactical Missiles", "missiles", "consumable", 6, 7, 1, 1, ["guided_weapon"]],
    ["surface_to_air_missiles", "Surface-to-Air Missile Systems", "missiles", "equipment", 8, 8, 4, 1, ["air_defense"]],
    ["landing_craft", "Landing Craft", "naval", "vehicle", 5, 4, 3, 1, ["amphibious"]],
    ["naval_air_wing", "Carrier-Based Aircraft Package", "aircraft", "equipment", 12, 10, 8, 1, ["carrier_air"]]
].map(([id, name, category, kind, industrialCost, resourceCost, weight, reliability, tags]) => ({
    id, name, category, kind, industrialCost, resourceCost, weight, reliability, tags
}));

function validateEquipment(definition) {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
        throw new TypeError("Equipment definition must be an object.");
    }
    if (!/^[a-z0-9_]+$/.test(String(definition.id ?? ""))) {
        throw new TypeError("Equipment ID must use lowercase letters, numbers and underscores.");
    }
    if (typeof definition.name !== "string" || !definition.name.trim()) {
        throw new TypeError("Equipment requires a non-empty name.");
    }
    if (!Object.values(EQUIPMENT_CATEGORIES).includes(definition.category)) {
        throw new RangeError(`Invalid equipment category: ${definition.category}`);
    }
    for (const field of ["industrialCost", "resourceCost", "weight", "reliability"]) {
        if (!Number.isFinite(definition[field]) || definition[field] < 0) {
            throw new TypeError(`Equipment ${definition.id} has invalid ${field}.`);
        }
    }
    if (!Array.isArray(definition.tags)) throw new TypeError("Equipment tags must be an array.");
    if (definition.reliability > 1) throw new RangeError("Equipment reliability must be between 0 and 1.");
}

function cloneItem(item) {
    return { ...item, tags: [...item.tags] };
}

export class EquipmentCatalog {
    constructor(definitions = DEFINITIONS) {
        if (!Array.isArray(definitions)) throw new TypeError("Equipment definitions must be an array.");
        this.items = new Map();
        this.destroyed = false;
        for (const item of definitions) this.register(item);
    }

    #assertActive() {
        if (this.destroyed) throw new Error("EquipmentCatalog has been destroyed.");
    }

    register(definition, { replace = false } = {}) {
        this.#assertActive();
        validateEquipment(definition);
        const id = definition.id.trim();
        if (this.items.has(id) && !replace) throw new Error(`Equipment already registered: ${id}`);
        const item = { ...definition, id, name: definition.name.trim(), tags: [...new Set(definition.tags.map(String))] };
        this.items.set(id, item);
        return cloneItem(item);
    }

    get(id) {
        this.#assertActive();
        const item = this.items.get(String(id ?? "").trim());
        return item ? cloneItem(item) : null;
    }

    has(id) {
        this.#assertActive();
        return this.items.has(String(id ?? "").trim());
    }

    list({ category = null, kind = null, tag = null } = {}) {
        this.#assertActive();
        return [...this.items.values()]
            .filter(item => !category || item.category === category)
            .filter(item => !kind || item.kind === kind)
            .filter(item => !tag || item.tags.includes(tag))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(cloneItem);
    }

    getStatistics() {
        this.#assertActive();
        const byCategory = {};
        for (const item of this.items.values()) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
        return { total: this.items.size, byCategory };
    }

    destroy() {
        this.items.clear();
        this.destroyed = true;
    }
}

export class EquipmentManager {
    constructor(state, eventBus = gameEventBus, options = {}) {
        if (!state || !state.military || typeof state.military !== "object") {
            throw new TypeError("EquipmentManager requires a valid game state with military data.");
        }
        if (!state.military.equipment || typeof state.military.equipment !== "object") {
            state.military.equipment = Object.create(null);
        }
        this.state = state;
        this.eventBus = eventBus;
        this.catalog = options.catalog ?? equipmentCatalog;
        this.destroyed = false;
    }

    #assertActive() {
        if (this.destroyed) throw new Error("EquipmentManager has been destroyed.");
    }

    #countryId(value) {
        const id = String(value ?? "").trim();
        if (!id) throw new TypeError("Country ID is required.");
        if (this.state.world?.countries && !this.state.world.countries[id]) {
            throw new RangeError(`Unknown country: ${id}`);
        }
        return id;
    }

    #ensureInventory(countryId) {
        const id = this.#countryId(countryId);
        if (!this.state.military.equipment[id]) {
            this.state.military.equipment[id] = Object.create(null);
        }
        return this.state.military.equipment[id];
    }

    getStock(countryId, equipmentId) {
        this.#assertActive();
        const id = this.#countryId(countryId);
        if (!this.catalog.has(equipmentId)) throw new RangeError(`Unknown equipment: ${equipmentId}`);
        const value = this.state.military.equipment[id]?.[equipmentId] ?? 0;
        return Number.isFinite(value) && value >= 0 ? value : 0;
    }

    setStock(countryId, equipmentId, quantity) {
        this.#assertActive();
        if (!this.catalog.has(equipmentId)) throw new RangeError(`Unknown equipment: ${equipmentId}`);
        if (!Number.isSafeInteger(quantity) || quantity < 0) {
            throw new RangeError("Equipment stock must be a non-negative safe integer.");
        }
        const inventory = this.#ensureInventory(countryId);
        inventory[equipmentId] = quantity;
        return quantity;
    }

    addStock(countryId, equipmentId, quantity, options = {}) {
        this.#assertActive();
        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
            throw new RangeError("Equipment addition must be a positive safe integer.");
        }
        const current = this.getStock(countryId, equipmentId);
        const next = current + quantity;
        if (!Number.isSafeInteger(next)) throw new RangeError("Equipment stock exceeds the safe integer range.");
        this.setStock(countryId, equipmentId, next);
        if (options.source === "production" && this.eventBus?.emit) {
            this.eventBus.emit(GAME_EVENTS.EQUIPMENT_PRODUCED, {
                countryId, equipmentId, quantity, total: next
            });
        }
        return next;
    }

    consumeStock(countryId, equipmentId, quantity) {
        this.#assertActive();
        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
            throw new RangeError("Equipment consumption must be a positive safe integer.");
        }
        const current = this.getStock(countryId, equipmentId);
        if (current < quantity) return { success: false, requested: quantity, available: current, consumed: 0 };
        const remaining = current - quantity;
        this.setStock(countryId, equipmentId, remaining);
        return { success: true, requested: quantity, available: current, consumed: quantity, remaining };
    }

    transferStock(fromCountryId, toCountryId, equipmentId, quantity) {
        this.#assertActive();
        const fromId = this.#countryId(fromCountryId);
        const toId = this.#countryId(toCountryId);
        if (fromId === toId) throw new RangeError("Source and destination countries must differ.");
        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
            throw new RangeError("Transfer quantity must be a positive safe integer.");
        }
        const available = this.getStock(fromId, equipmentId);
        if (available < quantity) {
            return { success: false, transferred: 0, available, requested: quantity };
        }
        const destinationStock = this.getStock(toId, equipmentId);
        if (!Number.isSafeInteger(destinationStock + quantity)) throw new RangeError("Destination stock exceeds the safe integer range.");
        this.setStock(fromId, equipmentId, available - quantity);
        this.setStock(toId, equipmentId, destinationStock + quantity);
        return { success: true, transferred: quantity, from: fromId, to: toId, remaining: available - quantity };
    }

    getCountryInventory(countryId, { includeZero = false } = {}) {
        this.#assertActive();
        const id = this.#countryId(countryId);
        const inventory = this.state.military.equipment[id] ?? {};
        return Object.entries(inventory)
            .filter(([equipmentId, quantity]) => this.catalog.has(equipmentId) && Number.isSafeInteger(quantity) && quantity >= 0)
            .filter(([, quantity]) => includeZero || quantity > 0)
            .map(([equipmentId, quantity]) => ({
                equipment: this.catalog.get(equipmentId),
                quantity
            }))
            .sort((a, b) => a.equipment.name.localeCompare(b.equipment.name));
    }

    getWorldStatistics() {
        this.#assertActive();
        const countries = Object.keys(this.state.military.equipment);
        let distinctStockTypes = 0;
        let totalItems = 0;
        const byEquipment = {};
        for (const countryId of countries) {
            for (const [equipmentId, quantity] of Object.entries(this.state.military.equipment[countryId] ?? {})) {
                if (!this.catalog.has(equipmentId) || !Number.isSafeInteger(quantity) || quantity < 0) continue;
                if (quantity > 0) distinctStockTypes++;
                totalItems += quantity;
                byEquipment[equipmentId] = (byEquipment[equipmentId] ?? 0) + quantity;
            }
        }
        return { countriesTracked: countries.length, distinctCountryEquipmentEntries: distinctStockTypes, totalItems, byEquipment };
    }

    destroy() {
        this.destroyed = true;
        this.state = null;
        this.eventBus = null;
    }
}

export const equipmentCatalog = new EquipmentCatalog();
export function getEquipment(equipmentId) {
    return equipmentCatalog.get(equipmentId);
}

export function getEquipmentTypes(options = {}) {
    return equipmentCatalog.list(options);
}

export default equipmentCatalog;

console.log("WORLD AT WAR: Equipment module loaded.");
