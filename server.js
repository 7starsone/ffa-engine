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
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                `--user-agent=${getUserAgent()}` 
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        await page.setUserAgent(getUserAgent());
        await page.waitForTimeout(getRandomInt(500, 1500)); 

        const initialResponse = await page.goto(urlToScrape, { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
        });

        await page.evaluate(() => window.scrollBy(0, 100));
        await page.waitForTimeout(getRandomInt(200, 800));

        const contentType = initialResponse.headers()['content-type'] || '';
        const rawContent = await initialResponse.text();

        if (contentType.includes('xml') && isLikelyXml(rawContent)) {
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            return res.status(200).send(rawContent);
        }

        console.log("Initial response was not direct XML. Waiting for page to stabilize...");
        
        // --- MODIFICA CHIAVE QUI ---
        // Proviamo con 'load' invece di 'networkidle0' e aumentiamo il timeout
        try {
            await page.waitForNavigation({
                waitUntil: 'load', // Meno restrittivo di networkidle0
                timeout: 60000 // Aumentiamo a 60 secondi
            });
            console.log("Navigation completed with 'load' event.");
        } catch (navigationError) {
            console.warn("Navigation with 'load' event timed out or failed, proceeding anyway. Error:", navigationError.message);
            // Se il timeout scatta qui, la pagina potrebbe comunque essersi parzialmente caricata.
            // Possiamo provare a dare un'ulteriore pausa per far finire gli script.
            await page.waitForTimeout(getRandomInt(2000, 5000)); // Aspetta 2-5 secondi extra
        }
        // --- FINE MODIFICA CHIAVE ---

        // VERIFICA DELLA URL FINALE
        const currentUrl = page.url();
        console.log(`Current URL after stabilization attempt: ${currentUrl}`);
        // Se la URL non è quella attesa, potremmo essere ancora bloccati.
        // Potresti aggiungere un controllo qui per URL di Cloudflare, es. if (currentUrl.includes('cloudflare.com')) { ... }

        const finalContent = await page.content();
        
        let xmlContent = finalContent;

        if (!isLikelyXml(finalContent)) {
            xmlContent = await page.evaluate(() => {
                const preElement = document.querySelector('pre');
                return preElement ? preElement.textContent : document.body.textContent;
            });
        }
        
        if (!xmlContent || xmlContent.trim().length < 50 || !isLikelyXml(xmlContent)) {
            const errorHtml = await page.content();
            console.error("Could not extract valid XML content. Saving error_page.html for debugging.");
            // DEBUG: Stampa una parte dell'HTML direttamente nel log di Render per una rapida occhiata
            console.error("DEBUG HTML SNIPPET:\n", errorHtml.substring(0, 1000)); 
            return res.status(500).send('Could not extract valid XML content. The page might be blocked or malformed. Check logs for DEBUG HTML.');
        }
        
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.status(200).send(xmlContent);

    } catch (error) {
        console.error("An unhandled error occurred:", error);
        if (browser !== null) {
            try {
                const pages = await browser.pages();
                const currentPage = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();
                // Assicurati che il percorso sia sempre in /tmp per Render
                await currentPage.screenshot({ path: '/tmp/error_screenshot.png', fullPage: true }); 
                console.log("Error screenshot '/tmp/error_screenshot.png' taken.");
                // Se vuoi salvare l'HTML in caso di errore
                const errorPageContent = await currentPage.content();
                console.error("DEBUG ERROR HTML CONTENT:\n", errorPageContent.substring(0, 2000)); 
            } catch (screenshotError) {
                console.warn("Could not take error state screenshot or get error HTML:", screenshotError.message);
            }
        }
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

function getUserAgent() {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/127.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/127.0',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isLikelyXml(content) {
    content = content.trim();
    // Aggiungi più varianti comuni di tag XML radice
    return content.startsWith('<?xml') || 
           content.startsWith('<rss') || 
           content.startsWith('<feed') ||
           content.startsWith('<urlset'); // Aggiunto per sitemaps, anche se non è il caso specifico
}
