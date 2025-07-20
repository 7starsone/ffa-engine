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
            args: [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-infobars',
                '--window-position=0,0',
                '--ignore-certifcate-errors',
                '--ignore-certifcate-errors-spki-list',
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Imposta un User-Agent umano e credibile
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
        
        // Vai alla pagina. Questa è la richiesta iniziale che riceverà la challenge.
        const initialResponse = await page.goto(urlToScrape, { 
            waitUntil: 'networkidle2', // Aspetta che la pagina sia quasi completamente stabile
            timeout: 45000 // Aumentiamo il timeout a 45 secondi
        });

        // Controlla se siamo già sulla pagina giusta (potrebbe non esserci una challenge)
        if (initialResponse.ok() && initialResponse.headers()['content-type'].includes('xml')) {
            const content = await initialResponse.text();
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            return res.status(200).send(content);
        }

        // Se siamo qui, probabilmente c'è una challenge. Cerchiamo un selettore comune di Cloudflare.
        try {
            await page.waitForSelector('h2#challenge-running', { timeout: 15000 });
            console.log("Cloudflare challenge detected. Waiting for it to resolve...");
            // A volte basta aspettare, il reindirizzamento è automatico
            await page.waitForNavigation({
                waitUntil: 'networkidle0',
                timeout: 30000
            });
        } catch (e) {
            // Se il selettore non appare, potrebbe essere un altro tipo di blocco o la pagina è già caricata.
            console.log("No standard Cloudflare challenge detected, or it resolved quickly. Proceeding...");
        }

        // Ora che la navigazione (si spera) è avvenuta, prendiamo il contenuto finale.
        const finalContent = await page.content();
        
        // Estraiamo l'XML dal corpo della pagina finale
        const xmlContent = await page.evaluate(() => {
            const preElement = document.querySelector('pre');
            return preElement ? preElement.textContent : document.body.textContent;
        });

        if (!xmlContent || xmlContent.trim().length < 50) {
            throw new Error('Could not extract valid XML content. The page might be empty or still blocked.');
        }
        
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
