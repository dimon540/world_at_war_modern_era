/* =========================================================
   WORLD AT WAR: MODERN ERA
   MILITARY UNIT TYPES
   Version: 1.0.0

   Canonical catalogue of land, air, naval and support unit
   archetypes. These are templates, not country inventories:
   historical quantities and equipment are supplied separately.
========================================================= */

export const UNIT_CATEGORIES = Object.freeze({
    LAND: "land",
    AIR: "air",
    NAVAL: "naval",
    SUPPORT: "support"
});

export const UNIT_ROLES = Object.freeze({
    COMBAT: "combat",
    RECON: "recon",
    LOGISTICS: "logistics",
    ENGINEERING: "engineering",
    AIR_DEFENSE: "air_defense",
    TRANSPORT: "transport",
    COMMAND: "command"
});

const TYPE_DEFINITIONS = [
    // Land formations
    { id: "infantry", name: "Infantry", category: "land", role: "combat", domain: "land", manpower: 1000, speed: 4, attack: 5, defense: 8, breakthrough: 2, armor: 0, piercing: 3, airAttack: 0, supplyUse: 1, fuelUse: 0, equipment: ["small_arms", "support_equipment"], tags: ["line", "general_purpose"] },
    { id: "motorized_infantry", name: "Motorized Infantry", category: "land", role: "combat", domain: "land", manpower: 1000, speed: 8, attack: 6, defense: 7, breakthrough: 3, armor: 0, piercing: 4, airAttack: 0, supplyUse: 1.2, fuelUse: 1.5, equipment: ["small_arms", "trucks", "support_equipment"], tags: ["mobile", "line"] },
    { id: "mechanized_infantry", name: "Mechanized Infantry", category: "land", role: "combat", domain: "land", manpower: 900, speed: 7, attack: 8, defense: 9, breakthrough: 6, armor: 5, piercing: 7, airAttack: 0, supplyUse: 1.5, fuelUse: 2, equipment: ["small_arms", "ifv_apc", "support_equipment"], tags: ["mobile", "armored"] },
    { id: "armored", name: "Armored Formation", category: "land", role: "combat", domain: "land", manpower: 700, speed: 8, attack: 10, defense: 7, breakthrough: 10, armor: 9, piercing: 10, airAttack: 0, supplyUse: 1.8, fuelUse: 3, equipment: ["main_battle_tanks", "support_equipment"], tags: ["mobile", "armored", "breakthrough"] },
    { id: "light_armored", name: "Light Armored Formation", category: "land", role: "combat", domain: "land", manpower: 800, speed: 9, attack: 7, defense: 6, breakthrough: 7, armor: 4, piercing: 6, airAttack: 0, supplyUse: 1.4, fuelUse: 2.5, equipment: ["light_tanks", "recon_vehicles"], tags: ["mobile", "recon"] },
    { id: "airborne", name: "Airborne Infantry", category: "land", role: "combat", domain: "land", manpower: 900, speed: 4, attack: 7, defense: 6, breakthrough: 3, armor: 0, piercing: 3, airAttack: 0, supplyUse: 1.1, fuelUse: 0, equipment: ["small_arms", "airdrop_equipment"], tags: ["special_forces", "air_assault"] },
    { id: "mountain", name: "Mountain Infantry", category: "land", role: "combat", domain: "land", manpower: 900, speed: 4, attack: 7, defense: 9, breakthrough: 3, armor: 0, piercing: 3, airAttack: 0, supplyUse: 1, fuelUse: 0, equipment: ["small_arms", "mountain_equipment"], tags: ["special_forces", "mountain"] },
    { id: "marines", name: "Marine Infantry", category: "land", role: "combat", domain: "land", manpower: 900, speed: 4, attack: 8, defense: 7, breakthrough: 4, armor: 0, piercing: 4, airAttack: 0, supplyUse: 1.2, fuelUse: 0, equipment: ["small_arms", "amphibious_equipment"], tags: ["special_forces", "amphibious"] },
    { id: "artillery", name: "Artillery", category: "land", role: "combat", domain: "land", manpower: 250, speed: 3, attack: 9, defense: 2, breakthrough: 1, armor: 0, piercing: 5, airAttack: 0, supplyUse: 1.3, fuelUse: 0.2, equipment: ["field_artillery", "ammunition"], tags: ["fire_support"] },
    { id: "rocket_artillery", name: "Rocket Artillery", category: "land", role: "combat", domain: "land", manpower: 200, speed: 4, attack: 10, defense: 2, breakthrough: 2, armor: 0, piercing: 4, airAttack: 0, supplyUse: 1.4, fuelUse: 0.3, equipment: ["rocket_artillery", "ammunition"], tags: ["fire_support"] },
    { id: "anti_tank", name: "Anti-Tank", category: "land", role: "combat", domain: "land", manpower: 180, speed: 3, attack: 3, defense: 3, breakthrough: 1, armor: 0, piercing: 10, airAttack: 0, supplyUse: 0.8, fuelUse: 0, equipment: ["anti_tank_weapons"], tags: ["anti_armor"] },
    { id: "anti_air", name: "Ground-Based Air Defense", category: "land", role: "air_defense", domain: "land", manpower: 180, speed: 3, attack: 2, defense: 4, breakthrough: 0, armor: 0, piercing: 2, airAttack: 9, supplyUse: 0.9, fuelUse: 0, equipment: ["anti_air_guns", "surface_to_air_missiles"], tags: ["air_defense"] },
    { id: "recon", name: "Reconnaissance", category: "land", role: "recon", domain: "land", manpower: 120, speed: 7, attack: 2, defense: 3, breakthrough: 1, armor: 1, piercing: 2, airAttack: 0, supplyUse: 0.5, fuelUse: 0.8, equipment: ["recon_vehicles", "sensors"], tags: ["recon", "screening"] },
    { id: "engineers", name: "Combat Engineers", category: "support", role: "engineering", domain: "land", manpower: 150, speed: 3, attack: 2, defense: 5, breakthrough: 1, armor: 0, piercing: 1, airAttack: 0, supplyUse: 0.6, fuelUse: 0, equipment: ["engineering_equipment"], tags: ["fortification", "river_crossing"] },
    { id: "logistics", name: "Logistics Support", category: "support", role: "logistics", domain: "land", manpower: 120, speed: 4, attack: 0, defense: 2, breakthrough: 0, armor: 0, piercing: 0, airAttack: 0, supplyUse: 0.3, fuelUse: 0.4, equipment: ["trucks", "supply_equipment"], tags: ["supply"] },

    // Air formations
    { id: "fighter", name: "Fighter Aircraft", category: "air", role: "combat", domain: "air", manpower: 100, speed: 900, attack: 7, defense: 7, breakthrough: 0, armor: 0, piercing: 0, airAttack: 8, supplyUse: 0.5, fuelUse: 2, equipment: ["fighter_aircraft", "air_munitions"], tags: ["air_superiority"] },
    { id: "multirole_fighter", name: "Multirole Fighter", category: "air", role: "combat", domain: "air", manpower: 100, speed: 850, attack: 8, defense: 7, breakthrough: 0, armor: 0, piercing: 0, airAttack: 8, supplyUse: 0.6, fuelUse: 2.2, equipment: ["multirole_aircraft", "precision_weapons"], tags: ["air_superiority", "strike"] },
    { id: "interceptor", name: "Interceptor", category: "air", role: "combat", domain: "air", manpower: 90, speed: 950, attack: 5, defense: 8, breakthrough: 0, armor: 0, piercing: 0, airAttack: 10, supplyUse: 0.45, fuelUse: 1.8, equipment: ["interceptor_aircraft"], tags: ["air_defense"] },
    { id: "close_air_support", name: "Close Air Support", category: "air", role: "combat", domain: "air", manpower: 90, speed: 650, attack: 10, defense: 3, breakthrough: 0, armor: 0, piercing: 0, airAttack: 2, supplyUse: 0.55, fuelUse: 1.8, equipment: ["ground_attack_aircraft"], tags: ["ground_attack"] },
    { id: "bomber", name: "Strategic Bomber", category: "air", role: "combat", domain: "air", manpower: 120, speed: 700, attack: 9, defense: 2, breakthrough: 0, armor: 0, piercing: 0, airAttack: 1, supplyUse: 0.7, fuelUse: 2.5, equipment: ["bomber_aircraft", "bombs"], tags: ["strategic_strike"] },
    { id: "transport_aircraft", name: "Transport Aircraft", category: "air", role: "transport", domain: "air", manpower: 80, speed: 550, attack: 0, defense: 2, breakthrough: 0, armor: 0, piercing: 0, airAttack: 0, supplyUse: 0.4, fuelUse: 1.5, equipment: ["transport_aircraft"], tags: ["airlift"] },
    { id: "recon_aircraft", name: "Reconnaissance Aircraft", category: "air", role: "recon", domain: "air", manpower: 70, speed: 750, attack: 0, defense: 2, breakthrough: 0, armor: 0, piercing: 0, airAttack: 1, supplyUse: 0.35, fuelUse: 1.2, equipment: ["recon_aircraft", "sensors"], tags: ["recon", "surveillance"] },
    { id: "helicopter", name: "Military Helicopter", category: "air", role: "combat", domain: "air", manpower: 60, speed: 250, attack: 5, defense: 3, breakthrough: 0, armor: 0, piercing: 0, airAttack: 2, supplyUse: 0.3, fuelUse: 1, equipment: ["military_helicopters"], tags: ["rotary_wing", "support"] },

    // Naval formations
    { id: "aircraft_carrier", name: "Aircraft Carrier", category: "naval", role: "combat", domain: "naval", manpower: 2500, speed: 28, attack: 7, defense: 8, breakthrough: 3, armor: 5, piercing: 5, airAttack: 0, supplyUse: 3, fuelUse: 5, equipment: ["carrier_hull", "naval_air_wing"], tags: ["capital_ship", "carrier"] },
    { id: "cruiser", name: "Cruiser", category: "naval", role: "combat", domain: "naval", manpower: 700, speed: 30, attack: 7, defense: 7, breakthrough: 3, armor: 4, piercing: 6, airAttack: 4, supplyUse: 1.5, fuelUse: 3, equipment: ["cruiser_hull", "naval_guns"], tags: ["surface_combat"] },
    { id: "destroyer", name: "Destroyer", category: "naval", role: "combat", domain: "naval", manpower: 250, speed: 32, attack: 5, defense: 6, breakthrough: 2, armor: 1, piercing: 5, airAttack: 3, supplyUse: 0.8, fuelUse: 2, equipment: ["destroyer_hull", "torpedoes", "sonar"], tags: ["escort", "anti_submarine"] },
    { id: "frigate", name: "Frigate", category: "naval", role: "combat", domain: "naval", manpower: 180, speed: 28, attack: 4, defense: 5, breakthrough: 1, armor: 1, piercing: 4, airAttack: 4, supplyUse: 0.6, fuelUse: 1.5, equipment: ["frigate_hull", "sonar", "missiles"], tags: ["escort", "patrol"] },
    { id: "corvette", name: "Corvette", category: "naval", role: "combat", domain: "naval", manpower: 90, speed: 25, attack: 3, defense: 3, breakthrough: 1, armor: 0, piercing: 3, airAttack: 2, supplyUse: 0.35, fuelUse: 1, equipment: ["corvette_hull", "naval_guns"], tags: ["coastal_defense", "patrol"] },
    { id: "submarine", name: "Submarine", category: "naval", role: "combat", domain: "naval", manpower: 55, speed: 20, attack: 9, defense: 2, breakthrough: 2, armor: 0, piercing: 8, airAttack: 0, supplyUse: 0.35, fuelUse: 0.8, equipment: ["submarine_hull", "torpedoes", "sonar"], tags: ["undersea", "stealth"] },
    { id: "amphibious_assault", name: "Amphibious Assault Ship", category: "naval", role: "transport", domain: "naval", manpower: 500, speed: 22, attack: 2, defense: 5, breakthrough: 1, armor: 1, piercing: 1, airAttack: 1, supplyUse: 1, fuelUse: 2, equipment: ["amphibious_ship", "landing_craft"], tags: ["amphibious", "transport"] },
    { id: "naval_support", name: "Naval Support Vessel", category: "support", role: "logistics", domain: "naval", manpower: 120, speed: 18, attack: 0, defense: 2, breakthrough: 0, armor: 0, piercing: 0, airAttack: 0, supplyUse: 0.4, fuelUse: 1, equipment: ["replenishment_ship"], tags: ["logistics", "replenishment"] }
];

