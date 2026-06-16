const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { expect } = require('chai');

describe('IntelliTrip Authentication Flow', function () {
    let driver;

    before(async function () {
        // Configure headless Chrome
        let options = new chrome.Options();
        options.addArguments('--headless');
        options.addArguments('--disable-gpu');
        options.addArguments('--window-size=1280,800');
        // Necessary flags for headless environments
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');

        driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();

        await driver.manage().setTimeouts({ implicit: 5000 });
    });

    after(async function () {
        if (driver) {
            await driver.quit();
        }
    });

    it('Should verify the login page loads and interact with inputs', async function () {
        await driver.get('http://localhost:5000/');

        // Log to verify we opened it
        console.log("Navigated to http://localhost:5000/");

        const pageTitle = await driver.getTitle();
        console.log("Page title is:", pageTitle);
        expect(pageTitle).to.include('IntelliTrip');

        const loginToggle = await driver.findElement(By.xpath("//button[contains(text(), 'Login')]"));
        await loginToggle.click();
        console.log("Clicked 'Login' tab");

        const emailInput = await driver.findElement(By.id('loginEmail'));
        const passInput = await driver.findElement(By.id('loginPassword'));

        await emailInput.sendKeys('testuser@example.com');
        await passInput.sendKeys('password123');
        console.log("Filled out login credentials");

        const submitBtn = await driver.findElement(By.xpath("//form[@id='loginForm']//button[@type='submit']"));
        await submitBtn.click();
        console.log("Clicked login submit button");

        // Give it a second just to process the expected error/toast
        await driver.sleep(1000);
        console.log("Test sequence completed successfully!");
    });
});
