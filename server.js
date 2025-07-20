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
                // Aggiungiamo un User-Agent specifico nei Chrome args per maggiore robustezza
                `--user-agent=${getUserAgent()}` 
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Imposta un User-Agent umano e credibile (anche qui per sicurezza)
        await page.setUserAgent(getUserAgent());
        
        // Aggiungiamo un piccolo ritardo casuale per sembrare più umani
        await page.waitForTimeout(getRandomInt(500, 1500)); // Aspetta tra 0.5 e 1.5 secondi

        // Vai alla pagina. Questa è la richiesta iniziale che riceverà la challenge.
        const initialResponse = await page.goto(urlToScrape, { 
            waitUntil: 'domcontentloaded', // Cambiamo a domcontentloaded per un caricamento più rapido
            timeout: 60000 // Aumentiamo il timeout a 60 secondi
        });

        // Simuliamo un piccolo scroll per attivare eventuali script che si basano su interazione utente
        await page.evaluate(() => window.scrollBy(0, 100));
        await page.waitForTimeout(getRandomInt(200, 800));

        // Controlla se siamo già sulla pagina giusta (potrebbe non esserci una challenge)
        // Verifichiamo il content-type E che il contenuto sia XML valido
        const contentType = initialResponse.headers()['content-type'] || '';
        const rawContent = await initialResponse.text();

        if (contentType.includes('xml') && isLikelyXml(rawContent)) {
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            return res.status(200).send(rawContent);
        }

        // Se siamo qui, probabilmente c'è un blocco o una challenge "silenziosa".
        // Invece di cercare un selettore Cloudflare, aspettiamo semplicemente che la pagina si stabilizzi
        // (potrebbe essere un reindirizzamento o un'iniezione di JS per la risoluzione)
        console.log("Initial response was not direct XML. Waiting for page to stabilize...");
        await page.waitForNavigation({
            waitUntil: 'networkidle0', // Aspetta che la rete sia completamente inattiva
            timeout: 45000 // 45 secondi per la stabilizzazione
        });

        // Ora che la navigazione (si spera) è avvenuta, prendiamo il contenuto finale.
        const finalContent = await page.content();
        
        // Estraiamo l'XML dal corpo della pagina finale
        // Se il feed RSS è l'unico contenuto della pagina, non sarà in un <pre>
        // Quindi proviamo a vedere se è un XML diretto o un HTML che lo contiene
        let xmlContent = finalContent; // Partiamo dal presupposto che possa essere l'intero contenuto

        if (!isLikelyXml(finalContent)) {
            // Se non è XML diretto, prova a estrarlo da un <pre> o altro elemento
            xmlContent = await page.evaluate(() => {
                const preElement = document.querySelector('pre');
                // Potrebbe esserci un div o altro elemento con l'XML,
                // o l'XML potrebbe essere l'unico contenuto senza tag wrapper
                return preElement ? preElement.textContent : document.body.textContent;
            });
        }
        
        if (!xmlContent || xmlContent.trim().length < 50 || !isLikelyXml(xmlContent)) {
            // Se ancora non troviamo XML valido, salva l'HTML per debug
            const errorHtml = await page.content();
            console.error("Could not extract valid XML content. Saving error_page.html for debugging.");
            // Puoi salvare `errorHtml` su un servizio di storage o loggarlo interamente
            // In un ambiente Render, potresti dover inviarlo come parte della risposta di errore o salvarlo su un log persistente
            return res.status(500).send('Could not extract valid XML content. The page might be blocked or malformed. Debug HTML: ' + errorHtml.substring(0, 500) + '...'); // Limita l'output per evitare risposte troppo grandi
        }
        
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.status(200).send(xmlContent);

    } catch (error) {
        console.error(error);
        // Cattura uno screenshot anche in caso di errore per debug
        if (browser !== null) {
            try {
                // Prendi la pagina corrente o creane una nuova se non disponibile
                const pages = await browser.pages();
                const currentPage = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();
                await currentPage.screenshot({ path: '/tmp/error_screenshot.png' }); // Salva in /tmp su Render
                console.log("Error screenshot 'error_screenshot.png' taken.");
            } catch (screenshotError) {
                console.warn("Could not take error state screenshot:", screenshotError.message);
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

// Funzione per generare un User-Agent realistico e aggiornato
function getUserAgent() {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/127.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/127.0',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// Funzione per generare un numero intero casuale in un intervallo
function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Funzione euristica per determinare se una stringa è probabilmente XML
function isLikelyXml(content) {
    content = content.trim();
    return content.startsWith('<?xml') || content.startsWith('<rss') || content.startsWith('<feed');
}
