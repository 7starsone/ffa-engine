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
        
        // CORREZIONE CHIAVE: Catturiamo l'oggetto della risposta dalla navigazione
        const response = await page.goto(urlToScrape, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });

        // Invece di page.content(), usiamo response.text() per ottenere il corpo grezzo
        const content = await response.text();
        
        // Impostiamo l'header corretto per SimplePie
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.status(200).send(content);

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
