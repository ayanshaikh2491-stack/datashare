const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const wsEndpoint = 'ws://127.0.0.1:9222/devtools/browser/bdb0b6dc-79ac-4f80-806e-66a95a19f12a';
    const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
    const pages = await browser.pages();
    const page = pages[0];

    console.log('Current URL:', await page.url());
    console.log('Current Title:', await page.title());

    // Navigate to SQL Editor
    console.log('Navigating to SQL Editor...');
    await page.goto('https://supabase.com/dashboard/project/bvmhjennzemiqafekfgm/sql/new', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 8000));

    console.log('After nav URL:', await page.url());
    console.log('After nav Title:', await page.title());

    // Take screenshot to see what we're working with
    await page.screenshot({ path: 'C:/Users/TAUSHEF/datashare/supabase-sql.png', fullPage: true });
    console.log('Screenshot saved: supabase-sql.png');

    // Check if we're logged in
    const content = await page.content();
    if (content.includes('sign-in') || content.includes('Sign in') || content.includes('Login')) {
      console.log('NOT LOGGED IN - need login');
      await browser.disconnect();
      return;
    }

    console.log('Appears to be logged in!');

    // Try to find the SQL editor
    const textarea = await page.$('textarea');
    if (textarea) {
      console.log('Found textarea!');
      await textarea.click({ clickCount: 3 });
      await page.keyboard.type('');
      await page.keyboard.type('ALTER TABLE users ALTER COLUMN phone TYPE VARCHAR(255);');
      console.log('SQL typed!');

      await new Promise(r => setTimeout(r, 2000));

      // Try to find Run button by various selectors
      const buttons = await page.$$('button');
      console.log('Found', buttons.length, 'buttons');

      for (const btn of buttons) {
        const text = await btn.evaluate(el => el.textContent);
        console.log('Button:', text.trim());
        if (text.includes('Run') && text.length < 20) {
          console.log('Found Run button, clicking...');
          await btn.click();
          console.log('SQL EXECUTED!');
          await new Promise(r => setTimeout(r, 5000));
          await page.screenshot({ path: 'C:/Users/TAUSHEF/datashare/supabase-result.png', fullPage: true });
          console.log('Result screenshot saved');
          break;
        }
      }
    } else {
      console.log('No textarea found');
    }

    await browser.disconnect();
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
