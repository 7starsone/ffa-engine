const express = require('express');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises; // Per leggere il file locale

// Applica il plugin Stealth a Puppeteer
puppeteer.use(StealthPlugin());

const app = express();
const port = process.env.PORT || 10000;

app.get('/', async (req, res) => {
    const urlToScrape = req.query.url;

    // Validazione della URL fornita
    if (!urlToScrape || !urlToScrape.startsWith('http')) {
        return res.status(400).send('Please provide a valid URL parameter.');
    }

    let browser = null; // Inizializza browser a null per il blocco finally
    try {
        // Avviare Puppeteer con le configurazioni di Chromium per Render
        browser = await puppeteer.launch({
            args: [
                ...chromium.args, // Argomenti predefiniti di Chromium
                '--no-sandbox', // Essenziale per ambienti headless come Render
                '--disable-setuid-sandbox',
                '--disable-infobars',
                '--window-position=0,0',
                '--ignore-certificate-errors', // Ignora errori SSL
                '--ignore-certificate-errors-spki-list',
                `--user-agent=${getUserAgent()}` // Imposta un User-Agent a livello di browser
            ],
            defaultViewport: chromium.defaultViewport, // Viewport predefinito
            executablePath: await chromium.executablePath(), // Percorso dell'eseguibile Chromium
            headless: chromium.headless, // Esegui in modalità headless
            ignoreHTTPSErrors: true, // Ignora errori HTTPS (duplicato, ma per sicurezza)
        });

        const page = await browser.newPage();
        
        // Imposta un User-Agent anche a livello di pagina (per ridondanza e robustezza)
        await page.setUserAgent(getUserAgent());
        
        // Aggiungi un piccolo ritardo casuale per simulare un comportamento più umano
        await page.waitForTimeout(getRandomInt(500, 1500)); // Aspetta tra 0.5 e 1.5 secondi

        // Vai alla URL target
        const initialResponse = await page.goto(urlToScrape, { 
            waitUntil: 'domcontentloaded', // Aspetta che il DOM sia caricato
            timeout: 60000 // Timeout aumentato a 60 secondi per il goto iniziale
        });

        // Simula un piccolo scroll per attivare eventuali script che si basano su interazione utente
        await page.evaluate(() => window.scrollBy(0, 100));
        await page.waitForTimeout(getRandomInt(200, 800));

        // Controlla il Content-Type e il contenuto iniziale per vedere se è già XML
        const contentType = initialResponse.headers()['content-type'] || '';
        const rawContent = await initialResponse.text();

        if (contentType.includes('xml') && isLikelyXml(rawContent)) {
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            return res.status(200).send(rawContent);
        }

        console.log("Initial response was not direct XML. Waiting for page to stabilize...");
        
        // Se non è XML diretto, si presume una challenge o un blocco.
        // Aspettiamo la navigazione completa (o che l'evento 'load' si verifichi)
        try {
            await page.waitForNavigation({
                waitUntil: 'load', // Meno restrittivo di 'networkidle0'
                timeout: 60000 // Timeout aumentato a 60 secondi per la navigazione
            });
            console.log("Navigation completed with 'load' event.");
        } catch (navigationError) {
            console.warn("Navigation with 'load' event timed out or failed, proceeding anyway. Error:", navigationError.message);
            // Se scatta il timeout, la pagina potrebbe comunque essersi parzialmente caricata.
            // Aggiungiamo un'ulteriore pausa per permettere agli script di finire.
            await page.waitForTimeout(getRandomInt(2000, 5000)); // Aspetta 2-5 secondi extra
        }

        // Dopo l'attesa, verifica la URL corrente della pagina per debug
        const currentUrl = page.url();
        console.log(`Current URL after stabilization attempt: ${currentUrl}`);

        // Ottieni il contenuto HTML finale della pagina
        const finalContent = await page.content();
        
        let xmlContent = finalContent; // Inizialmente, assumiamo che l'intero contenuto possa essere XML

        // Se il contenuto finale non sembra XML diretto, prova a estrarlo da un elemento <pre> o dal body
        if (!isLikelyXml(finalContent)) {
            xmlContent = await page.evaluate(() => {
                const preElement = document.querySelector('pre');
                // Se c'è un <pre>, prendi il suo testo, altrimenti l'intero body text.
                return preElement ? preElement.textContent : document.body.textContent;
            });
        }
        
        // Verifica se il contenuto estratto è XML valido e sufficientemente lungo
        if (!xmlContent || xmlContent.trim().length < 50 || !isLikelyXml(xmlContent)) {
            // Se l'estrazione XML fallisce, cattura l'HTML completo per debug
            const errorHtml = await page.content();
            console.error("Could not extract valid XML content. Sending debug info.");
            
            // Per debug, invia una risposta JSON con i dettagli dell'errore e lo screenshot
            let screenshotBase64 = null;
            try {
                const screenshotBuffer = await page.screenshot({ fullPage: true }); // Cattura screenshot
                screenshotBase64 = screenshotBuffer.toString('base64'); // Codifica in Base64
                console.log("Screenshot encoded to Base64 for debug response.");
            } catch (scrError) {
                console.warn("Failed to take screenshot for debug:", scrError.message);
            }

            return res.status(500).json({
                status: 'error',
                message: 'Could not extract valid XML content. The page might be blocked or malformed.',
                currentUrl: currentUrl,
                debugHtmlSnippet: errorHtml.substring(0, 5000), // Invia un ampio snippet HTML per debug
                screenshotBase64: screenshotBase64 // Lo screenshot codificato
            });
        }
        
        // Se l'XML è stato estratto con successo, invialo come risposta XML
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.status(200).send(xmlContent);

    } catch (error) {
        console.error("An unhandled error occurred:", error);
        
        let screenshotBase64 = null;
        let errorPageContent = '';
        if (browser !== null) {
            try {
                // Tenta di accedere alla pagina corrente o di crearne una nuova
                const pages = await browser.pages();
                const currentPage = pages.length > 0 ? pages[pages.length - 1] : await browser.newPage();
                
                // Cattura lo screenshot in caso di errore
                const screenshotBuffer = await currentPage.screenshot({ fullPage: true });
                screenshotBase64 = screenshotBuffer.toString('base64');
                console.log("Error screenshot encoded to Base64.");

                // Ottieni il contenuto HTML della pagina in errore per debug
                errorPageContent = await currentPage.content();
                console.error("DEBUG ERROR HTML CONTENT (full page on error):\n", errorPageContent.substring(0, 5000));
            } catch (screenshotError) {
                console.warn("Could not take error state screenshot or get error HTML:", screenshotError.message);
            }
        }
        
        // Invia una risposta JSON in caso di errore non gestito
        res.status(500).json({
            status: 'error',
            message: 'The server encountered an unhandled error while scraping the page.',
            detailedError: String(error),
            screenshotBase64: screenshotBase64,
            debugHtmlSnippet: errorPageContent.substring(0, 5000)
        });
    } finally {
        // Assicurati che il browser sia sempre chiuso
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
    return content.startsWith('<?xml') || 
           content.startsWith('<rss') || 
           content.startsWith('<feed') ||
           content.startsWith('<urlset'); 
}
