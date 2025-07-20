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

        // --- LA MODIFICA CHIAVE E DEFINITIVA ---
        // Esegui uno script all'interno della pagina per estrarre il testo
        // DENTRO il tag <pre> che il browser usa per mostrare il contenuto XML.
        const xmlContent = await page.evaluate(() => {
            const preElement = document.querySelector('pre');
            return preElement ? preElement.textContent : null;
        });

        if (!xmlContent || xmlContent.trim().length < 50) {
            throw new Error('Could not extract valid XML content from the <pre> tag. The page structure might have changed.');
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
