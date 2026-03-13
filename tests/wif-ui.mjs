import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(TESTS_DIR, "..");

function readRequiredWif() {
  const wif = process.env.NEO_TEST_WIF?.trim();
  if (!wif) {
    throw new Error("Missing NEO_TEST_WIF. Set it to a Neo N3 testnet WIF before running this test.");
  }
  return wif;
}

async function run() {
  const testWif = readRequiredWif();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Set default timeout to 60s for testnet transactions
  page.setDefaultTimeout(60000);

  const errors = [];
  page.on("pageerror", (err) => errors.push(`Page error: ${err.message}`));
  page.on("console", (msg) => {
    console.log(`[PAGE] ${msg.text()}`);
    if (msg.type() === "error" && !msg.text().includes("ERR_CONNECTION_CLOSED")) {
      errors.push(`Console error: ${msg.text()}`);
    }
  });

  const url = "http://127.0.0.1:5173/";
  console.log(`Navigating to ${url}`);
  try {
     await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (err) {
      console.log("Failed reaching 5173, trying 5174");
      await page.goto("http://127.0.0.1:5174/", { waitUntil: "domcontentloaded" });
  }
  
  // 1. Check if WIF Key input exists
  console.log("Checking for WIF Key input...");
  const devWifInput = page.getByPlaceholder("WIF Key");
  await devWifInput.waitFor({ state: "visible", timeout: 10000 });
  
  // 2. Input WIF
  console.log("Typing WIF...");
  await devWifInput.fill(testWif);
  
  // 3. Click connect button
  console.log("Locating the Dev Connect button...");
  const connectBtn = devWifInput.locator("xpath=following-sibling::button").first();
  await connectBtn.click();
  
  // 4. Wait for connection
  console.log("Waiting for connection to reflect in UI...");
  const signOutBtn = page.getByRole("button", { name: /sign out/i });
  await signOutBtn.waitFor({ state: "visible", timeout: 10000 });
  console.log("Wallet connected successfully!");

  // Create dummy image for upload
  const dummyImagePath = path.join(ROOT_DIR, "tests", "dummy.png");
  if (!fs.existsSync(dummyImagePath)) {
    // 1x1 png base64
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    fs.writeFileSync(dummyImagePath, Buffer.from(pngBase64, "base64"));
  }

  // 5. Navigate to Create Collection
  console.log("Creating a new collection...");
  await page.getByRole("link", { name: "Create" }).first().click();
  await page.waitForURL("**/collections/new");
  
  console.log("Selecting Shared Mode and continuing...");
  await page.locator('text="Shared Storefront"').click();
  await page.getByRole("button", { name: /continue/i }).click();

  console.log("Filling out collection details...");
  await page.getByLabel(/Collection Name/i).fill("Playwright E2E Collection");
  await page.getByLabel(/Symbol/i).fill("E2E");
  await page.getByLabel(/Description/i).fill("Test collection created by playwright");
  
  // Upload logo
  console.log("Uploading logo...");
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(dummyImagePath);

  console.log("Submitting collection...");
  await page.getByRole("button", { name: /Launch Collection/i }).click();

  console.log("Waiting for transaction confirmation...");
  try {
     // Wait for either the success message OR an error message in the DOM
     await Promise.race([
        page.waitForSelector('text="Collection Launched!"', { timeout: 45000 }),
        page.waitForSelector('.error', { timeout: 45000 }).then(async (el) => {
           if (el) throw new Error("UI Error popped up: " + await el.innerText());
        })
     ]);
  } catch(e) {
     console.error("Failed to launch collection: " + e.message);
     process.exit(1);
  }
  console.log("Collection successfully deployed!");

  // Wait a few seconds for indexer to catch up
  console.log("Waiting 30s for NeoFS and GraphQL indexer to synchronize...");
  await page.waitForTimeout(30000);

  // 6. Navigate to Mint
  console.log("Navigating to Mint page...");
  await page.getByRole("link", { name: "Mint" }).first().click();
  await page.waitForURL("**/mint");
  
  // Wait for collections to load
  await page.waitForTimeout(5000); 

  console.log("Selecting appropriate collection...");
  let match = null;
  for (let i = 0; i < 5; i++) {
     try {
        const options = await page.locator('select').first().locator('option').allInnerTexts();
        console.log("Available options in dropdown: ", options);
        match = options.find(o => o.includes("Playwright E2E Collection"));
        if (match) break;
     } catch(e) {}
     console.log("Not found yet, reloading page and waiting 5s...");
     await page.reload({ waitUntil: "domcontentloaded" });
     await page.waitForTimeout(5000);
  }

  if (match) {
     await page.locator('select').first().selectOption({ label: match });
     console.log(`Selected: ${match}`);
  } else {
     console.log("Proceeding with default selected...");
  }

  console.log("Uploading artwork for NFT...");
  const mintFileInput = page.locator('input[type="file"]');
  await mintFileInput.setInputFiles(dummyImagePath);

  console.log("Continuing to item details...");
  await page.getByRole("button", { name: /Continue/i }).click();

  console.log("Filling NFT details...");
  await page.getByLabel(/Item Name/i).fill("Playwright E2E NFT");
  await page.locator('select').first().selectOption("standard");

  console.log("Submitting Mint transaction...");
  await page.getByRole("button", { name: /Mint Item Now/i }).click();

  console.log("Waiting for Mint transaction confirmation...");
  try {
     await Promise.race([
        page.waitForSelector('text="Item Minted!"', { timeout: 45000 }),
        page.waitForSelector('.error', { timeout: 45000 }).then(async (el) => {
           if (el) throw new Error("UI Error popped up: " + await el.innerText());
        })
     ]);
  } catch(e) {
     console.error("Failed to mint NFT: " + e.message);
     process.exit(1);
  }
  console.log("NFT successfully minted!");

  // 7. Verify connected state survives cross-page navigation and reloads
  console.log("Checking connected state on Portfolio route...");
  await page.goto(`${new URL(baseUrl).origin}/portfolio`, { waitUntil: "domcontentloaded" });
  await signOutBtn.waitFor({ state: "visible", timeout: 30000 });
  console.log("Portfolio loaded with preserved wallet state.");

  console.log("Checking Created -> Mint Item handoff...");
  await page.getByRole("button", { name: /Created/i }).click();
  const createdMintLink = page.getByRole("link", { name: /^Mint Item$/ }).first();
  await createdMintLink.waitFor({ state: "visible", timeout: 30000 });
  await createdMintLink.click();
  await page.waitForURL(/\/mint\?collectionId=/, { timeout: 30000 });
  const selectedOptionLabel = await page.locator("select").first().locator("option:checked").innerText();
  if (!selectedOptionLabel.includes("Playwright E2E Collection")) {
    throw new Error(`Mint page did not preserve selected collection context. Selected option: ${selectedOptionLabel}`);
  }
  console.log("Mint Item handoff preserved selected collection.");

  console.log("Reloading Portfolio page...");
  await page.goto(`${new URL(baseUrl).origin}/portfolio`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await signOutBtn.waitFor({ state: "visible", timeout: 30000 });
  console.log("Reload preserved wallet state.");

  console.log("Navigating back to Explore...");
  await page.goto(`${new URL(baseUrl).origin}/explore`, { waitUntil: "domcontentloaded" });
  await signOutBtn.waitFor({ state: "visible", timeout: 30000 });
  console.log("Explore loaded with preserved wallet state.");

  await browser.close();

  if (errors.length > 0) {
    console.error("Found errors during UI testing:");
    errors.forEach(e => console.error(e));
    process.exit(1);
  } else {
    console.log("All UI tests passed with no console errors! Full flow verified.");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("Test script failed:", err);
  process.exit(1);
});
