import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Measure real card bounds and the browser's rendered SVG curve in viewport units.
const verifyNetworkGeometry=async(page)=>{
  const errors=await page.locator('g[data-edge-key] path[marker-end]').evaluateAll(paths=>{
    const errors=[];
    for(const path of paths) {
      const key=path.parentElement.dataset.edgeKey;
      const [from,to]=key.split('->');
      const source=document.querySelector(`[data-task-drag="${from}"]`).getBoundingClientRect();
      const target=document.querySelector(`[data-task-drag="${to}"]`).getBoundingClientRect();
      const matrix=path.getScreenCTM(),length=path.getTotalLength();
      const pointAt=distance=>{const p=path.getPointAtLength(distance);return new DOMPoint(p.x,p.y).matrixTransform(matrix);};
      const start=pointAt(0),end=pointAt(length),before=pointAt(length-0.01);
      const marker=document.querySelector(path.getAttribute('marker-end').slice(4,-1));
      if(target.top<=source.bottom) errors.push(`${key}: not downward`);
      // CSS card positions are quantized to 1/64px; SVG coordinates remain floats.
      if(Math.abs(start.x-(source.left+source.width/2))>0.02 || Math.abs(start.y-source.bottom)>0.02
        || Math.abs(end.x-(target.left+target.width/2))>0.02 || Math.abs(end.y+8-target.top)>0.02) errors.push(`${key}: endpoint gap`);
      if(Math.abs(end.x-before.x)>0.001 || end.y<=before.y) errors.push(`${key}: end tangent`);
      if(marker.getAttribute('markerUnits')!=='userSpaceOnUse' || marker.getAttribute('refX')!=='0') errors.push(`${key}: marker geometry`);
      const inside=(p,node)=>p.x>node.left+0.001 && p.x<node.right-0.001 && p.y>node.top+0.001 && p.y<node.bottom-0.001;
      for(let i=1;i<=2000;i++) {
        const p=pointAt(length*i/2000);
        if(inside(p,source)||inside(p,target)) {errors.push(`${key}: own card penetration`);break;}
      }
      // The fixed-size downward marker's triangle also stays outside both cards.
      for(const p of [{x:end.x-3.5,y:end.y},{x:end.x+3.5,y:end.y},{x:end.x,y:end.y+8}]) {
        if(inside(p,source)||inside(p,target)) errors.push(`${key}: arrowhead penetration`);
      }
    }
    return errors;
  });
  assert.deepEqual(errors,[],'network curves and arrowheads stay outside their own endpoint cards');
};

