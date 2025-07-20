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
        
        // --- LA MODIFICA CHIAVE E DEFINITIVA ---
        // Andiamo alla pagina e catturiamo l'oggetto della risposta finale
        const response = await page.goto(urlToScrape, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });

        // Controlliamo se la risposta finale è valida
        if (!response.ok()) {
            throw new Error(`Failed to load the page: Status code ${response.status()}`);
        }

        // Invece di analizzare il DOM, prendiamo il corpo della risposta grezza
        const rawBody = await response.text();

        if (!rawBody || rawBody.trim().length < 50) {
            throw new Error('The response body was empty after a successful navigation.');
        }
        
        // Impostiamo l'header corretto per SimplePie e inviamo i dati puliti
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.status(200).send(rawBody);

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
