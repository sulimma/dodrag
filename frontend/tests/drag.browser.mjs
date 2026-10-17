import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server=await createServer({server:{host:'127.0.0.1',port:5197}});
await server.listen();
const browser=await chromium.launch({headless:true});
try {
   for (const view of ['GanttDiagramm','Liste','Netzplan','Gantt']) for (const shiftBefore of (view==='GanttDiagramm'?[true,false,null]:[true,false])) {
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
    const diagram=view==='GanttDiagramm';
    await page.getByRole('button',{name:diagram?'Gantt':view,exact:true}).click();
    const source=diagram?page.locator('[data-gantt-node="A"]'):page.locator('[data-task-drag="A"]').first(), target=diagram?page.locator('[data-gantt-node="C"]'):page.locator('[data-task-drag="C"]').first();
    await source.waitFor();
    await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
    const sourceText=diagram?source:source.locator('[data-drag-handle]');
    const a=await sourceText.boundingBox(), c=await target.boundingBox();
    // Real native drag from the explicit non-text handle, never synthetic dragstart.
    await page.mouse.move(a.x+a.width*0.5,a.y+a.height*0.5);
    if(shiftBefore) await page.keyboard.down('Shift');
    await page.mouse.down();await page.mouse.move(a.x+a.width*0.5+16,a.y+a.height*0.5,{steps:8});
    if(shiftBefore===false) await page.keyboard.down('Shift');
    await page.mouse.move(c.x+c.width*0.65,c.y+c.height*0.65,{steps:18});
    await page.mouse.move(c.x+c.width*0.65+1,c.y+c.height*0.65,{steps:2});
    assert.ok(await page.evaluate(()=>window.dragStarts)>0,`${view} Shift-before=${shiftBefore}: native dragstart`);
    if(shiftBefore===null) {
      assert.equal(await page.locator('[data-deletion-preview="true"]').count(),0);
      await page.mouse.up();
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='DEPENDENCY_REMOVED').length),0);
      console.log('PASS GanttDiagramm: normal native drag from ID center');await page.close();continue;
    }
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
    if(view!=='Liste') {
      const geometry=await page.locator('g[data-edge-key="B->C"] path[marker-end]').evaluate(path=>{
        const end=path.getPointAtLength(path.getTotalLength()),before=path.getPointAtLength(path.getTotalLength()-0.01);
        const marker=document.querySelector(path.getAttribute('marker-end').slice(4,-1));
        return {end:{x:end.x,y:end.y},tangent:{x:end.x-before.x,y:end.y-before.y},units:marker.getAttribute('markerUnits'),ref:marker.getAttribute('refX')};
      });
      assert.equal(geometry.units,'userSpaceOnUse');assert.equal(geometry.ref,'0');
      if(view==='Netzplan') assert.ok(Math.abs(geometry.tangent.x)<0.001 && geometry.tangent.y>0);
      else assert.ok(Math.abs(geometry.tangent.y)<0.001 && Math.abs(geometry.tangent.x)>0);
    }
    // Native normal text selection and inline input editing still work after Shift cleanup.
    const editableSource=diagram?page.locator('[data-task-drag="A"]').first():source;
    const title=editableSource.getByText('Title A',{exact:true});
    assert.equal(await title.evaluate(element=>getComputedStyle(element).userSelect),'text');
    await title.dblclick();
    const editor=editableSource.locator('input');await editor.waitFor();
    assert.equal(await editor.evaluate(element=>getComputedStyle(element).userSelect),'text');
    await editor.press('Escape');
    await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
    const handle=await (diagram?source:source.locator('[data-drag-handle]')).boundingBox();
    await page.keyboard.down('Shift');await page.mouse.move(handle.x+3,handle.y+3);await page.mouse.down();
    await page.mouse.move(handle.x+19,handle.y+3,{steps:8});await page.mouse.move(c.x+c.width*0.65,c.y+c.height*0.65,{steps:15});
    await page.keyboard.press('Escape');await page.mouse.up();await page.keyboard.up('Shift');
    await page.waitForFunction(()=>document.querySelectorAll('[data-deletion-preview="true"]').length===0);
    console.log(`PASS ${view}: real mouse drag, Shift ${shiftBefore?'before':'during'}, preview/release/drop/batch undo`);
    if(view==='Gantt' && shiftBefore) {
      for(const previous of ['Netzplan','Liste']) for(const marked of ['none','task','edge']) {
        await page.getByRole('button',{name:previous,exact:true}).click();
        if(marked==='task') await page.locator('[data-task-drag="B"]').first().click();
        if(marked==='edge') await page.locator(previous==='Netzplan'?'g[data-edge-key="B->C"] path[marker-end]':'button[data-edge-key="B->C"]').click({force:true});
        await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
        const frames=await page.evaluate(async()=>{
          [...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Gantt').click();
          const frames=[];
          for(let i=0;i<8;i++) {await new Promise(requestAnimationFrame);frames.push([...document.querySelectorAll('g[data-edge-key] path[marker-end]')].map(path=>({key:path.parentElement.dataset.edgeKey,d:getComputedStyle(path).d,duration:getComputedStyle(path).transitionDuration,animations:path.getAnimations().map(animation=>animation.effect.getKeyframes())})));}
          return frames;
        });
        assert.ok(frames[0].length>0,'first frame has complete edges');
        for(const frame of frames) {
          assert.deepEqual(frame.map(({key,d})=>({key,d})),frames[0].map(({key,d})=>({key,d})),'geometry stable from first frame');
          for(const path of frame) {assert.equal(path.duration,'0s');assert.equal(path.animations.length,0,'no running edge animations');}
        }
        console.log(`PASS ${previous}->Gantt ${marked}: complete stable geometry in first eight frames`);
      }
    }
    await page.close();
  }
} finally {await browser.close();await server.close();}