const server=await createServer({server:{host:'127.0.0.1',port:5197,strictPort:true}});
await server.listen();
const browser=await chromium.launch({headless:true});
try {
   for (const view of ['GanttDiagramm','Liste','Netzplan','Gantt']) for (const altBefore of (view==='GanttDiagramm'?[true,false,null]:[true,false])) {
    const page=await browser.newPage({viewport:{width:1400,height:950},locale:'de-DE'});
    await page.addInitScript(overdue=>{
      const date=new Date();if(overdue) date.setDate(date.getDate()-10);
      const iso=date.toISOString();let seq=0;
      const event=(type,payload)=>({seq:++seq,id:`e${seq}`,timestamp:iso,type,payload,undone:false});
      const events=['A','B','C','X'].map(taskId=>event('TASK_CREATED',{taskId,title:`Title ${taskId}`,configuredStart:iso,createdAt:iso}));
      for(const [predecessorId,taskId] of [['A','B'],['B','C'],['A','C'],['B','X']]) events.push(event('DEPENDENCY_ADDED',{predecessorId,taskId}));
      localStorage.setItem('dodrag_sqlite_fallback_events_v1',JSON.stringify(events));
      localStorage.setItem('dodrag_settings_fallback_v1',JSON.stringify({knownDatabases:[{name:'test',path:'test.db',exists:true,isDemo:false}],activeDatabasePath:'test.db',autostart:false}));
      window.dragStarts=0;document.addEventListener('dragstart',()=>window.dragStarts++);
    },view==='Netzplan');
    await page.goto('http://127.0.0.1:5197');
    const diagram=view==='GanttDiagramm';
    await page.getByRole('button',{name:diagram?'Gantt':view,exact:true}).click();
    const source=diagram?page.locator('[data-gantt-node="A"]'):page.locator('[data-task-drag="A"]').first(), target=diagram?page.locator('[data-gantt-node="C"]'):page.locator('[data-task-drag="C"]').first();
    await source.waitFor();
    await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
    if(view==='Netzplan') await verifyNetworkGeometry(page);
    const sourceText=diagram?source:source.locator('[data-drag-handle]');
    const a=await sourceText.boundingBox(), c=await target.boundingBox();
    // Real native drag from the explicit non-text handle, never synthetic dragstart.
    await page.mouse.move(a.x+a.width*0.5,a.y+a.height*0.5);
     if(altBefore) await page.keyboard.down('Alt');
     await page.mouse.down();await page.mouse.move(a.x+a.width*0.5+16,a.y+a.height*0.5,{steps:8});
     if(altBefore===false) await page.keyboard.down('Alt');
     await page.mouse.move(c.x+c.width*0.65,c.y+c.height*0.65,{steps:18});
     await page.mouse.move(c.x+c.width*0.65+1,c.y+c.height*0.65,{steps:2});
     assert.ok(await page.evaluate(()=>window.dragStarts)>0,`${view} Alt-before=${altBefore}: native dragstart`);
     if(altBefore===null) {
      assert.equal(await page.locator('[data-deletion-preview="true"]').count(),0);
      await page.mouse.up();
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='DEPENDENCY_REMOVED').length),0);
      console.log('PASS GanttDiagramm: normal native drag from ID center');await page.close();continue;
    }
    const preview=await page.locator('[data-deletion-preview="true"]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-edge-key')).sort());
    assert.deepEqual(preview,['A->B','A->C'],`${view}: exact source-local preview including redundant edge`);
    assert.ok(!(await target.getAttribute('class')).includes('bg-rose'),`${view}: target not red`);
    if(view==='Netzplan') await verifyNetworkGeometry(page);
     await page.keyboard.up('Alt');
     await page.mouse.move(c.x+c.width*0.65+2,c.y+c.height*0.65,{steps:2});
     await page.waitForFunction(()=>document.querySelectorAll('[data-deletion-preview="true"]').length===0);
     assert.equal(await page.locator('[data-deletion-preview="true"]').count(),0,'Alt release clears preview');
     await page.keyboard.down('Alt');await page.mouse.move(c.x+c.width*0.65+3,c.y+c.height*0.65,{steps:2});
     await page.mouse.up();await page.keyboard.up('Alt');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='DEPENDENCY_REMOVED').length===2);
    assert.equal(await page.locator('[data-deletion-preview="true"]').count(),0,'drop clears preview');
    await page.locator('button[title^="Rückgängig"]').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='DEPENDENCY_REMOVED').every(event=>event.undone));
    if(view==='Netzplan') await verifyNetworkGeometry(page);
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
     // Native normal text selection and inline input editing still work after Alt cleanup.
    const editableSource=diagram?page.locator('[data-task-drag="A"]').first():source;
    const title=editableSource.getByText('Title A',{exact:true});
    assert.equal(await title.evaluate(element=>getComputedStyle(element).userSelect),'text');
    await title.dblclick();
    const editor=editableSource.locator('input');await editor.waitFor();
    assert.equal(await editor.evaluate(element=>getComputedStyle(element).userSelect),'text');
    await editor.press('Escape');
    await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
    const handle=await (diagram?source:source.locator('[data-drag-handle]')).boundingBox();
     await page.keyboard.down('Alt');await page.mouse.move(handle.x+3,handle.y+3);await page.mouse.down();
     await page.mouse.move(handle.x+19,handle.y+3,{steps:8});await page.mouse.move(c.x+c.width*0.65,c.y+c.height*0.65,{steps:15});
     await page.keyboard.press('Escape');await page.mouse.up();await page.keyboard.up('Alt');
     await page.waitForFunction(()=>document.querySelectorAll('[data-deletion-preview="true"]').length===0);
     console.log(`PASS ${view}: real mouse drag, Alt ${altBefore?'before':'during'}, preview/release/drop/batch undo`);
     if(view==='Gantt' && altBefore) {
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
  {
    const page=await browser.newPage({viewport:{width:1400,height:950},locale:'de-DE'});
    await page.addInitScript(()=>{
      const date=new Date();date.setDate(date.getDate()-10);date.setHours(9,0,0,0);
      const iso=date.toISOString();let seq=0;
      const event=(type,payload)=>({seq:++seq,id:`layout${seq}`,timestamp:iso,type,payload,undone:false});
      const events=['X','A','Y','Z','B','D','C','E','F'].map(taskId=>event('TASK_CREATED',{taskId,title:`Title ${taskId}`,configuredStart:iso,createdAt:iso}));
      const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);tomorrow.setHours(9,0,0,0);
      events.push(event('TASK_START_DATE_SET',{taskId:'F',configuredStart:tomorrow.toISOString()}));
      for(const [predecessorId,taskId] of [['A','B'],['A','D'],['B','C'],['A','C'],['B','E'],['D','E'],['E','F']]) events.push(event('DEPENDENCY_ADDED',{predecessorId,taskId}));
      localStorage.setItem('dodrag_sqlite_fallback_events_v1',JSON.stringify(events));
      localStorage.setItem('dodrag_settings_fallback_v1',JSON.stringify({knownDatabases:[{name:'test',path:'test.db',exists:true,isDemo:false}],activeDatabasePath:'test.db',autostart:false}));
    });
    await page.goto('http://127.0.0.1:5197');
    await page.getByRole('button',{name:'Netzplan',exact:true}).click();
    await page.locator('[data-task-drag="F"]').waitFor();
    const snapshot=()=>page.locator('[data-task-drag]').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>{
      // Compare layout coordinates, unaffected by Playwright scrolling a title into view.
      const rect=node.getBoundingClientRect(),origin=node.parentElement.getBoundingClientRect();
      return [node.dataset.taskDrag,{x:rect.x-origin.x,y:rect.y-origin.y,bottom:rect.bottom-origin.y}];
    })));
    for(const width of [1400,850,500,1400]) {
      await page.setViewportSize({width,height:950});
      // Wait for ResizeObserver to feed the actual available width into the component.
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const nodes=await snapshot();
      const roots=['A','X','Y','Z'],middle=['B','D'],last=['C','E'];
      assert.ok(Math.min(...middle.map(id=>nodes[id].y))>Math.max(...roots.map(id=>nodes[id].bottom)),'next level follows ALL wrapped root rows');
      assert.ok(Math.min(...last.map(id=>nodes[id].y))>Math.max(...middle.map(id=>nodes[id].bottom)),'diamond successors follow complete predecessor level');
      assert.ok(nodes.F.y>Math.max(...last.map(id=>nodes[id].bottom)),'future date band follows all today levels');
      if(width===1400) {
        assert.equal(nodes.A.y,nodes.X.y,'independent roots share a wide row');
        assert.ok(nodes.A.x<nodes.X.x,'same-level order follows existing timestamp/ID priority');
        assert.equal(nodes.B.y,nodes.D.y,'independent diamond branches share a wide row');
      }
      if(width===500) assert.equal(new Set(Object.values(nodes).map(node=>node.x)).size,1,'narrow view uses one column');
      if(width===850) assert.ok(new Set(roots.map(id=>nodes[id].y)).size>1,'wide root level wraps');
      assert.equal(await page.locator('g[data-edge-key="A->C"]').count(),0,'redundant edge remains hidden normally');
      await verifyNetworkGeometry(page);
      const stable=await snapshot();
      await page.locator('[data-task-drag="A"]').getByText('Title A',{exact:true}).click();
      assert.deepEqual(await snapshot(),stable,'highlights do not change layout');
      await verifyNetworkGeometry(page);
    }
    console.log('PASS network real geometry: overdue levels, wrapped roots, diamond, direct/transitive highlights, future band, responsive resize');
    await page.close();
  }
  const page=await browser.newPage({viewport:{width:1400,height:950},locale:'de-DE'});
  await page.addInitScript(()=>{
    const date=new Date();date.setHours(9,0,0,0);const iso=date.toISOString();let seq=0;
    const event=(type,payload)=>({seq:++seq,id:`date${seq}`,timestamp:iso,type,payload,undone:false});
    const events=['A','B','P'].map(taskId=>event('TASK_CREATED',{taskId,title:`Title ${taskId}`,configuredStart:iso,createdAt:iso}));
    date.setDate(date.getDate()+3);
    events.push(event('TASK_START_DATE_SET',{taskId:'P',configuredStart:date.toISOString()}),event('DEPENDENCY_ADDED',{predecessorId:'P',taskId:'B'}));
    localStorage.setItem('dodrag_sqlite_fallback_events_v1',JSON.stringify(events));
    localStorage.setItem('dodrag_settings_fallback_v1',JSON.stringify({knownDatabases:[{name:'test',path:'test.db',exists:true,isDemo:false}],activeDatabasePath:'test.db',autostart:false}));
  });
  await page.goto('http://127.0.0.1:5197');
  const keys=await page.evaluate(()=>Array.from({length:6},(_,offset)=>{
    const date=new Date();date.setDate(date.getDate()+offset);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }));
  const dateEvents=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='TASK_START_DATE_SET' && event.payload.taskId==='A' && !event.undone));
  await page.getByRole('button',{name:'Netzplan',exact:true}).click();
  await page.getByRole('button',{name:'Startdatum A bearbeiten',exact:true}).click();
  let input=page.getByRole('textbox',{name:'Startdatum A',exact:true});
  await input.fill(`${keys[2]} 14:30`);await input.press('Enter');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).some(event=>event.type==='TASK_START_DATE_SET' && event.payload.taskId==='A'));
  await page.getByRole('button',{name:'Liste',exact:true}).click();
  assert.ok((await page.getByRole('button',{name:'Startdatum A bearbeiten',exact:true}).textContent()).includes(`${keys[2]} 14:30`),'shared date edit persisted with time');
  await page.getByRole('button',{name:'Netzplan',exact:true}).click();
  await page.getByRole('button',{name:'Startdatum A bearbeiten',exact:true}).click();
  input=page.getByRole('textbox',{name:'Startdatum A',exact:true});
  await input.fill(keys[5]);await input.press('Escape');assert.equal((await dateEvents()).length,1,'Escape cancels date edit');
  await page.getByRole('button',{name:'Startdatum A bearbeiten',exact:true}).click();
  input=page.getByRole('textbox',{name:'Startdatum A',exact:true});await input.fill(keys[1]);
  await page.locator('[data-task-drag="A"]').getByText('Title A',{exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='TASK_START_DATE_SET' && event.payload.taskId==='A').length===2);
  await page.getByRole('button',{name:'Gantt',exact:true}).click();
  const dragToDate=async(id,key,cancel=false)=>{
    await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
    const source=await page.locator(`[data-gantt-node="${id}"]`).boundingBox();
    const target=page.locator(`[data-gantt-date="${key}"]`);await target.scrollIntoViewIfNeeded();
    const dest=await target.boundingBox();
    await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();
    await page.mouse.move(source.x+source.width/2+16,source.y+source.height/2,{steps:8});
    await page.mouse.move(dest.x+20,source.y+source.height/2,{steps:18});
    if(cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  };
  await dragToDate('A',keys[3]);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='TASK_START_DATE_SET' && event.payload.taskId==='A').length===3);
  const moved=(await dateEvents()).at(-1);
  assert.equal(await page.evaluate(iso=>{const date=new Date(iso);return [date.getHours(),date.getMinutes()];},moved.payload.configuredStart).then(JSON.stringify),'[9,0]','date column uses local 09:00');
  assert.ok((await page.locator('[data-gantt-node="A"]').getAttribute('title')).includes(keys[3]));
  const position=await page.locator('[data-gantt-node="A"]').evaluate(element=>element.style.left);
  await page.locator('button[title^="Rückgängig"]').click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='TASK_START_DATE_SET' && event.payload.taskId==='A').at(-1).undone);
  assert.notEqual(await page.locator('[data-gantt-node="A"]').evaluate(element=>element.style.left),position,'undo restores position');
  await dragToDate('A',keys[5],true);assert.equal((await dateEvents()).length,2,'Escape cancels native date drag');
  const constrained=await page.locator('[data-gantt-node="B"]').evaluate(element=>element.style.left);
  await dragToDate('B',keys[1]);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).some(event=>event.type==='TASK_START_DATE_SET' && event.payload.taskId==='B'));
  assert.equal(await page.locator('[data-gantt-node="B"]').evaluate(element=>element.style.left),constrained,'predecessor constraint keeps effective position');
  assert.ok((await page.locator('[data-gantt-node="B"]').getAttribute('title')).includes(keys[1]),'drop changes configured date despite constraint');
  console.log('PASS shared list/network date editing: Enter, blur, Escape, time; real Gantt date drag, undo, cancellation, predecessor constraint');
  await page.close();
  for (const view of ['Liste','Netzplan','Gantt','GanttDiagramm']) {
    const page=await browser.newPage({viewport:{width:1400,height:950},locale:'de-DE'});
    await page.addInitScript(()=>{
      const date=new Date();date.setHours(9,0,0,0);const iso=date.toISOString();
      const events=['A','B','C'].map((taskId,index)=>({seq:index+1,id:`group${index}`,timestamp:iso,undone:false,
        type:'TASK_CREATED',payload:{taskId,title:`Title ${taskId}`,configuredStart:iso,createdAt:iso}}));
      localStorage.setItem('dodrag_sqlite_fallback_events_v1',JSON.stringify(events));
      localStorage.setItem('dodrag_settings_fallback_v1',JSON.stringify({knownDatabases:[{name:'test',path:'test.db',exists:true,isDemo:false}],activeDatabasePath:'test.db',autostart:false}));
      window.dragStarts=0;document.addEventListener('dragstart',()=>window.dragStarts++);
      window.dragImages=[];
      document.addEventListener('dragstart',event=>{
        const root=event.target.closest('[data-task-drag]'),rect=root.getBoundingClientRect();
        window.dragOrigin={id:root.dataset.taskDrag,x:event.clientX-rect.left,y:event.clientY-rect.top};
      },true);
      const original=DataTransfer.prototype.setDragImage;
      DataTransfer.prototype.setDragImage=function(image,x,y){
        const rect=image.getBoundingClientRect(),origin=window.dragOrigin;
        const clones=[...image.querySelectorAll('[data-drag-preview-task]')];
        const member=clones.find(clone=>clone.dataset.dragPreviewTask===origin.id),bounds=member.getBoundingClientRect();
        const scale=bounds.width/parseFloat(member.style.width);
        window.dragImages.push({ids:clones.map(clone=>clone.dataset.dragPreviewTask),text:image.textContent,
          width:rect.width,height:rect.height,connected:image.isConnected,inert:image.inert,
          safe:!image.querySelector('[id],[data-task-drag],[draggable],[contenteditable]'),
          x,y,expectedX:Math.round(bounds.left-rect.left+origin.x*scale),expectedY:Math.round(bounds.top-rect.top+origin.y*scale),
          background:getComputedStyle(member).backgroundColor});
        return original.call(this,image,x,y);
      };
    });
    await page.goto('http://127.0.0.1:5197');
    const diagram=view==='GanttDiagramm';
    await page.getByRole('button',{name:diagram?'Gantt':view,exact:true}).click();
    const node=id=>page.locator(diagram?`[data-gantt-node="${id}"]`:`[data-task-drag="${id}"]`).first();
    await node('A').click();await node('B').click({modifiers:['Control']});
    assert.equal(await node('A').getAttribute('data-task-selected'),'true');
    assert.equal(await node('B').getAttribute('data-task-selected'),'true');
    await node('A').click({button:'right'});
    assert.equal(await node('B').getAttribute('data-task-selected'),'true','context keeps group');
    await page.keyboard.press('Escape');
    const drag=async(target,cancel=false)=>{
      await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
      const source=await (diagram?node('A'):node('A').locator('[data-drag-handle]')).boundingBox();
      const dest=await target.boundingBox();
      await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();
      await page.mouse.move(source.x+source.width/2+16,source.y+source.height/2,{steps:8});
      await page.mouse.move(dest.x+dest.width*.65,dest.y+dest.height*.65,{steps:18});
      assert.equal(await page.locator('[data-task-drag-preview]').count(),1);
      const image=await page.evaluate(()=>window.dragImages.at(-1));
      assert.deepEqual(image.ids,['A','B'],`${view}: actual frozen members in native image`);
      assert.ok(image.connected && image.inert && image.safe);
      assert.ok(image.width<=600 && image.height<=440);
      assert.ok(image.x===image.expectedX && image.y===image.expectedY,`${view}: pointer hotspot`);
      assert.notEqual(image.background,'rgba(0, 0, 0, 0)','actual node styles cloned');
      if(!diagram) assert.ok(image.text.includes('Title A') && image.text.includes('Title B'));
      if(cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.equal(await page.locator('[data-task-drag-preview]').count(),0,'native end/drop cleanup');
    };
    const activeEvents=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>!event.undone));
    await drag(node('C'),true);
    assert.equal((await activeEvents()).filter(event=>event.type==='DEPENDENCY_ADDED').length,0,'Escape cancels mutation');
    await drag(node('C'));
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='DEPENDENCY_ADDED'&&!event.undone).length===2);
    let batch=(await activeEvents()).filter(event=>event.type==='DEPENDENCY_ADDED');
    assert.deepEqual(batch.map(event=>event.payload),[{taskId:'A',predecessorId:'C'},{taskId:'B',predecessorId:'C'}]);
    assert.ok(batch[0].groupId && batch[0].groupId===batch[1].groupId,'one undo group');
    await page.locator('button[title^="Rückgängig"]').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='DEPENDENCY_ADDED').every(event=>event.undone));
    await drag(page.locator('aside .cursor-pointer').filter({hasText:'+1 Tag'}));
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='TASK_START_DATE_SET'&&!event.undone).length===2);
    batch=(await activeEvents()).filter(event=>event.type==='TASK_START_DATE_SET');
    assert.deepEqual(batch.map(event=>event.payload.taskId),['A','B']);
    assert.ok(batch[0].groupId && batch[0].groupId===batch[1].groupId);
    if(view==='Gantt') {
      await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));
      const source=await page.locator('[data-gantt-node="A"]').boundingBox();
      const target=page.locator('[data-gantt-date]').nth(3);
      const dateKey=await target.getAttribute('data-gantt-date'),dest=await target.boundingBox();
      await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();
      await page.mouse.move(source.x+source.width/2+16,source.y+source.height/2,{steps:8});
      await page.mouse.move(dest.x+20,source.y+source.height/2,{steps:18});await page.mouse.up();
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='TASK_START_DATE_SET'&&!event.undone).length===4);
      batch=(await activeEvents()).filter(event=>event.type==='TASK_START_DATE_SET').slice(-2);
      assert.deepEqual(batch.map(event=>event.payload.taskId),['A','B']);
      assert.ok(batch[0].groupId && batch[0].groupId===batch[1].groupId);
      assert.deepEqual(await page.evaluate(events=>events.map(event=>{
        const date=new Date(event.payload.configuredStart);
        return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      }),batch),[dateKey,dateKey],'both group members receive Gantt drop date');
    }
    await drag(page.locator('aside .flex-1.min-h-0').first());
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('dodrag_sqlite_fallback_events_v1')).filter(event=>event.type==='TASK_COMPLETED'&&!event.undone).length===2);
    batch=(await activeEvents()).filter(event=>event.type==='TASK_COMPLETED');
    assert.deepEqual(batch.map(event=>event.payload.taskId),['A','B']);
    assert.ok(batch[0].groupId && batch[0].groupId===batch[1].groupId);
    assert.ok(await page.evaluate(()=>window.dragStarts)>=3,'real native group drags');
    console.log(`PASS ${view}: real group predecessor/resubmit/complete drags, context preservation, atomic undo`);
    await page.close();
  }
} finally {await browser.close();await server.close();}
