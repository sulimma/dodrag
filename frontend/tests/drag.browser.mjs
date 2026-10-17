import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server=await createServer({server:{host:'127.0.0.1',port:5197}});
await server.listen();
const browser=await chromium.launch({headless:true});
try {
  for (const view of ['Liste','Netzplan','Gantt']) for (const shiftBefore of [true,false]) {
    const page=await browser.newPage({viewport:{width:1400,height:950}});
    await page.addInitScript(()=>{
      const iso=new Date().toISOString();let seq=0;
      const event=(type,payload)=>({seq:++seq,id:`e${seq}`,timestamp:iso,type,payload,undone:false});
      const events=['A','B','C','X'].map(taskId=>event('TASK_CREATED',{taskId,title:`Title ${taskId}`,configuredStart:iso,createdAt:iso}));
      for(const [predecessorId,taskId] of [['A','B'],['B','C'],['A','C'],['B','X']]) events.push(event('DEPENDENCY_ADDED',{predecessorId,taskId}));
      localStorage.setItem('dodrag_sqlite_fallback_events_v1',JSON.stringify(events));
      localStorage.setItem('dodrag_settings_fallback_v1',JSON.stringify({knownDatabases:[{name:'test',path:'test.db',exists:true,isDemo:false}],activeDatabasePath:'test.db',autostart:false}));
      window.dragStarts=0;document.addEventListener('dragstart',()=>window.dragStarts++);
    });
    await page.goto('http://127.0.0.1:5197');
    await page.getByRole('button',{name:view,exact:true}).click();
    const source=page.locator('[data-task-drag="A"]').first(), target=page.locator('[data-task-drag="C"]').first();
    await source.waitFor();
    await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
    const sourceText=source.locator('[data-drag-handle]');
    const a=await sourceText.boundingBox(), c=await target.boundingBox();
    // Real native drag from the explicit non-text handle, never synthetic dragstart.
    await page.mouse.move(a.x+a.width*0.65,a.y+a.height*0.65);
    if(shiftBefore) await page.keyboard.down('Shift');
    await page.mouse.down();await page.mouse.move(a.x+a.width*0.65+16,a.y+a.height*0.65,{steps:8});
    if(!shiftBefore) await page.keyboard.down('Shift');
    await page.mouse.move(c.x+c.width*0.65,c.y+c.height*0.65,{steps:18});
    await page.mouse.move(c.x+c.width*0.65+1,c.y+c.height*0.65,{steps:2});
    assert.ok(await page.evaluate(()=>window.dragStarts)>0,`${view} Shift-before=${shiftBefore}: native dragstart`);
    const preview=await page.locator('[data-deletion-preview="true"]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-edge-key')).sort());
    assert.deepEqual(preview,['A->B','A->C'],`${view}: exact source-local preview including redundant edge`);
    assert.ok(!(await target.getAttribute('class')).includes('bg-rose'),`${view}: target not red`);
    await page.keyboard.up('Shift');
    await page.mouse.move(c.x+c.width*0.65+2,c.y+c.height*0.65,{steps:2});
    await page.waitForFunction(()=>document.querySelectorAll('[data-deletion-preview="true"]').length===0);
    assert.equal(await page.locator('[data-deletion-preview="true"]').count(),0,'Shift release clears preview');
    await page.keyboard.down('Shift');await page.mouse.move(c.x+c.width*0.65+3,c.y+c.height*0.65,{steps:2});
    await page.mouse.up();await page.keyboard.up('Shift');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='DEPENDENCY_REMOVED').length===2);
    assert.equal(await page.locator('[data-deletion-preview="true"]').count(),0,'drop clears preview');
    await page.locator('button[title^="Rückgängig"]').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='DEPENDENCY_REMOVED').every(event=>event.undone));
    console.log(`PASS ${view}: real mouse drag, Shift ${shiftBefore?'before':'during'}, preview/release/drop/batch undo`);
    await page.close();
  }
} finally {await browser.close();await server.close();}
