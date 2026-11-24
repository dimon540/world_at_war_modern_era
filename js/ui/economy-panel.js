export class EconomyPanel {
    constructor(game, root = document) {
        this.game = game;
        this.root = root;
        this.container = root.querySelector("#panel-economy");
    }

    render(countryId = this.game.state.player.countryId) {
        if (!this.container) return;
        this.container.replaceChildren();
        if (!countryId) {
            this.container.textContent = "Select a country to inspect its economy.";
            return;
        }

        const economy = this.game.economyManager;
        const gdp = economy.gdp.getCountryGDP(countryId);
        const budget = economy.budgets.getBudget(countryId);
        const factories = economy.factories.list({ countryId });
        const stockpiles = economy.resources.getStockpiles(countryId);
        const civilianFactories = factories.filter(factory => factory.type === "civilian");
        const constructionPoints = this.game.state.economy.constructionPoints?.[countryId] ?? 0;

        const rows = [
            ["Nominal GDP", gdp ? gdp.nominalGDP.toLocaleString() + (gdp.currency ? " " + gdp.currency : "") : "No verified baseline"],
            ["Population", gdp ? gdp.population.toLocaleString() : "Not recorded"],
            ["GDP per capita", gdp ? gdp.gdpPerCapita.toFixed(2) : "—"],
            ["Annual real growth", gdp ? (gdp.annualGrowthRate * 100).toFixed(2) + "%" : "—"],
            ["Treasury", budget ? budget.treasury.toLocaleString() : "No verified baseline"],
            ["Public debt", budget ? budget.debt.toLocaleString() : "—"],
            ["Civilian factories", civilianFactories.reduce((sum, item) => sum + item.level, 0)],
            ["Military factories", factories.filter(item => item.type === "military").reduce((sum, item) => sum + item.level, 0)],
            ["Monthly construction points", constructionPoints]
        ];
        for (const [label, value] of rows) {
            const row = document.createElement("p");
            row.className = "management-row";
            const strong = document.createElement("b");
            strong.textContent = label;
            const span = document.createElement("span");
            span.textContent = String(value);
            row.append(strong, span);
            this.container.append(row);
        }

        const stockTitle = document.createElement("h3");
        stockTitle.textContent = "Resource stockpiles";
        this.container.append(stockTitle);
        for (const [resource, amount] of Object.entries(stockpiles)) {
            const row = document.createElement("p");
            row.className = "management-row";
            row.textContent = resource + ": " + amount;
            this.container.append(row);
        }
        if (!Object.keys(stockpiles).length) {
            const empty = document.createElement("p");
            empty.textContent = "No recorded resource stockpiles.";
            this.container.append(empty);
        }

        this.#renderConstruction(countryId, civilianFactories.length > 0);
    }

    #renderConstruction(countryId, hasCivilianIndustry) {
        const title = document.createElement("h3");
        title.textContent = "Industrial construction";
        this.container.append(title);

        const projects = this.game.economyManager.construction.list({ countryId });
        for (const project of projects) {
            const item = document.createElement("article");
            item.className = "management-item";
            const name = document.createElement("strong");
            name.textContent = project.name;
            const status = document.createElement("span");
            status.textContent = project.status === "completed"
                ? "Completed"
                : project.status === "active"
                    ? `Progress: ${Math.floor(project.progress / project.cost * 100)}%`
                    : project.status;
            item.append(name, status);
            this.container.append(item);
        }
        if (!projects.length) {
            const empty = document.createElement("p");
            empty.className = "panel-note";
            empty.textContent = "No active or completed construction projects.";
            this.container.append(empty);
        }

        const select = document.createElement("select");
        select.className = "management-select";
        select.setAttribute("aria-label", "Factory type to construct");
        for (const [value, label] of [
            ["civilian", "Civilian factory"],
            ["military", "Military factory"],
            ["naval", "Naval factory"],
            ["resource", "Resource facility"]
        ]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            select.append(option);
        }

        const message = document.createElement("p");
        message.className = "panel-note";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "action-button action-secondary";
        button.textContent = "Start construction";
        button.disabled = !hasCivilianIndustry || projects.filter(item => item.status === "active").length >= 5;
        message.textContent = hasCivilianIndustry
            ? "Construction advances monthly using active civilian factories."
            : "Construction requires at least one active civilian factory.";

        button.addEventListener("click", () => {
            try {
                const date = this.game.clock.getSnapshot().date;
                const dateId = `${date.year}-${date.month}-${date.day}`;
                const projectId = `player-${countryId}-${dateId}-${Object.keys(this.game.state.economy.constructionProjects).length + 1}`;
                this.game.economyManager.construction.start({
                    id: projectId,
                    countryId,
                    name: select.options[select.selectedIndex].textContent,
                    factoryType: select.value,
                    cost: 100,
                    capacity: 1
                });
                this.render(countryId);
            } catch (error) {
                message.textContent = `Construction failed: ${error.message}`;
            }
        });

        this.container.append(select, button, message);
    }

    destroy() {
        this.game = null;
        this.root = null;
        this.container = null;
    }
}

export default EconomyPanel;