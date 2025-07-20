const express = require('express');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const port = process.env.PORT || 10000;

app.get('/', async (req, res) => {
    const urlToScrape = req.query.url;

    if (!urlToScrape || !urlToScrape.startsWith('http')) {
        return res.status(400).send('Please provide a valid URL parameter.');
    }

    let browser = null;
    try {
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        await page.goto(urlToScrape, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });

        // --- MODALITÀ DIAGNOSTICA ---
        // Estraiamo l'intero contenuto HTML della pagina finale
        const finalPageContent = await page.content();

        // Logghiamo l'intero contenuto per l'analisi
        console.log("--- INIZIO DEBUG CONTENUTO HTML FINALE ---");
        console.log(finalPageContent);
        console.log("--- FINE DEBUG CONTENUTO HTML FINALE ---");
        
        // Per questo test, inviamo un messaggio di errore controllato al plugin,
        // così sappiamo che lo script è stato eseguito ma che dobbiamo controllare i log.
        res.status(500).send('DIAGNOSTIC MODE: Check Render logs for the full page content.');

    } catch (error) {
        console.error(error);
        res.status(500).send('The server encountered an error while scraping the page: ' + String(error));
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }
});

app.listen(port, () => {
    console.log(`Scraping engine is listening on port ${port}`);
});
