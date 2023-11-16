const puppeteer = require('puppeteer');
require('dotenv').config();
const {ROUTER_LOGIN_URL, WIFI_CONFIG_PATH, LOGIN_USERNAME, LOGIN_PASSWORD, API_PORT, HEADLESS} = process.env;
const express = require('express')
const app = express()

let browser;
let page;
let firstLaunch = true;

(async function startBrowser() {

  browser = null;
  page = null;

  browser = await puppeteer.launch({
    headless: HEADLESS ? "new" : false,
    args: ['--start-maximized'], defaultViewport: null
  });

  console.log('BROWSER STARTED')

  if (firstLaunch) {
    firstLaunch = false;
    app.listen(API_PORT, (err) => {
      if (err) throw err;

      console.log('listening on port ' + API_PORT)
    })
  }

  browser.on('disconnected', () => {
    console.log('BROWSER DISCONNECTED, RESTARTING BROWSER')
    startBrowser()
  });

})();

app.get('/toggleWifi/:setStatus?', ({params: {setStatus}}, res) => {

  console.log('REQUEST RECEIVED, setStatus route parameter = ' + setStatus)

  if (setStatus && !['on', 'off'].includes(setStatus.toLowerCase())) {
    return res.send('Invalid setStatus route parameter, expected (on, off or undefined), example /toggleWifi/on')
  }

  if (page) {
    const msg = 'ERROR: TASK ALREADY RUNNING (PAGE STILL OPEN)';
    console.error(msg)
    return res.send(msg)
  }

  toggleWifi(setStatus).then(async (resp) => {

    console.log(resp)
    console.log('')
    await page.close().then(() => {
      page = null
      res.send(resp)
    }).catch((err) => {
      console.error(err.message)
      res.send(err.message)
    });

  }).catch(async (err) => {

    console.error(err)
    console.log('')
    await page.close().then(() => {
      page = null
      res.send(err)
    }).catch((err) => {
      console.error(err.message)
      res.send(err.message)
    });
  })
})


async function toggleWifi(setStatus) {

  return new Promise(async (resolve, reject) => {

    try {

      let LOGGED_IN = false;

      //page = await (await browser.pages())[0];
      page = await browser.newPage();

      await page.setRequestInterception(true);
      page.on('request', request => {
        if (request.resourceType() === 'image') {
          request.abort();
        } else {
          request.continue();
        }
      });

      await page.goto(ROUTER_LOGIN_URL);

      await page.waitForSelector('#form-login, #btn-logout', {timeout: 30000, visible: true});

      if (await page.$('#btn-logout') === null) {

        console.log('LOGGING IN');

        await page.evaluate(() => {
          document.querySelector("#user:not([disabled])").value = ''
          document.querySelector("#password").value = ''
        })

        await page.type('#user', LOGIN_USERNAME);
        await page.type('#password', LOGIN_PASSWORD);
        await page.click('#form-login input[type=submit]');

        await Promise.race([new Promise((resolve1, reject1) => {
          page.waitForNavigation({timeout: 30000}).then(resolve1)
            .catch(reject1)
        }), new Promise((resolve1, reject1) => {
          page.waitForSelector('#password.input-error', {
            timeout: 29000,
            visible: true
          }).then(() => reject1('WRONG LOGIN USERNAME/PASSWORD'))
            .catch((err) => LOGGED_IN ? resolve1() : reject1(err))
        })]).catch(err => {
          throw err
        });

        console.log('LOGGED IN')

      } else {
        console.log('ALREADY LOGGED IN')
      }

      LOGGED_IN = true

      await page.goto(ROUTER_LOGIN_URL + WIFI_CONFIG_PATH);
      await page.waitForSelector('#enable-wifi-24', {timeout: 30000, visible: true});

      const wifiStatus = await page.$eval('.wifiStatus span', el => el.textContent)

      console.log('WIFI STATUS:', wifiStatus)

      if (wifiStatus === 'UP') {

        if (!setStatus || setStatus === 'off') {

          console.log('TURNING OFF')
          await page.$eval('#enable-wifi-24', el => el.click())
          await page.$eval('button[ng-click="save()"', el => el.click())

          await page.waitForSelector('.wifiStatus span.color-off', {timeout: 30000, visible: true}).then(() => {
            resolve('TURNED OFF')

          }).catch(err => {
            throw 'COULDN\'T TURN WIFI OFF ' + err.message
          });
        } else {
          resolve('WIFI ALREADY ON')
        }


      } else if (wifiStatus === 'DOWN') {

        if (!setStatus || setStatus === 'on') {

          console.log('TURNING ON')
          await page.$eval('#enable-wifi-24', el => el.click())
          await page.$eval('button[ng-click="save()"', el => el.click())

          await page.waitForSelector('.wifiStatus span.color-on', {timeout: 30000, visible: true}).then(() => {
            resolve('TURNED ON')

          }).catch(err => {
            throw 'COULDN\'T TURN WIFI ON ' + err.message
          });
        } else {
          resolve('WIFI ALREADY OFF')

        }

      } else {

        throw 'INVALID CURRENT WIFI STATUS: ' + wifiStatus

      }

    } catch (err) {

      reject(err.message || err)
    }

  })

}

process.on('SIGHUP', closeBrowser)
process.on('SIGINT', closeBrowser);

function closeBrowser() {
  console.log("Closing browser");

  browser.off('disconnected')

  browser.close().catch(err => console.log("Error while closing browser", err)).finally(() => process.exit())
}