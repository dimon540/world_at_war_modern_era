import { getUnitTypes } from "../military/unit-types.js";

export class ArmyPanel {
    constructor(game, root = document) {
        this.game = game;
        this.root = root;
        this.container = root.querySelector("#panel-army");
    }

    render(countryId = this.game.state.player.countryId) {
        if (!this.container) return;
        this.container.replaceChildren();
        if (!countryId) {
            this.container.textContent = "Select a country to inspect its armed forces.";
            return;
        }

        const armies = this.game.armyManager.getArmiesForCountry(countryId);
        const divisions = Object.values(this.game.state.military.divisions)
            .filter(item => item.countryId === countryId && !["disbanded", "destroyed"].includes(item.status));
        const summary = document.createElement("p");
        summary.className = "panel-note";
        summary.textContent = `Armies: ${armies.length} · Divisions: ${divisions.length}`;
        this.container.append(summary);

        for (const army of armies) {
            const item = document.createElement("article");
            item.className = "management-item";
            const title = document.createElement("strong");
            title.textContent = army.name ?? army.id;
            const meta = document.createElement("span");
            meta.textContent = `${army.divisionIds.length} divisions · ${army.status}`;
            item.append(title, meta);
            this.container.append(item);
        }
        if (!armies.length) {
            const empty = document.createElement("p");
            empty.textContent = "No army formations have been initialized for this country.";
            this.container.append(empty);
        }

        const inventory = this.game.equipmentManager.getCountryInventory(countryId);
        const stockTitle = document.createElement("h3");
        stockTitle.textContent = "Equipment stockpiles";
        this.container.append(stockTitle);
        if (!inventory.length) {
            const empty = document.createElement("p");
            empty.textContent = "No recorded military equipment stockpiles.";
            this.container.append(empty);
        }
        for (const entry of inventory) {
            const row = document.createElement("p");
            row.className = "management-row";
            const name = document.createElement("b");
            name.textContent = entry.equipment.name;
            const amount = document.createElement("span");
            amount.textContent = entry.quantity.toLocaleString();
            row.append(name, amount);
            this.container.append(row);
        }

        this.#renderRecruitment(countryId);
    }

    #renderRecruitment(countryId) {
        const title = document.createElement("h3");
        title.textContent = "Recruit a division";
        this.container.append(title);

        const unitTypes = getUnitTypes({ domain: "land" });
        const select = document.createElement("select");
        select.className = "management-select";
        select.setAttribute("aria-label", "Division template");
        for (const type of unitTypes) {
            const option = document.createElement("option");
            option.value = type.id;
            option.textContent = type.name;
            select.append(option);
        }

        const message = document.createElement("p");
        message.className = "panel-note";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "action-button action-secondary";
        button.textContent = "Recruit division";

        const canEquip = () => {
            const type = unitTypes.find(item => item.id === select.value);
            return Boolean(type && type.equipment.every(equipmentId =>
                this.game.equipmentManager.getStock(countryId, equipmentId) >= 1
            ));
        };
        const refreshAvailability = () => {
            const available = canEquip();
            button.disabled = !available;
            message.textContent = available
                ? "Required equipment is available."
                : "Recruitment unavailable: the national stockpile lacks required equipment.";
        };
        select.addEventListener("change", refreshAvailability);
        button.addEventListener("click", () => {
            try {
                const type = unitTypes.find(item => item.id === select.value);
                if (!type || !canEquip()) {
                    refreshAvailability();
                    return;
                }
                const existingCount = Object.values(this.game.state.military.divisions)
                    .filter(item => item.countryId === countryId).length;
                const divisionName = `${type.name} ${existingCount + 1}`;
                const result = this.game.divisionManager.createDivision(
                    countryId,
                    divisionName,
                    { [type.id]: 1 },
                    { requireEquipment: true }
                );
                if (!result.success) {
                    message.textContent = `Recruitment failed: ${result.reason ?? "equipment unavailable"}.`;
                    refreshAvailability();
                    return;
                }

                let army = this.game.armyManager.getArmiesForCountry(countryId)[0];
                if (!army) {
                    army = this.game.armyManager.createArmy(countryId, "National Army").army;
                } else {
                    army = this.game.armyManager.getArmy(army.id);
                }
                this.game.armyManager.assignDivision(army.id, result.division.id);
                this.render(countryId);
            } catch (error) {
                message.textContent = `Recruitment failed: ${error.message}`;
            }
        });

        this.container.append(select, button, message);
        refreshAvailability();
    }

    destroy() {
        this.game = null;
        this.root = null;
        this.container = null;
    }
}

export default ArmyPanel;