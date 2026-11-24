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
        { timeout: 90000 }
    );

    const countryOptions = await page.locator("#country-select option").count();
    assert.ok(countryOptions > 100, `Expected a global country list, received ${countryOptions} options.`);
    const firstCountry = await page.locator("#country-select option").nth(1).getAttribute("value");
    assert.ok(firstCountry, "The country selector must contain a playable country.");

    await page.locator("#country-select").selectOption(firstCountry);
    assert.notEqual(await page.locator("#selected-country").textContent(), "None");
    assert.ok((await page.locator("#panel-country").textContent()).includes(firstCountry)
        || (await page.locator("#panel-country").textContent()).length > 0);

    await page.locator("#start-game").click();
    await page.waitForFunction(
        () => document.querySelector("#game-status")?.textContent === "Simulation running",
        { timeout: 5000 }
    );
    await page.waitForTimeout(1200);
    await page.locator("#pause-game").click();
    await page.waitForFunction(
        () => document.querySelector("#game-status")?.textContent === "Paused",
        { timeout: 5000 }
    );

    await page.locator('[data-panel-tab="research"]').click();
    assert.equal(await page.locator("#panel-research").isVisible(), true);
    assert.deepEqual(pageErrors, [], "The game must not throw uncaught browser errors.");

    console.log(`Browser smoke test passed: ${countryOptions - 1} playable countries, country selection, campaign start/pause and research panel.`);
} finally {
    if (browser) await browser.close();
    await new Promise(resolveClose => server.close(resolveClose));
}