function cloneDefinition(definition) {
    return {
        ...definition,
        equipment: [...definition.equipment],
        tags: [...definition.tags]
    };
}

function validateDefinition(definition) {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
        throw new TypeError("Unit type definition must be an object.");
    }
    const id = String(definition.id ?? "").trim();
    if (!/^[a-z0-9_]+$/.test(id)) throw new TypeError("Unit type ID must use lowercase letters, numbers and underscores.");
    if (!Object.values(UNIT_CATEGORIES).includes(definition.category)) {
        throw new RangeError(`Invalid unit category for ${id}.`);
    }
    if (!Object.values(UNIT_ROLES).includes(definition.role)) {
        throw new RangeError(`Invalid unit role for ${id}.`);
    }
    if (typeof definition.name !== "string" || !definition.name.trim()) {
        throw new TypeError(`Unit type ${id} requires a name.`);
    }
    for (const field of ["manpower", "speed", "attack", "defense", "breakthrough", "armor", "piercing", "airAttack", "supplyUse", "fuelUse"]) {
        if (!Number.isFinite(definition[field]) || definition[field] < 0) {
            throw new TypeError(`Unit type ${id} has invalid ${field}.`);
        }
    }
    if (!Array.isArray(definition.equipment) || !Array.isArray(definition.tags)) {
        throw new TypeError(`Unit type ${id} requires equipment and tags arrays.`);
    }
    return true;
}

