/* =========================================================
   WORLD AT WAR: MODERN ERA
   Browser application entry point
========================================================= */

import { createGame } from "./core/game.js";
import { GAME_CONFIG } from "./config.js";
import { GAME_EVENTS } from "./core/event-bus.js";
import { selectPlayerCountry } from "./core/game-state.js";
import { UIManager } from "./ui/ui-manager.js";

const $ = (selector) => document.querySelector(selector);

const elements = {
    date: $("#game-date"),
    speed: $("#game-speed"),
    status: $("#game-status"),
    countrySelect: $("#country-select"),
    countryName: $("#country-name"),
    countryCapital: $("#country-capital"),
    countryRegion: $("#country-region"),
    countryStatus: $("#country-status"),
    countryCount: $("#country-count"),
    provinceCount: $("#province-count"),
    aiCount: $("#ai-count"),
    selectedCountry: $("#selected-country"),
    startButton: $("#start-game"),
    pauseButton: $("#pause-game"),
    saveButton: $("#save-game"),
    loadButton: $("#load-game"),
    message: $("#game-message"),
    mapCanvas: $("#world-map"),
    mapLoading: $("#map-loading"),
    mainMenu: $("#main-menu"),
    campaignSetup: $("#campaign-setup"),
    settingsScreen: $("#settings-screen"),
    gameScreen: $("#game-screen"),
    campaignCountrySelect: $("#campaign-country-select"),
    setupCountryName: $("#setup-country-name"),
    setupCountryCapital: $("#setup-country-capital"),
    setupCountryRegion: $("#setup-country-region"),
    setupCountryStatus: $("#setup-country-status"),
    launchCampaignButton: $("#launch-campaign"),
    menuMessage: $("#menu-message")
};

let game = null;
let uiManager = null;
let mapFeatures = [];
let mapHitTargets = [];
let resizeObserver = null;
let eventUnsubscribers = [];
const availableSpeeds = GAME_CONFIG.time?.availableSpeeds ?? [1, 2, 4, 8, 16];

function showScreen(screen) {
    const screens = [elements.mainMenu, elements.campaignSetup, elements.settingsScreen, elements.gameScreen];
    for (const item of screens) {
        if (item) item.hidden = item !== screen;
    }
    if (screen === elements.gameScreen) {
        requestAnimationFrame(() => {
            drawMap();
            updateClock();
        });
    }
}

function showMenuMessage(message) {
    if (elements.menuMessage) elements.menuMessage.textContent = message;
}

function updateCampaignCountry(countryId) {
    const country = countryId ? game?.state.world.countries[countryId] : null;
    if (elements.setupCountryName) elements.setupCountryName.textContent =
        country?.name || country?.officialName || "Страна не выбрана";
    if (elements.setupCountryCapital) elements.setupCountryCapital.textContent = country?.capital || "—";
    if (elements.setupCountryRegion) elements.setupCountryRegion.textContent = country?.region || "—";
    if (elements.setupCountryStatus) elements.setupCountryStatus.textContent =
        country ? (country.status || "Доступна для игры") : "Выбери страну из списка";
    if (elements.launchCampaignButton) elements.launchCampaignButton.disabled = !country;
}

async function loadCampaignFromMenu() {
    try {
        await game.load(1);
        const countryId = game.state.player.countryId;
        if (!countryId || !game.state.world.countries[countryId]) {
            showMenuMessage("Сохранение найдено, но в нём не выбрана страна.");
            return;
        }
        renderCountry(countryId);
        uiManager?.refreshCountry();
        showScreen(elements.gameScreen);
        drawMap();
        updateClock();
        showMessage("Campaign loaded.", "success");
    } catch (error) {
        showMenuMessage("Сохранение не найдено или не удалось загрузить кампанию.");
    }
}

function showMessage(message, type = "info") {
    if (!elements.message) return;
    elements.message.textContent = message;
    elements.message.dataset.type = type;
    elements.message.hidden = false;
}

function setStatus(message, state = "ready") {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.dataset.state = state;
}

function formatDate(date) {
    if (!date) return "—";
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC"
    }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}

function countryCodeFromFeature(feature) {
    const p = feature?.properties ?? {};
    const candidates = [
        p.ADM0_A3, p.adm0_a3, p.ISO_A3, p.iso_a3,
        p.SOV_A3, p.sov_a3, p.GU_A3, p.gu_a3,
        p.ADM0_A3_US, p.SU_A3, p.BRK_A3,
        p.ISO3, p.iso3, p.country_code
    ];
    const code = candidates.find(value =>
        typeof value === "string" &&
        value.trim() &&
        value !== "-99"
    );
    return code ? code.trim().toUpperCase() : null;
}

