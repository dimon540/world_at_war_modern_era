import assert from "node:assert/strict";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".geojson": "application/geo+json; charset=utf-8",
    ".svg": "image/svg+xml"
};

const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const target = resolve(root, "." + pathname);
    if (target !== root && !target.startsWith(root + sep)) {
        response.writeHead(403).end("Forbidden");
        return;
    }
    try {
        const info = statSync(target);
        if (!info.isFile()) throw new Error("Not a file");
        response.writeHead(200, {
            "Content-Type": mime[extname(target)] ?? "application/octet-stream",
            "Content-Length": info.size,
            "Cache-Control": "no-store"
        });
        createReadStream(target).pipe(response);
    } catch {
        response.writeHead(404).end("Not found");
    }
});

let browser;
try {
    await new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));

    await page.goto(`http://127.0.0.1:${address.port}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
        () => document.querySelector("#game-status")?.textContent === "Ready",
        undefined,
        { timeout: 90000 }
    );

    const countryOptions = await page.locator("#country-select option").count();
    assert.ok(countryOptions > 100, `Expected a global country list, received ${countryOptions} options.`);
    const firstCountry = await page.locator("#country-select option").nth(1).getAttribute("value");
    assert.ok(firstCountry, "The country selector must contain a playable country.");

    const firstCountryName = await page.locator("#country-select option").nth(1).textContent();
    await page.locator("#country-select").selectOption(firstCountry);
    assert.equal((await page.locator("#selected-country").textContent()).trim(), firstCountryName.trim());
    assert.ok((await page.locator("#panel-country").textContent()).includes(firstCountryName.trim()));
    assert.equal(Number(await page.locator("#ai-count").textContent()), countryOptions - 2,
        "The selected player nation must not be counted as AI-controlled.");

    const mapBox = await page.locator("#world-map").boundingBox();
    const kabulX = mapBox.x + ((69.2 + 180) / 360) * mapBox.width;
    const kabulY = mapBox.y + ((90 - 34.5) / 180) * mapBox.height;
    await page.mouse.click(kabulX, kabulY);
    await page.waitForFunction(
        () => document.querySelector("#panel-province")?.hidden === false,
        undefined,
        { timeout: 5000 }
    );
    assert.ok((await page.locator("#panel-province").textContent()).includes("Owner"));

    await page.locator("#start-game").click();
    await page.waitForFunction(
        () => document.querySelector("#game-status")?.textContent === "Simulation running",
        undefined,
        { timeout: 5000 }
    );
    await page.waitForTimeout(1200);
    await page.locator("#pause-game").click();
    await page.waitForFunction(
        () => document.querySelector("#game-status")?.textContent === "Paused",
        undefined,
        { timeout: 5000 }
    );

    await page.locator('[data-panel-tab="economy"]').click();
    assert.equal(await page.locator("#panel-economy").isVisible(), true);
    assert.ok((await page.locator("#panel-economy").textContent()).includes("Industrial construction"));
    assert.equal(await page.locator("#panel-economy button").isDisabled(), true,
        "Construction must be unavailable without a civilian factory.");

    await page.locator('[data-panel-tab="army"]').click();
    assert.equal(await page.locator("#panel-army").isVisible(), true);
    assert.ok((await page.locator("#panel-army").textContent()).includes("Equipment stockpiles"));
    assert.equal(await page.locator("#panel-army button").isDisabled(), true,
        "Recruitment must be unavailable without the required equipment.");

    await page.locator('[data-panel-tab="research"]').click();
    assert.equal(await page.locator("#panel-research").isVisible(), true);
    assert.deepEqual(pageErrors, [], "The game must not throw uncaught browser errors.");

    console.log(`Browser smoke test passed: ${countryOptions - 1} playable countries, country selection, campaign start/pause and research panel.`);
} finally {
    if (browser) await browser.close();
    await new Promise(resolveClose => server.close(resolveClose));
}
