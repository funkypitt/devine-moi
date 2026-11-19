# Captures App Store de Devine-moi : l'app web servie en local, au format iPhone 6,3" (402×874 @3 = 1206×2622).
import sys, asyncio, unicodedata
from playwright.async_api import async_playwright
OUT, DAY, PORT = sys.argv[1], sys.argv[2], sys.argv[3]
fold = lambda s: ''.join(c for c in unicodedata.normalize('NFD', s) if c.isalpha() and ord(c) < 128).upper()
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        c = await b.new_context(viewport={'width':402,'height':874}, device_scale_factor=3, is_mobile=True, has_touch=True, locale='fr-FR',
            user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148')
        pg = await c.new_page()
        await pg.goto(f'http://127.0.0.1:{PORT}/index.html?reset=1&day={DAY}')
        await pg.wait_for_timeout(1500)
        info = await pg.evaluate("""() => { const C=DevineCore, W=C.prepare(DEVINE_WORDS); const d=C.dayIndex(new Date('%sT12:00'), W.epoch);
          const ans=C.dailyAnswer(W,5,d); const all=DEVINE_WORDS['5'].answers.split(' ');
          const sh=w=>[...new Set(w)].filter(x=>ans.includes(x)).length;
          const g1=all.find(w=>w!==ans&&sh(w)===1), g2=all.find(w=>w!==ans&&w!==g1&&sh(w)===2&&[...w].some((x,i)=>x===ans[i])), g3=all.find(w=>w!==ans&&sh(w)>=3&&[...w].filter((x,i)=>x===ans[i]).length>=2);
          const n=BROUILLE.days.length; return {ans, g:[g1,g2,g3], br:BROUILLE.days[((d%%n)+n)%%n].w}; }""" % DAY)
        print(info)
        shot = lambda n: pg.screenshot(path=f'{OUT}/{n}.png')
        await shot('01-accueil')
        await pg.locator('.home-card').first.click(); await pg.wait_for_timeout(1200)
        if await pg.locator('#h-go').count(): await pg.locator('#h-go').click(); await pg.wait_for_timeout(800)
        for w in info['g']:
            await pg.keyboard.type(w, delay=60); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(2600)
        await shot('02-mot-du-jour')
        await pg.keyboard.type(info['ans'], delay=60); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(5000)
        await shot('03-trouve')
        if await pg.locator('#sheet-close').is_visible(): await pg.locator('#sheet-close').click(); await pg.wait_for_timeout(600)
        await pg.get_by_role('tab', name='Mot brouillé').click(); await pg.wait_for_timeout(1500)
        j = pg.locator('#sheet button.btn-primary')
        if await j.count() and await j.first.is_visible(): await j.first.click(); await pg.wait_for_timeout(1000)
        for i, w in enumerate(info['br'][:5]):
            if i == 3: await pg.wait_for_timeout(1200); await shot('04-mot-brouille')
            await pg.keyboard.type(fold(w), delay=70); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(2600)
        await pg.wait_for_timeout(2500)
        await shot('05-echelle-finie')
        await b.close()
asyncio.run(main())
