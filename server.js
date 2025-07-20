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
        
        console.log("--- DEBUG: Avvio navigazione iniziale a: " + urlToScrape);
        
        // 1. Vai alla pagina iniziale (la challenge)
        await page.goto(urlToScrape, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
        });
        console.log("--- DEBUG: Pagina iniziale caricata. Attendo la navigazione della challenge...");

        // 2. Aspetta che la challenge si risolva e faccia navigare la pagina
        await page.waitForNavigation({
            waitUntil: 'networkidle0',
            timeout: 30000
        });
        console.log("--- DEBUG: Navigazione della challenge completata! Ora sono su: " + page.url());

        // 3. Ora che siamo sulla pagina giusta, catturiamo il suo contenuto per analizzarlo
        const finalPageContent = await page.content();

        // --- MODALITÀ DIAGNOSTICA ---
        console.log("--- INIZIO DEBUG CONTENUTO HTML FINALE ---");
        console.log(finalPageContent);
        console.log("--- FINE DEBUG CONTENUTO HTML FINALE ---");
        
        res.status(500).send('DIAGNOSTIC MODE: Check Render logs for the full page content.');

    } catch (error) {
        console.error("--- DEBUG: ERRORE CATTURATO NEL BLOCCO CATCH ---");
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
