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
        
        // Vai alla pagina e attendi che sia completamente stabile
        await page.goto(urlToScrape, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });

        // --- LA MODIFICA CHIAVE E DEFINITIVA ---
        // Esegui uno script all'interno della pagina per estrarre il testo puro
        // dal corpo della pagina. Quando un browser renderizza un file XML,
        // il testo puro del corpo è l'XML stesso.
        const xmlContent = await page.evaluate(() => document.body.textContent);

        // Aggiungiamo un controllo per essere sicuri di non aver estratto una pagina vuota
        if (!xmlContent || xmlContent.trim().length < 50) {
            throw new Error('Could not extract valid XML content from the page. The page might be empty or a soft-404.');
        }
        
        // Impostiamo l'header corretto per SimplePie e inviamo i dati puliti
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.status(200).send(xmlContent);

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
