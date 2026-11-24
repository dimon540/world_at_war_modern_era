import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../js/core/game.js";

test("new historical states receive their pending 2000 economy and manpower baselines", () => {
    const game = new Game({ autoLoadWorld: false });
    game.state.world.countries.YUG = {
        id: "YUG",
        name: "Federal Republic of Yugoslavia",
        status: "sovereign_state"
    };
    game.state.economy.pendingCountryBaselines.MNE = {
        nominalGDP: 984293043.81,
        realGDP: 1500000000,
        population: 604950,
        annualGrowthRate: 0.04,
        inflationRate: null,
        currency: "USD",
        source: "World Bank World Development Indicators",
        asOf: "2000-01-01"
    };
    game.state.military.pendingPersonnelBaselines.MNE = {
        activePersonnel: 12000,
        source: "World Bank WDI / IISS The Military Balance",
        asOf: "2000-01-01",
        indicatorCodes: { activePersonnel: "MS.MIL.TOTL.P1" }
    };

    game.historicalEventManager.load([{
        id: "MONTENEGRO_TEST_INDEPENDENCE",
        date: "2006-06-03",
        status: "verified",
        countries: ["MNE", "YUG"],
        changes: {
            createdCountry: "MNE",
            createdCountryData: {
                id: "MNE",
                name: "Montenegro",
                officialName: "Republic of Montenegro",
                capital: "Podgorica",
                iso2: "ME",
                iso3: "MNE",
                region: "Europe"
            }
        }
    }]);

    game.historicalEventManager.processDaily("2006-06-03");

    assert.equal(game.state.world.countries.MNE.status, "independent");
    assert.equal(game.economyManager.gdp.getCountryGDP("MNE").nominalGDP, 984293043.81);
    assert.equal(game.state.military.nationalPersonnel.MNE.activePersonnel, 12000);
    assert.equal(game.state.economy.pendingCountryBaselines.MNE, undefined);
    assert.equal(game.state.military.pendingPersonnelBaselines.MNE, undefined);
    assert.equal(game.state.military.statistics.nationalActivePersonnel, 12000);

    game.destroy();
});
