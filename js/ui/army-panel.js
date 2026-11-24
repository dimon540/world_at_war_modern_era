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
        const nationalPersonnel = this.game.state.military.nationalPersonnel?.[countryId]?.activePersonnel;
        summary.textContent = `Armies: ${armies.length} · Divisions: ${divisions.length} · Active personnel: ${Number.isFinite(nationalPersonnel) ? nationalPersonnel.toLocaleString() : "Not recorded"}`;
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

        const productionTitle = document.createElement("h3");
        productionTitle.textContent = "Military production";
        this.container.append(productionTitle);
        const productionLines = this.game.equipmentProductionManager.list({ countryId });
        if (!productionLines.length) {
            const empty = document.createElement("p");
            empty.textContent = "No military equipment production lines are configured.";
            this.container.append(empty);
        }
        for (const line of productionLines) {
            const row = document.createElement("p");
            row.className = "management-row";
            const name = document.createElement("b");
            name.textContent = line.equipmentId;
            const output = document.createElement("span");
            output.textContent = `${line.status} · ${line.totalProduced.toLocaleString()} produced`;
            row.append(name, output);
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

        const recruitmentStatus = () => {
            const type = unitTypes.find(item => item.id === select.value);
            if (!type) return { available: false, reason: "Select a valid division template." };
            const hasEquipment = type.equipment.every(equipmentId =>
                this.game.equipmentManager.getStock(countryId, equipmentId) >= 1
            );
            if (!hasEquipment) return { available: false, reason: "Recruitment requires the full equipment package in the national stockpile." };
            const personnel = this.game.state.military.nationalPersonnel?.[countryId]?.activePersonnel;
            if (!Number.isFinite(personnel)) return { available: false, reason: "Recruitment requires a verified 2000 active-personnel baseline." };
            const allocated = Object.values(this.game.state.military.divisions)
                .filter(item => item.countryId === countryId && !["disbanded", "destroyed"].includes(item.status))
                .reduce((sum, item) => sum + (item.manpower ?? 0), 0);
            const availableManpower = Math.max(0, personnel - allocated);
            if (availableManpower < type.manpower) {
                return { available: false, reason: `Insufficient available manpower: ${availableManpower.toLocaleString()} / ${type.manpower.toLocaleString()} required.` };
            }
            return { available: true, reason: "Equipment and active personnel are available." };
        };
        const refreshAvailability = () => {
            const status = recruitmentStatus();
            button.disabled = !status.available;
            message.textContent = status.reason;
        };
        select.addEventListener("change", refreshAvailability);
        button.addEventListener("click", () => {
            try {
                const type = unitTypes.find(item => item.id === select.value);
                if (!type || !recruitmentStatus().available) {
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
                    { requireEquipment: true, requireManpower: true }
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