export class UnitTypeRegistry {
    constructor(definitions = TYPE_DEFINITIONS) {
        if (!Array.isArray(definitions)) throw new TypeError("Unit type definitions must be an array.");
        this.types = new Map();
        this.destroyed = false;
        for (const definition of definitions) this.register(definition);
    }

    #ensureActive() {
        if (this.destroyed) throw new Error("UnitTypeRegistry has been destroyed.");
    }

    register(definition, options = {}) {
        this.#ensureActive();
        validateDefinition(definition);
        const id = definition.id.trim();
        if (this.types.has(id) && options.replace !== true) {
            throw new Error(`Unit type already registered: ${id}`);
        }
        const normalized = {
            ...definition,
            id,
            name: definition.name.trim(),
            equipment: [...new Set(definition.equipment.map(String))],
            tags: [...new Set(definition.tags.map(String))]
        };
        this.types.set(id, normalized);
        return cloneDefinition(normalized);
    }

    unregister(typeId) {
        this.#ensureActive();
        return this.types.delete(String(typeId ?? "").trim());
    }

    get(typeId) {
        this.#ensureActive();
        const definition = this.types.get(String(typeId ?? "").trim());
        return definition ? cloneDefinition(definition) : null;
    }

    has(typeId) {
        this.#ensureActive();
        return this.types.has(String(typeId ?? "").trim());
    }

    list(options = {}) {
        this.#ensureActive();
        const { category = null, role = null, domain = null, tag = null } = options;
        return [...this.types.values()]
            .filter(item => !category || item.category === category)
            .filter(item => !role || item.role === role)
            .filter(item => !domain || item.domain === domain)
            .filter(item => !tag || item.tags.includes(tag))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(cloneDefinition);
    }

    createUnitTemplate(typeId, overrides = {}) {
        this.#ensureActive();
        const definition = this.types.get(String(typeId ?? "").trim());
        if (!definition) throw new RangeError(`Unknown unit type: ${typeId}`);
        if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
            throw new TypeError("Unit template overrides must be an object.");
        }
        const allowed = new Set([
            "name", "manpower", "speed", "attack", "defense", "breakthrough",
            "armor", "piercing", "airAttack", "supplyUse", "fuelUse", "equipment"
        ]);
        for (const key of Object.keys(overrides)) {
            if (!allowed.has(key)) throw new TypeError(`Unsupported unit template override: ${key}`);
        }
        const template = { ...cloneDefinition(definition), ...overrides };
        validateDefinition(template);
        return template;
    }

    getCategories() {
        this.#ensureActive();
        return Object.values(UNIT_CATEGORIES);
    }

    getStatistics() {
        this.#ensureActive();
        const result = {
            total: this.types.size,
            byCategory: {},
            byRole: {}
        };
        for (const definition of this.types.values()) {
            result.byCategory[definition.category] = (result.byCategory[definition.category] ?? 0) + 1;
            result.byRole[definition.role] = (result.byRole[definition.role] ?? 0) + 1;
        }
        return result;
    }

    destroy() {
        if (this.destroyed) return;
        this.types.clear();
        this.destroyed = true;
    }
}

export const unitTypeRegistry = new UnitTypeRegistry();
export const UNIT_TYPES = Object.freeze(Object.fromEntries(
    unitTypeRegistry.list().map(definition => [definition.id, Object.freeze(definition)])
));

export function getUnitType(typeId) {
    return unitTypeRegistry.get(typeId);
}

export function getUnitTypes(options = {}) {
    return unitTypeRegistry.list(options);
}

export default unitTypeRegistry;

console.log("WORLD AT WAR: Military Unit Types module loaded.");
