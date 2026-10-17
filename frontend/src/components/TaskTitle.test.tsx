// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TaskTitle, TitleEditor } from './TaskTitle';
import { SettingsModal } from './SettingsModal';
import { TaskState } from '../domain/types';
import { AppSettings } from '../bridge/eventBridge';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);

it('renders a focused inline editor with Enter and Escape in the shared title component', () => {
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
  const editor:TitleEditor={taskId:'t1',value:'Unsaved draft',onChange:vi.fn(),onStart:vi.fn(),onCommit:vi.fn(),onCancel:vi.fn()};
  act(()=>root.render(<TaskTitle task={{id:'t1',title:'Original'} as TaskState} editor={editor}/>));
  const input=element.querySelector('input')!;expect(document.activeElement).toBe(input);expect(input.value).toBe('Unsaved draft');
  act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(editor.onCommit).toHaveBeenCalledTimes(1);
  act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(editor.onCancel).toHaveBeenCalledTimes(1);
  act(()=>root.unmount());element.remove();
});

it('defaults demo checkbox from existing files, retaining a choice across settings updates', () => {
  const element=document.createElement('div');const root=createRoot(element);
  const settings:AppSettings={knownDatabases:[{name:'missing',path:'missing.db',isDemo:true,exists:false}],activeDatabasePath:'',autostart:false};
  const props={onClose:vi.fn(),onSelectFolder:async()=>'',onCreateDatabase:async()=>{},onOpenExistingDatabase:async()=>{},onSwitchDatabase:async()=>{},onDeleteDatabase:async()=>{},onToggleAutostart:async()=>{}};
  act(()=>root.render(<SettingsModal settings={settings} {...props}/>));
  expect(element.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);
  act(()=>root.render(<SettingsModal settings={{...settings,knownDatabases:[{...settings.knownDatabases[0],exists:true}]}} {...props}/>));
  expect(element.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);
  act(()=>root.unmount());const next=createRoot(element);
  act(()=>next.render(<SettingsModal settings={{...settings,knownDatabases:[{...settings.knownDatabases[0],exists:true}]}} {...props}/>));
  expect(element.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  act(()=>next.unmount());
});
