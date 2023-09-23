const puppeteer = require('puppeteer');
const {ROUTER_LOGIN_URL, WIFI_CONFIG_PATH, USERNAME, PASSWORD, API_PORT} = require('./config');
const express = require('express')
const app = express()

let browser;
let page;
let TASK_RUNNING = false;

(async function startBrowser() {

  browser = await puppeteer.launch({
    headless: "new", // "new"
    args: ['--start-maximized'],
    defaultViewport: null
  });

  browser.on('disconnected', () => {
    console.log('BROWSER DISCONNECTED, RESTARTING BROWSER')
    startBrowser()
  });

  page = await (await browser.pages())[0];

  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.resourceType() === 'image') {
      request.abort();
    } else {
      request.continue();
    }
  });

  app.listen(API_PORT, (err) => {
    if (err) throw err;

    console.log('listening on port ' + API_PORT)
  })

})();

app.get('/toggleWifi/:setStatus?', ({params: {setStatus}}, res) => {

  console.log('REQUEST RECEIVED, setStatus route parameter = ' + setStatus)

  if (!setStatus || (setStatus.toLowerCase() !== 'on' && setStatus.toLowerCase() !== 'off')) {
    return res.send('Invalid setStatus route parameter, expected on or off, example /toggleWifi/on')
  }

  if (TASK_RUNNING) {
    const msg = 'ERROR: TASK ALREADY RUNNING';
    console.error(msg)
    return res.send(msg)
  }

  toggleWifi(setStatus).then(resp => {
    console.log(resp)
    console.log('')
    res.send(resp)
    TASK_RUNNING = false
  }).catch(err => {
    console.error(err)
    console.log('')
    res.send(err)
    TASK_RUNNING = false
  })
})


async function toggleWifi(setStatus) {

  TASK_RUNNING = true

  return new Promise(async (resolve, reject) => {

    try {

      await page.goto(ROUTER_LOGIN_URL);

      await page.waitForSelector('#user, #btn-logout', {timeout: 30000, visible: true});

      if (await page.$('#btn-logout') === null) {
        console.log('LOGGING IN');
        await page.evaluate(() => {
          document.getElementById("user").value = ''
          document.getElementById("password").value = ''
        })

        await page.type('#user', USERNAME);
        await page.type('#password', PASSWORD);
        await page.click('#form-login input[type=submit]');
        await page.waitForNavigation({timeout: 30000});
      } else {
        console.log('ALREADY LOGGED IN')
      }

      await page.goto(ROUTER_LOGIN_URL + WIFI_CONFIG_PATH);
      await page.waitForSelector('#enable-wifi-24', {timeout: 30000, visible: true});

      const wifiStatus = await page.$eval('.wifiStatus span', el => el.textContent)

      console.log('WIFI STATUS:', wifiStatus)

      if (wifiStatus === 'UP') {

        if (setStatus === 'off') {

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

        if (setStatus === 'on') {

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