function featureProvinceId(feature) {
    const properties = feature?.properties ?? {};
    const candidates = [
        feature?.id, properties.id, properties.ID, properties.adm1_code,
        properties.iso_3166_2, properties.code, properties.name, properties.NAME_1
    ];
    const value = candidates.find(item => item !== undefined && item !== null && String(item).trim());
    return value === undefined ? null : String(value);
}

function featureCountryName(feature) {
    const p = feature?.properties ?? {};
    return p.ADMIN || p.NAME || p.name || p.SOVEREIGNT ||
        p.admin || "Unknown territory";
}

function hashColor(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = (hash * 31 + value.charCodeAt(i)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 31% 43%)`;
}

function projectCoordinate(coordinate, width, height) {
    const longitude = Number(coordinate[0]);
    const latitude = Math.max(-89.8, Math.min(89.8, Number(coordinate[1])));
    return [
        ((longitude + 180) / 360) * width,
        ((90 - latitude) / 180) * height
    ];
}

function appendRing(path, ring, width, height) {
    if (!Array.isArray(ring) || ring.length < 3) return;
    const first = projectCoordinate(ring[0], width, height);
    path.moveTo(first[0], first[1]);
    for (let i = 1; i < ring.length; i++) {
        const point = projectCoordinate(ring[i], width, height);
        path.lineTo(point[0], point[1]);
    }
    path.closePath();
}

function createFeaturePath(feature, width, height) {
    if (typeof Path2D !== "function") return null;
    const path = new Path2D();
    const geometry = feature?.geometry;
    if (!geometry) return null;

    if (geometry.type === "Polygon") {
        for (const ring of geometry.coordinates ?? []) {
            appendRing(path, ring, width, height);
        }
    } else if (geometry.type === "MultiPolygon") {
        for (const polygon of geometry.coordinates ?? []) {
            for (const ring of polygon) {
                appendRing(path, ring, width, height);
            }
        }
    } else {
        return null;
    }
    return path;
}

function drawMap() {
    const canvas = elements.mapCanvas;
    if (!canvas || !game) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(220, Math.floor(rect.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#142532";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(175, 197, 207, .12)";
    context.lineWidth = 1;
    for (let longitude = -120; longitude <= 120; longitude += 60) {
        const x = ((longitude + 180) / 360) * width;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
    }
    for (let latitude = -60; latitude <= 60; latitude += 30) {
        const y = ((90 - latitude) / 180) * height;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
    }

    const selectedId = game.state.player.countryId;
    const countries = game.state.world.countries;
    const targets = [];

    for (let featureIndex = 0; featureIndex < mapFeatures.length; featureIndex += 1) {
        const feature = mapFeatures[featureIndex];
        const path = createFeaturePath(feature, width, height);
        if (!path) continue;

        const code = countryCodeFromFeature(feature);
        const provinceId = featureProvinceId(feature) ?? `province_${featureIndex + 1}`;
        const ownerId = provinceId ? game.state.world.ownership.provinceOwners[provinceId] : null;
        const country = (code && countries[code]) ? countries[code] : ownerId ? countries[ownerId] : null;
        const countryId = country?.id ?? country?.iso3 ?? code;
        const inactive = country?.status === "inactive";
        const selectedProvince = game.state.map.selectedProvinceId === provinceId;
        const selected = selectedId && (
            selectedId === countryId ||
            selectedId === country?.iso3
        );

        context.fillStyle = selectedProvince
            ? "#f1d28a"
            : selected ? "#d6ad62"
                : inactive ? "#35414a" : hashColor(countryId || code || featureCountryName(feature));
        context.fill(path, "evenodd");
        context.strokeStyle = selectedProvince || selected
            ? "#fff0bd"
            : "rgba(8, 19, 27, .72)";
        context.lineWidth = selectedProvince ? 1.8 : selected ? 1.35 : 0.55;
        context.stroke(path);

        if (country && !inactive) {
            targets.push({ path, countryId: country.id ?? code, provinceId });
        }
    }

    mapHitTargets = targets;
    if (elements.mapLoading) elements.mapLoading.hidden = true;
}

function renderCountry(countryId) {
    if (!game || !countryId) {
        if (elements.countryName) elements.countryName.textContent = "No country selected";
        if (elements.countryCapital) elements.countryCapital.textContent = "—";
        if (elements.countryRegion) elements.countryRegion.textContent = "—";
        if (elements.countryStatus) elements.countryStatus.textContent = "Choose a country";
        if (elements.selectedCountry) elements.selectedCountry.textContent = "None";
        return;
    }

    const country = game.state.world.countries[countryId];
    if (!country) return;

    if (elements.countryName) elements.countryName.textContent = country.name || country.officialName || countryId;
    if (elements.countryCapital) elements.countryCapital.textContent = country.capital || "Unknown";
    if (elements.countryRegion) elements.countryRegion.textContent = country.region || "—";
    if (elements.countryStatus) elements.countryStatus.textContent = country.status || "—";
    if (elements.selectedCountry) elements.selectedCountry.textContent = country.name || countryId;
    if (elements.countrySelect) elements.countrySelect.value = countryId;
}

function chooseCountry(countryId) {
    if (!game || !countryId) return;
    if (!selectPlayerCountry(game.state, countryId)) {
        showMessage("This country is not present in the loaded scenario.", "error");
        return;
    }
    game.state.map.selectedProvinceId = null;
    renderCountry(countryId);
    if (elements.aiCount) elements.aiCount.textContent = String(game.worldAIManager.getSnapshot().activeAgents);
    uiManager?.refreshCountry();
    drawMap();
    game.eventBus.emit(GAME_EVENTS.COUNTRY_SELECTED, {
        countryId,
        country: game.state.world.countries[countryId]
    });
    showMessage(`Selected ${game.state.world.countries[countryId].name}.`, "success");
}

function populateCountries() {
    const countries = Object.values(game.state.world.countries)
        .filter(country => country && country.status !== "inactive" && (country.id || country.iso3))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    elements.countrySelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a country…";
    elements.countrySelect.append(placeholder);

    for (const country of countries) {
        const id = country.id || country.iso3;
        const option = document.createElement("option");
        option.value = id;
        option.textContent = country.name || country.officialName || id;
        elements.countrySelect.append(option);
    }

    if (elements.campaignCountrySelect) {
        const setupPlaceholder = document.createElement("option");
        setupPlaceholder.value = "";
        setupPlaceholder.textContent = "Выбери государство…";
        const setupOptions = countries.map(country => {
            const option = document.createElement("option");
            option.value = country.id || country.iso3;
            option.textContent = country.name || country.officialName || option.value;
            return option;
        });
        elements.campaignCountrySelect.replaceChildren(setupPlaceholder, ...setupOptions);
        elements.campaignCountrySelect.disabled = false;
        elements.campaignCountrySelect.value = "";
        updateCampaignCountry("");
    }

    if (elements.countryCount) {
        elements.countryCount.textContent = String(countries.length);
    }
    if (elements.provinceCount) {
        elements.provinceCount.textContent =
            String(Object.keys(game.state.world.provinces).length);
    }
    if (elements.aiCount) {
        elements.aiCount.textContent = String(game.worldAIManager.getSnapshot().activeAgents);
    }
}

function updateClock() {
    if (!game) return;
    if (elements.date) elements.date.textContent = formatDate(game.getDate());
    if (elements.speed) elements.speed.textContent = `×${game.getSpeed()}`;
    const running = game.status === "running";
    setStatus(running ? "Simulation running" : "Paused", running ? "running" : "paused");
    if (elements.startButton) elements.startButton.disabled = running;
    if (elements.pauseButton) elements.pauseButton.disabled = !running;
}

async function startGame() {
    try {
        if (!game.state.player.isCountrySelected) {
            showMessage("Select a country before starting the campaign.", "warning");
            return;
        }
        await game.start();
        updateClock();
        showMessage("Campaign started.", "success");
    } catch (error) {
        showMessage(error.message, "error");
        setStatus("Startup error", "error");
    }
}

function bindInterface() {
    $("#menu-new-game")?.addEventListener("click", () => {
        if (!game) {
            showMenuMessage("Мир ещё загружается. Подожди немного.");
            return;
        }
        showScreen(elements.campaignSetup);
        showMenuMessage("СЦЕНАРИЙ: 1 ЯНВАРЯ 2000 ГОДА");
    });
    $("#menu-load-game")?.addEventListener("click", loadCampaignFromMenu);
    $("#menu-settings")?.addEventListener("click", () => showScreen(elements.settingsScreen));
    $("#setup-back-menu")?.addEventListener("click", () => showScreen(elements.mainMenu));
    $("#settings-back-menu")?.addEventListener("click", () => showScreen(elements.mainMenu));
    $("#return-to-menu")?.addEventListener("click", () => {
        if (game?.status === "running") game.pause();
        updateClock();
        showScreen(elements.mainMenu);
    });

    elements.campaignCountrySelect?.addEventListener("change", event => {
        updateCampaignCountry(event.target.value);
    });
    elements.launchCampaignButton?.addEventListener("click", async () => {
        const countryId = elements.campaignCountrySelect?.value;
        if (!countryId || !game.state.world.countries[countryId]) return;
        chooseCountry(countryId);
        showScreen(elements.gameScreen);
        await startGame();
    });
    $("#reduce-motion-setting")?.addEventListener("change", event => {
        document.querySelector("#app")?.classList.toggle("reduced-motion", event.target.checked);
    });

    elements.countrySelect?.addEventListener("change", event => {
        chooseCountry(event.target.value);
    });

    elements.startButton?.addEventListener("click", startGame);

    elements.pauseButton?.addEventListener("click", () => {
        if (game.pause()) {
            updateClock();
            showMessage("Campaign paused.", "info");
        }
    });

    $("#speed-down")?.addEventListener("click", () => {
        const index = availableSpeeds.indexOf(game.getSpeed());
        const currentIndex = index < 0 ? 0 : index;
        game.setSpeed(availableSpeeds[Math.max(0, currentIndex - 1)]);
        updateClock();
    });

    $("#speed-up")?.addEventListener("click", () => {
        const index = availableSpeeds.indexOf(game.getSpeed());
        const currentIndex = index < 0 ? 0 : index;
        game.setSpeed(availableSpeeds[Math.min(availableSpeeds.length - 1, currentIndex + 1)]);
        updateClock();
    });

    elements.saveButton?.addEventListener("click", async () => {
        try {
            await game.save(1, "Campaign 1");
            showMessage("Campaign saved in this browser.", "success");
        } catch (error) {
            showMessage(`Save failed: ${error.message}`, "error");
        }
    });

    elements.loadButton?.addEventListener("click", async () => {
        try {
            await game.load(1);
            renderCountry(game.state.player.countryId);
            uiManager?.refreshCountry();
            drawMap();
            updateClock();
            showMessage("Campaign loaded.", "success");
        } catch (error) {
            showMessage(`Load failed: ${error.message}`, "error");
        }
    });

    elements.mapCanvas?.addEventListener("click", event => {
        const rect = elements.mapCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const context = elements.mapCanvas.getContext("2d");
        for (let i = mapHitTargets.length - 1; i >= 0; i--) {
            const hit = mapHitTargets[i];
            if (context.isPointInPath(hit.path, x, y)) {
                chooseCountry(hit.countryId);
                if (hit.provinceId && game.state.world.provinces[hit.provinceId]) {
                    game.state.map.selectedProvinceId = hit.provinceId;
                    drawMap();
                    uiManager?.province.render(hit.provinceId);
                    uiManager?.showPanel("province");
                    const province = game.state.world.provinces[hit.provinceId];
                    const name = province.properties?.NAME_1 ?? province.properties?.name ?? hit.provinceId;
                    showMessage(`Selected ${name} in ${game.state.world.countries[hit.countryId]?.name ?? hit.countryId}.`, "success");
                }
                return;
            }
        }
    });

    eventUnsubscribers = [
        game.on(GAME_EVENTS.CLOCK_TICK, updateClock),
        game.on(GAME_EVENTS.GAME_STARTED, updateClock),
        game.on(GAME_EVENTS.GAME_PAUSED, updateClock),
        game.on(GAME_EVENTS.GAME_RESUMED, updateClock),
        game.on(GAME_EVENTS.WORLD_UPDATED, payload => {
            if (payload?.reason !== "historical_country_registry_changed") return;
            populateCountries();
            uiManager?.refreshCountry();
            drawMap();
        }),
        game.on(GAME_EVENTS.SYSTEM_ERROR, payload => {
            if (payload?.message) showMessage(payload.message, "error");
        })
    ].filter(unsubscribe => typeof unsubscribe === "function");

    if (typeof ResizeObserver === "function" && elements.mapCanvas) {
        resizeObserver = new ResizeObserver(drawMap);
        resizeObserver.observe(elements.mapCanvas);
    } else {
        window.addEventListener("resize", drawMap);
    }
}

async function boot() {
    try {
        setStatus("Loading world data…", "loading");
        showMessage("Initializing the world simulation…", "info");

        game = createGame({
            autoLoadWorld: true,
            autoSave: false
        });

        await game.initialize();
        uiManager = new UIManager(game);

        populateCountries();
        mapFeatures = game.state.map.geoJSON?.features ?? [];
        bindInterface();
        drawMap();
        updateClock();

        showMessage(
            `World loaded: ${Object.keys(game.state.world.countries).length} countries and ${mapFeatures.length} map features. Select a country to begin.`,
            "success"
        );
        setStatus("Ready", "ready");
    } catch (error) {
        console.error("WORLD AT WAR startup failed:", error);
        setStatus("Initialization failed", "error");
        showMessage(
            `Unable to initialize the game: ${error.message}. Run the project through a web server or GitHub Pages, not by opening index.html as a local file.`,
            "error"
        );
        if (elements.mapLoading) {
            elements.mapLoading.textContent = "World data could not be loaded.";
        }
    }
}

window.addEventListener("beforeunload", () => {
    if (resizeObserver) resizeObserver.disconnect();
    if (uiManager) uiManager.destroy();
    for (const unsubscribe of eventUnsubscribers) unsubscribe();
    eventUnsubscribers = [];
    if (game && !game.destroyed) game.destroy();
});

boot();
